
import { Scanner, OrderBook } from './Scanner';
import Redis from 'ioredis';

export class ScannerService {
    private redis: Redis;
    private sub: Redis;
    private scanner: Scanner;
    private orderBooks: Map<string, OrderBook>;
    private symbols: string[];
    private exchange: string;

    constructor(minProfitPct: number = 0.5, symbols: string[], exchange: string = 'binance', redisInstance?: Redis, subInstance?: Redis) {
        this.redis = redisInstance || new Redis();
        this.sub = subInstance || new Redis();
        this.scanner = new Scanner(minProfitPct);
        this.orderBooks = new Map<string, OrderBook>();
        this.symbols = symbols;
        this.exchange = exchange;
    }

    async start() {
        console.log(`[ScannerService] Starting for ${this.exchange}...`);
        this.scanner.generatePaths(this.exchange, this.symbols);

        this.sub.psubscribe(`depth:${this.exchange}:*`);

        // Health heartbeat
        setInterval(() => {
            this.redis.publish(`health:scanner`, JSON.stringify({
                exchange: this.exchange,
                timestamp: Date.now(),
                status: 'alive'
            }));
        }, 5000);

        this.sub.on('pmessage', (_, channel, raw) => {
            try {
                const data = JSON.parse(raw);
                if (data.type === 'delta') {
                    this.processUpdate(data);
                }
            } catch (e) {
                console.error('[ScannerService] Message error', e);
            }
        });

        this.sub.on('error', (err) => console.error('[ScannerService] Redis Sub Error', err));
        this.redis.on('error', (err) => console.error('[ScannerService] Redis Pub Error', err));
    }

    private async processUpdate(data: any) {
        const symbol = data.symbol;
        let ob = this.orderBooks.get(symbol);

        // If no OrderBook, we must initialize via Snapshot first
        if (!ob) {
            await this.fetchSnapshot(symbol);
            // After snapshot, we might need to process this event if it came *after* snapshot?
            // Actually, fetchSnapshot sets OB. We can return, next events will apply.
            // But this specific event might be lost if we don't apply it?
            // If we just fetched snapshot, that snapshot includes latest state.
            // This event 'data' might be older or newer.
            // Safest is to just return and let stream continue.
            return;
        }

        // 3. Binance Event Sequencing (Strict)
        if (data.u <= ob.lastUpdateId) return; // Discard old events

        // Gap Detection
        // Correct logic: U <= lastUpdateId + 1 is Allowed (Overlap or Exact)
        // U > lastUpdateId + 1 is GAP
        if (data.U > ob.lastUpdateId + 1) {
            console.warn(`[Scanner] Sequence Gap for ${symbol}: Event U=${data.U} > OB=${ob.lastUpdateId} + 1. Re-syncing...`);
            this.fetchSnapshot(symbol);
            return;
        }

        // Apply Delta
        ob.applyDelta(data.bids, data.asks);
        ob.lastUpdateId = data.u;
        ob.timestamp = data.timestamp;

        // Scan for Opportunities
        this.runScan(symbol);
    }

    private async fetchSnapshot(symbol: string) {
        try {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 3000); // 3s Timeout (Phase C)

            const res = await fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol.toUpperCase()}&limit=1000`, {
                signal: controller.signal
            });
            const snap = await res.json() as any;

            let ob = this.orderBooks.get(symbol);
            if (!ob) {
                ob = new OrderBook(symbol);
                this.orderBooks.set(symbol, ob);
            }

            ob.applySnapshot(snap.bids, snap.asks);
            ob.lastUpdateId = snap.lastUpdateId;
            ob.timestamp = Date.now();
            console.log(`[Scanner] Snapshot loaded for ${symbol} @ ${ob.lastUpdateId}`);
        } catch (e: any) {
            console.error(`[Scanner] Fetch Snapshot failed for ${symbol}: ${e.message}`);
        }
    }

    private runScan(symbol: string) {
        // Kill Switch: Latency Check
        const ob = this.orderBooks.get(symbol);
        if (!ob) return;

        if (Date.now() - ob.timestamp > 300) return; // Drop stale

        const opps = this.scanner.scan(this.exchange, this.orderBooks);
        if (opps.length) {
            const validOpps = opps.filter(o => {
                if (o.maxExecutableUSDT < 50) return false;
                if (o.profitPct > 5) return false;
                if (Date.now() - o.timestamp > 200) return false;
                return true;
            });

            if (validOpps.length > 0) {
                this.redis.publish(`opportunity:${this.exchange}`, JSON.stringify(validOpps));
            }
        }
    }
}

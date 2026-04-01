
import { Scanner, OrderBook } from './Scanner';
import Redis from 'ioredis';
import { initMoversSubscription } from './movers';
import { generateDynamicPaths } from './pathGenerator';
import { SupabaseWriter } from './SupabaseWriter';
import { getSnapshotConfig } from './snapshotUrls';
import { FilterManager, createFilterManager } from './FilterManager';

export class ScannerService {
    private redis: Redis;
    private sub: Redis;
    private scanner: Scanner;
    private orderBooks: Map<string, OrderBook>;
    private symbols: string[];
    private exchange: string;
    private supabaseWriter: SupabaseWriter;

    constructor(minProfitPct: number = 0.5, symbols: string[], exchange: string = 'binance', redisInstance?: Redis, subInstance?: Redis, writer?: SupabaseWriter) {
        this.redis = redisInstance || new Redis();
        this.sub = subInstance || new Redis();
        this.scanner = new Scanner(minProfitPct);
        this.orderBooks = new Map<string, OrderBook>();
        this.symbols = symbols;
        this.exchange = exchange;
        this.supabaseWriter = writer || new SupabaseWriter();
    }

    async start() {
        console.log(`[ScannerService] Starting for ${this.exchange}...`);
        
        // Initialize movers subscription (only once, shared across all instances)
        initMoversSubscription();
        
        // Generate static paths as fallback
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

        if (!ob) {
            await this.fetchSnapshot(symbol);
            return;
        }

        if (data.u <= ob.lastUpdateId) return;

        if (data.U > ob.lastUpdateId + 1) {
            console.warn(`[Scanner] Sequence Gap for ${symbol}: Event U=${data.U} > OB=${ob.lastUpdateId} + 1. Re-syncing...`);
            this.fetchSnapshot(symbol);
            return;
        }

        ob.applyDelta(data.bids, data.asks);
        ob.lastUpdateId = data.u;
        ob.timestamp = data.timestamp;

        this.runScan(symbol);
    }

    private async fetchSnapshot(symbol: string) {
        try {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 5000);

            const config = getSnapshotConfig(this.exchange);
            const url = config.buildUrl(symbol);

            const res = await fetch(url, { signal: controller.signal });
            const rawData = await res.json() as any;
            const snap = config.parseResponse(rawData);

            let ob = this.orderBooks.get(symbol);
            if (!ob) {
                ob = new OrderBook(symbol);
                this.orderBooks.set(symbol, ob);
            }

            ob.applySnapshot(snap.bids, snap.asks);
            ob.lastUpdateId = snap.lastUpdateId;
            ob.timestamp = Date.now();
            console.log(`[Scanner:${this.exchange}] Snapshot loaded for ${symbol} @ ${ob.lastUpdateId}`);
        } catch (e: any) {
            console.error(`[Scanner:${this.exchange}] Fetch Snapshot failed for ${symbol}: ${e.message}`);
        }
    }

    private runScan(symbol: string) {
        const ob = this.orderBooks.get(symbol);
        if (!ob) return;

        if (Date.now() - ob.timestamp > 300) return;

        const dynamicPaths = generateDynamicPaths(this.exchange, this.symbols);
        const paths = dynamicPaths.length > 0 ? dynamicPaths : undefined;

        const opps = this.scanner.scan(this.exchange, this.orderBooks, paths);
        if (opps.length) {
            const validOpps = opps.filter(o => {
                if (o.maxExecutableUSDT < 50) return false;
                if (o.profitPct > 5) return false;
                if (Date.now() - o.timestamp > 200) return false;
                return true;
            });

            if (validOpps.length > 0) {
                // Publish to Redis (existing behavior)
                this.redis.publish(`opportunity:${this.exchange}`, JSON.stringify(validOpps));

                // Write to Supabase database
                for (const opp of validOpps) {
                    this.supabaseWriter.enqueue(this.exchange, opp);
                }
            }
        }
    }
}

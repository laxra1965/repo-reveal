import WebSocket from 'ws';
import { OrderBook } from '../OrderBook';

export class BinanceClient {
    private ws: WebSocket | null = null;
    public orderBooks: Map<string, OrderBook> = new Map();
    private buffer: Map<string, any[]> = new Map();
    private isSnapshotLoaded: Map<string, boolean> = new Map();
    private reconnectAttempts = 0;
    private shouldReconnect = true;

    constructor(private symbols: string[]) {
        this.symbols.forEach(s => {
            this.orderBooks.set(s, new OrderBook(s));
            this.buffer.set(s, []);
            this.isSnapshotLoaded.set(s, false);
        });
    }

    async connect() {
        // FIX: Use @depth@100ms for production-grade low latency
        const streams = this.symbols.map(s => `${s.toLowerCase()}@depth@100ms`).join('/');
        const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

        console.log(`Connecting to Binance WS...`);
        this.ws = new WebSocket(url);

        this.ws.on('open', () => {
            console.log('Connected to Binance WS');
            this.reconnectAttempts = 0;
            this.symbols.forEach(s => this.fetchSnapshot(s));
        });

        this.ws.on('message', (data: WebSocket.Data) => {
            try {
                const message = JSON.parse(data.toString());
                const event = message.data;
                if (!event) return;

                const symbol = event.s;
                if (!symbol || !this.orderBooks.has(symbol)) return;

                if (this.isSnapshotLoaded.get(symbol)) {
                    this.processUpdate(event);
                } else {
                    this.buffer.get(symbol)?.push(event);
                }
            } catch (e) {
                console.error('WS Message Parse Error', e);
            }
        });

        this.ws.on('error', (err) => {
            console.error('WS Error', err);
            this.ws?.terminate();
        });

        this.ws.on('close', () => {
            console.log('WS Closed');
            if (this.shouldReconnect) this.scheduleReconnect();
        });
    }

    private scheduleReconnect() {
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectAttempts++;
        console.log(`Reconnecting to Binance in ${delay}ms...`);
        setTimeout(() => this.connect(), delay);
    }

    async fetchSnapshot(symbol: string) {
        try {
            console.log(`Fetching snapshot for ${symbol}`);
            // FIX: Add timeout protection (3 seconds)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            const res = await fetch(
                `https://api.binance.com/api/v3/depth?symbol=${symbol.toUpperCase()}&limit=1000`,
                { signal: controller.signal }
            );
            clearTimeout(timeoutId);

            const data = await res.json();

            if (!data.lastUpdateId) {
                throw new Error('Invalid snapshot data');
            }

            const ob = this.orderBooks.get(symbol)!;
            ob.reset();
            ob.lastUpdateId = data.lastUpdateId;

            data.bids.forEach(([price, qty]: [string, string]) => ob.updateSide('bids', +price, +qty));
            data.asks.forEach(([price, qty]: [string, string]) => ob.updateSide('asks', +price, +qty));

            this.isSnapshotLoaded.set(symbol, true);
            console.log(`Snapshot loaded for ${symbol}`);

            // FIX: Replay buffer with proper sequencing validation
            const buffer = this.buffer.get(symbol) || [];
            for (const event of buffer) {
                // Only process if: u > lastUpdateId AND U <= lastUpdateId + 1 (no gap)
                if (event.u > ob.lastUpdateId && event.U <= ob.lastUpdateId + 1) {
                    this.processUpdate(event);
                }
            }
            this.buffer.set(symbol, []);

        } catch (e) {
            console.error(`Snapshot failed for ${symbol}`, e);
        }
    }

    // FIX: Strict Binance sequencing validation (CRITICAL for production)
    processUpdate(event: any) {
        const ob = this.orderBooks.get(event.s)!;

        // Binance strict sequencing rule
        if (event.u <= ob.lastUpdateId) return; // Discard old events

        // CRITICAL: Check if U matches expected sequence (must be lastUpdateId + 1)
        if (event.U !== ob.lastUpdateId + 1) {
            console.error(`[Binance] Sequence gap detected for ${event.s}: U=${event.U}, expected=${ob.lastUpdateId + 1}`);
            this.isSnapshotLoaded.set(event.s, false);
            this.fetchSnapshot(event.s);
            return;
        }

        // Apply updates
        for (const [price, qty] of event.b) {
            ob.updateSide('bids', +price, +qty);
        }
        for (const [price, qty] of event.a) {
            ob.updateSide('asks', +price, +qty);
        }

        ob.lastUpdateId = event.u;
    }
}

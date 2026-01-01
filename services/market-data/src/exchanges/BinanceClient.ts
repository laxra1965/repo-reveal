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
        const streams = this.symbols.map(s => `${s.toLowerCase()}@depth`).join('/');
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
            const res = await fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol.toUpperCase()}&limit=1000`);
            const data = await res.json();

            if (!data.lastUpdateId) {
                throw new Error('Invalid snapshot data');
            }

            const ob = this.orderBooks.get(symbol)!;
            ob.lastUpdateId = data.lastUpdateId;

            data.bids.forEach((b: any) => ob.update(parseFloat(b[0]), parseFloat(b[1]), true));
            data.asks.forEach((a: any) => ob.update(parseFloat(a[0]), parseFloat(a[1]), false));

            this.isSnapshotLoaded.set(symbol, true);
            console.log(`Snapshot loaded for ${symbol}`);

            // Replay buffer
            const buffer = this.buffer.get(symbol) || [];
            for (const event of buffer) {
                if (event.u > ob.lastUpdateId) {
                    this.processUpdate(event);
                }
            }
            this.buffer.set(symbol, []);

        } catch (e) {
            console.error(`Snapshot failed for ${symbol}`, e);
        }
    }

    processUpdate(event: any) {
        const ob = this.orderBooks.get(event.s)!;
        if (event.u <= ob.lastUpdateId) return;
        event.b.forEach((b: any) => ob.update(parseFloat(b[0]), parseFloat(b[1]), true));
        event.a.forEach((a: any) => ob.update(parseFloat(a[0]), parseFloat(a[1]), false));
        ob.lastUpdateId = event.u;
    }
}

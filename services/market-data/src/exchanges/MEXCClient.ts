import WebSocket from 'ws';
import { OrderBook } from '../OrderBook';

export class MEXCClient {
    private ws: WebSocket | null = null;
    public orderBooks: Map<string, OrderBook> = new Map();
    private reconnectAttempts = 0;
    private shouldReconnect = true;
    private pingInterval: NodeJS.Timeout | null = null;

    constructor(private symbols: string[]) {
        this.symbols.forEach(s => {
            // MEXC symbols usually stripped or specific format? API usually takes BTCUSDT
            this.orderBooks.set(s, new OrderBook(s));
        });
    }

    async connect() {
        const url = 'wss://wbs.mexc.com/ws';
        console.log(`Connecting to MEXC WS...`);
        this.ws = new WebSocket(url);

        this.ws.on('open', () => {
            console.log('Connected to MEXC WS');
            this.reconnectAttempts = 0;
            this.startPing();

            // Subscribe
            // Topic: spot@public.limit.depth.v3.api@{symbol}@{limit}
            const params = this.symbols.map(s => `spot@public.limit.depth.v3.api@${s}@20`);

            this.ws?.send(JSON.stringify({
                method: "SUBSCRIPTION",
                params: params
            }));
        });

        this.ws.on('message', (data: WebSocket.Data) => {
            try {
                const msg = JSON.parse(data.toString());

                // Pong logic if needed (MEXC responds to ping frame? or JSON ping?)
                // Actually MEXC uses standard ping/pong frames usually, but we implement JSON ping sometimes.
                if (msg.msg === 'PONG') return;

                // { "c": "spot@public.limit.depth.v3.api@BTCUSDT", "d": { "asks": [], "bids": [], "e": "spot.depth" ... }, "t": ... }
                if (msg.c && msg.d) {
                    const channelParts = msg.c.split('@');
                    // spot@public.limit.depth.v3.api@BTCUSDT@20
                    const symbol = channelParts[3]; // Check index: 0=spot, 1=public...

                    // Actually let's just use the symbol map key if possible or parse
                    // Index: 0=spot, 1=public.limit.depth.v3.api, 2=BTCUSDT, 3=20?
                    // Let's print one to debug if we weren't sure, but standard format is consistent.

                    const ob = this.orderBooks.get(symbol);
                    if (ob) {
                        ob.reset();

                        if (msg.d.bids) {
                            msg.d.bids.forEach((b: any) => ob.updateSide('bids', parseFloat(b.p), parseFloat(b.v)));
                        }
                        if (msg.d.asks) {
                            msg.d.asks.forEach((a: any) => ob.updateSide('asks', parseFloat(a.p), parseFloat(a.v)));
                        }
                    }
                }
            } catch (e) {
                console.error('MEXC WS Parse Error', e);
            }
        });

        this.ws.on('error', (err) => {
            console.error('MEXC WS Error', err);
            this.ws?.terminate();
        });

        this.ws.on('close', () => {
            console.log('MEXC WS Closed');
            this.stopPing();
            if (this.shouldReconnect) this.scheduleReconnect();
        });
    }

    private startPing() {
        this.pingInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ method: "PING" }));
            }
        }, 15000);
    }

    private stopPing() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    private scheduleReconnect() {
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectAttempts++;
        console.log(`Reconnecting to MEXC in ${delay}ms...`);
        setTimeout(() => this.connect(), delay);
    }
}

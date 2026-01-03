import WebSocket from 'ws';
import { OrderBook } from '../OrderBook';

export class BybitClient {
    private ws: WebSocket | null = null;
    public orderBooks: Map<string, OrderBook> = new Map();
    private reconnectAttempts = 0;
    private shouldReconnect = true;
    private pingInterval: NodeJS.Timeout | null = null;

    constructor(private symbols: string[]) {
        this.symbols.forEach(s => {
            this.orderBooks.set(s, new OrderBook(s));
        });
    }

    async connect() {
        const url = 'wss://stream.bybit.com/v5/public/spot';
        console.log(`Connecting to Bybit WS...`);
        this.ws = new WebSocket(url);

        this.ws.on('open', () => {
            console.log('Connected to Bybit WS');
            this.reconnectAttempts = 0;
            this.startPing();

            // Subscribe
            const args = this.symbols.map(s => `orderbook.50.${s.toUpperCase()}`);
            this.ws?.send(JSON.stringify({
                op: 'subscribe',
                args: args
            }));
        });

        this.ws.on('message', (data: WebSocket.Data) => {
            try {
                const msg = JSON.parse(data.toString());

                // Keep connection alive pong
                if (msg.op === 'pong') return;

                if (msg.topic && msg.type && msg.data) {
                    const topicParts = msg.topic.split('.');
                    const topicSymbol = topicParts[2];
                    const ob = this.orderBooks.get(topicSymbol);

                    if (!ob) return;

                    if (msg.type === 'snapshot') {
                        // Reset OB
                        ob.reset();
                        msg.data.b.forEach((b: any) => ob.updateSide('bids', parseFloat(b[0]), parseFloat(b[1])));
                        msg.data.a.forEach((a: any) => ob.updateSide('asks', parseFloat(a[0]), parseFloat(a[1])));
                        console.log(`Bybit Snapshot loaded for ${topicSymbol}`);
                    } else if (msg.type === 'delta') {
                        msg.data.b.forEach((b: any) => ob.updateSide('bids', parseFloat(b[0]), parseFloat(b[1])));
                        msg.data.a.forEach((a: any) => ob.updateSide('asks', parseFloat(a[0]), parseFloat(a[1])));
                    }
                }
            } catch (e) {
                console.error('Bybit WS Parse Error', e);
            }
        });

        this.ws.on('error', (err) => {
            console.error('Bybit WS Error', err);
            this.ws?.terminate();
        });

        this.ws.on('close', () => {
            console.log('Bybit WS Closed');
            this.stopPing();
            if (this.shouldReconnect) this.scheduleReconnect();
        });
    }

    private startPing() {
        this.pingInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ op: 'ping' }));
            }
        }, 20000);
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
        console.log(`Reconnecting to Bybit in ${delay}ms...`);
        setTimeout(() => this.connect(), delay);
    }
}

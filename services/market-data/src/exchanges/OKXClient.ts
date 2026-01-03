import WebSocket from 'ws';
import { OrderBook } from '../OrderBook';

export class OKXClient {
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
        const url = 'wss://ws.okx.com:8443/ws/v5/public';
        console.log(`Connecting to OKX WS...`);
        this.ws = new WebSocket(url);

        this.ws.on('open', () => {
            console.log('Connected to OKX WS');
            this.reconnectAttempts = 0;
            this.startPing();

            const args = this.symbols.map(s => ({
                channel: 'books',
                instId: s
            }));

            this.ws?.send(JSON.stringify({
                op: 'subscribe',
                args: args
            }));
        });

        this.ws.on('message', (data: WebSocket.Data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.event) return; // 'subscribe', 'error'

                if (msg.arg && msg.data && msg.data[0]) {
                    const symbol = msg.arg.instId;
                    const ob = this.orderBooks.get(symbol);
                    if (!ob) return;

                    const updateData = msg.data[0];

                    // OKX sends 'snapshot' initially, then 'update'
                    if (msg.action === 'snapshot') {
                        ob.reset();
                        updateData.bids.forEach((b: any) => ob.updateSide('bids', parseFloat(b[0]), parseFloat(b[1])));
                        updateData.asks.forEach((a: any) => ob.updateSide('asks', parseFloat(a[0]), parseFloat(a[1])));
                        console.log(`OKX Snapshot loaded for ${symbol}`);
                    } else if (msg.action === 'update') {
                        updateData.bids.forEach((b: any) => ob.updateSide('bids', parseFloat(b[0]), parseFloat(b[1])));
                        updateData.asks.forEach((a: any) => ob.updateSide('asks', parseFloat(a[0]), parseFloat(a[1])));
                    }
                }
            } catch (e) {
                console.error('OKX WS Parse Error', e);
            }
        });

        this.ws.on('error', (err) => {
            console.error('OKX WS Error', err);
            this.ws?.terminate();
        });

        this.ws.on('close', () => {
            console.log('OKX WS Closed');
            this.stopPing();
            if (this.shouldReconnect) this.scheduleReconnect();
        });
    }

    private startPing() {
        this.pingInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send('ping');
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
        console.log(`Reconnecting to OKX in ${delay}ms...`);
        setTimeout(() => this.connect(), delay);
    }
}

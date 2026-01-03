import WebSocket from 'ws';
import { OrderBook } from '../OrderBook';

export class GateClient {
    private ws: WebSocket | null = null;
    public orderBooks: Map<string, OrderBook> = new Map();
    private reconnectAttempts = 0;
    private shouldReconnect = true;
    private pingInterval: NodeJS.Timeout | null = null;

    constructor(private symbols: string[]) {
        this.symbols.forEach(s => {
            // Gate symbols are usually formatted as BTC_USDT
            this.orderBooks.set(s, new OrderBook(s));
        });
    }

    async connect() {
        // Gate.io V4 WebSocket URL
        const url = 'wss://api.gateio.ws/ws/v4/';
        console.log(`Connecting to Gate.io WS...`);
        this.ws = new WebSocket(url);

        this.ws.on('open', () => {
            console.log('Connected to Gate.io WS');
            this.reconnectAttempts = 0;
            this.startPing();

            // Subscribe to spot.order_book channel
            // Requesting 50 levels, updating every 100ms
            const payload = this.symbols.map(s => [s, "50", "100ms"]);
            // Gate.io requires separate payloads if strict, but let's try batch or separate
            // Actually Gate supports array of params in one subscribe
            // Payload format: [SYMBOL, LIMIT, INTERVAL]

            // We need to flatten or handle correctly. 
            // The docs say: "payload": ["BTC_USDT", "5", "1000ms"] for single
            // For multiple, we usually send multiple subscribe commands or check if it accepts list of lists.
            // For safety, let's subscribe individually or look up multi-support. 
            // Assuming we send one subscribe message with purely the payload for safety.
            // But wait, "payload" is an array of parameters for ONE subscription key.
            // If we want multiple symbols, we technically might need multiple subscribe calls or one call with multiple param sets?
            // "spot.order_book" supports multiple subscriptions.

            // Documentation: "payload": [ "BTC_USDT", "20", "100ms" ] is for ONE.
            // To subscribe multiple, we loop.

            this.symbols.forEach(s => {
                this.ws?.send(JSON.stringify({
                    time: Math.floor(Date.now() / 1000),
                    channel: "spot.order_book",
                    event: "subscribe",
                    payload: [s, "50", "100ms"]
                }));
            });
        });

        this.ws.on('message', (data: WebSocket.Data) => {
            try {
                const msg = JSON.parse(data.toString());

                // Pong or Ack
                if (msg.event === 'update' && msg.channel === 'spot.order_book') {
                    // msg.result contains { b: [[price, amt], ...], a: ... }
                    // This is a snapshot-like update because we requested "spot.order_book" limited depth
                    const result = msg.result;
                    const symbol = result.s || result.currency_pair; // Verify field name. Gate usually uses 's' or implicit?
                    // "result": { "t": 123.., "e": "spot.order_book", "s": "BTC_USDT", ... }

                    // Actually check `msg.result.s`
                    if (result && result.s) {
                        const ob = this.orderBooks.get(result.s);
                        if (ob) {
                            ob.reset();

                            // Bids
                            if (result.b) {
                                result.b.forEach((b: any) => ob.updateSide('bids', parseFloat(b[0]), parseFloat(b[1])));
                            }
                            // Asks
                            if (result.a) {
                                result.a.forEach((a: any) => ob.updateSide('asks', parseFloat(a[0]), parseFloat(a[1])));
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('Gate WS Parse Error', e);
            }
        });

        this.ws.on('error', (err) => {
            console.error('Gate WS Error', err);
            this.ws?.terminate();
        });

        this.ws.on('close', () => {
            console.log('Gate WS Closed');
            this.stopPing();
            if (this.shouldReconnect) this.scheduleReconnect();
        });
    }

    private startPing() {
        this.pingInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                // Gate.io ping
                this.ws.send(JSON.stringify({
                    time: Math.floor(Date.now() / 1000),
                    channel: "spot.ping",
                    event: "ping",
                    payload: []
                }));
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
        console.log(`Reconnecting to Gate in ${delay}ms...`);
        setTimeout(() => this.connect(), delay);
    }
}

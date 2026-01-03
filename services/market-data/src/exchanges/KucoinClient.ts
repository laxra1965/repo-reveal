import WebSocket from 'ws';
import { OrderBook } from '../OrderBook';

export class KucoinClient {
    private ws: WebSocket | null = null;
    public orderBooks: Map<string, OrderBook> = new Map();
    private reconnectAttempts = 0;
    private shouldReconnect = true;
    private pingInterval: NodeJS.Timeout | null = null;

    constructor(private symbols: string[]) {
        this.symbols.forEach(s => {
            // Kucoin format: BTC-USDT
            this.orderBooks.set(s, new OrderBook(s));
        });
    }

    async connect() {
        try {
            console.log('Fetching Kucoin WS Token...');
            const resp = await fetch('https://api.kucoin.com/api/v1/bullet-public', {
                method: 'POST'
            });
            const json: any = await resp.json();

            if (json.code !== '200000' || !json.data || !json.data.token) {
                throw new Error('Failed to get Kucoin bullet token');
            }

            const token = json.data.token;
            const endpoint = json.data.instanceServers[0].endpoint;
            const wsUrl = `${endpoint}?token=${token}`;

            console.log(`Connecting to Kucoin WS...`);
            this.ws = new WebSocket(wsUrl);

            this.ws.on('open', () => {
                console.log('Connected to Kucoin WS');
                this.reconnectAttempts = 0;
                this.startPing();

                // Subscribe
                // Topic: /spotMarket/level2Depth50:BTC-USDT,ETH-USDT
                const topic = `/spotMarket/level2Depth50:${this.symbols.join(',')}`;

                this.ws?.send(JSON.stringify({
                    id: Date.now(),
                    type: 'subscribe',
                    topic: topic,
                    response: true
                }));
            });

            this.ws.on('message', (data: WebSocket.Data) => {
                try {
                    const msg = JSON.parse(data.toString());

                    if (msg.type === 'message' && msg.topic.includes('/spotMarket/level2Depth50')) {
                        // msg.data: { bids: [["price", "size"], ...], asks: ... }
                        // format check: "subject": "level2"
                        // Topic has symbol? "topic": "/spotMarket/level2Depth50:BTC-USDT"

                        const topicParts = msg.topic.split(':');
                        const symbol = topicParts[1];

                        // If multi-symbol string was passed in topic, msg.topic might be specific?
                        // Actually Kucoin sends messages per symbol topic even if subscribed in batch?
                        // Yes typically. 

                        const ob = this.orderBooks.get(symbol);
                        if (ob && msg.data) {
                            ob.reset();

                            if (msg.data.bids) {
                                msg.data.bids.forEach((b: any) => ob.updateSide('bids', parseFloat(b[0]), parseFloat(b[1])));
                            }
                            if (msg.data.asks) {
                                msg.data.asks.forEach((a: any) => ob.updateSide('asks', parseFloat(a[0]), parseFloat(a[1])));
                            }
                        }
                    }
                } catch (e) {
                    console.error('Kucoin WS Parse Error', e);
                }
            });

            this.ws.on('error', (err) => {
                console.error('Kucoin WS Error', err);
                this.ws?.terminate();
            });

            this.ws.on('close', () => {
                console.log('Kucoin WS Closed');
                this.stopPing();
                if (this.shouldReconnect) this.scheduleReconnect();
            });

        } catch (e) {
            console.error('Kucoin Connection Failed', e);
            this.scheduleReconnect();
        }
    }

    private startPing() {
        this.pingInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    id: Date.now(),
                    type: 'ping'
                }));
            }
        }, 30000); // 30s is safe for Kucoin
    }

    private stopPing() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    private scheduleReconnect() {
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60000);
        this.reconnectAttempts++;
        console.log(`Reconnecting to Kucoin in ${delay}ms...`);
        setTimeout(() => this.connect(), delay);
    }
}

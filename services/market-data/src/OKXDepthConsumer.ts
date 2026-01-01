
import WebSocket from 'ws';
import { OrderBook } from './OrderBook';
import Redis from 'ioredis';

export class OKXDepthConsumer {
    private ws!: WebSocket;
    private ob: OrderBook;
    private redis: Redis;

    constructor(private symbol: string, redisInstance?: Redis) {
        // OKX uses BTC-USDT format
        this.ob = new OrderBook(symbol);
        this.redis = redisInstance || new Redis();
    }

    async start() {
        this.connectWS();
    }

    private connectWS() {
        this.ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');

        this.ws.on('open', () => {
            console.log(`[OKX ${this.symbol}] WS Connected`);
            this.ws.send(JSON.stringify({
                op: 'subscribe',
                args: [{
                    channel: 'books',
                    instId: this.symbol
                }]
            }));

            // Heartbeat
            setInterval(() => {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send('ping');
                }
            }, 20000);
        });

        this.ws.on('message', (raw) => {
            try {
                const rawStr = raw.toString();
                if (rawStr === 'pong') return;

                const msg = JSON.parse(rawStr);
                if (msg.event === 'subscribe' && msg.arg.channel === 'books') {
                    console.log(`[OKX ${this.symbol}] Subscribed to ${this.symbol}`);
                    return;
                }

                if (!msg.data || msg.arg.channel !== 'books') return;

                const data = msg.data[0];
                const action = msg.action; // 'snapshot' or 'update'

                // OKX bids/asks are [price, size, numOrders, totalSize]
                const normalize = (levels: any[][]) => levels.map(l => [Number(l[0]), Number(l[1])] as [number, number]);

                if (action === 'snapshot') {
                    this.ob.applySnapshot(normalize(data.bids), normalize(data.asks));
                    this.publish();
                } else if (action === 'update') {
                    this.ob.applyDelta(normalize(data.bids), normalize(data.asks));
                    this.publish();
                }
            } catch (e) {
                console.error(`[OKX ${this.symbol}] Message error`, e);
            }
        });

        this.ws.on('close', () => {
            console.warn(`[OKX ${this.symbol}] WS closed, reconnecting...`);
            setTimeout(() => this.connectWS(), 1000);
        });

        this.ws.on('error', (err) => {
            console.error(`[OKX ${this.symbol}] WS Error`, err);
            this.ws.terminate();
        });
    }

    private publish() {
        this.redis.publish(
            `depth:okx:${this.symbol}`,
            JSON.stringify({
                symbol: this.symbol,
                bids: this.ob.bids,
                asks: this.ob.asks,
                timestamp: this.ob.timestamp
            })
        );
    }
}

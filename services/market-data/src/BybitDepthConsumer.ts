
import WebSocket from 'ws';
import { OrderBook } from './OrderBook';
import Redis from 'ioredis';

export class BybitDepthConsumer {
    private ws!: WebSocket;
    private ob: OrderBook;
    private lastSeq = 0;
    private redis: Redis;

    constructor(private symbol: string, redisInstance?: Redis) {
        this.ob = new OrderBook(symbol);
        this.redis = redisInstance || new Redis();
    }

    async start() {
        this.connectWS();
    }

    private connectWS() {
        const topic = `orderbook.50.${this.symbol.toUpperCase()}`;
        // Bybit V5 Public Spot WebSocket
        this.ws = new WebSocket('wss://stream.bybit.com/v5/public/spot');

        this.ws.on('open', () => {
            console.log(`[Bybit ${this.symbol}] WS Connected`);
            this.ws.send(JSON.stringify({
                op: 'subscribe',
                args: [topic]
            }));

            // Heartbeat every 20s
            const pingInterval = setInterval(() => {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ op: 'ping' }));
                } else {
                    clearInterval(pingInterval);
                }
            }, 20000);
        });

        this.ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());

                // Handle pong
                if (msg.op === 'pong' || (msg.ret_msg === 'pong')) return;

                // Handle subscription success
                if (msg.op === 'subscribe' && msg.success) {
                    console.log(`[Bybit ${this.symbol}] Subscribed to ${topic}`);
                    return;
                }

                if (msg.topic !== topic) return;

                const data = msg.data;
                const type = msg.type; // 'snapshot' or 'delta'

                if (type === 'snapshot') {
                    this.lastSeq = msg.data.seq;
                    this.ob.applySnapshot(data.b, data.a);
                    this.publish();
                } else if (type === 'delta') {
                    // Sequence check for Bybit V5
                    if (this.lastSeq > 0 && msg.data.seq !== this.lastSeq + 1) {
                        console.warn(`[Bybit ${this.symbol}] Sequence gap detected (${msg.data.seq} != ${this.lastSeq + 1}), resyncing...`);
                        this.ws.close();
                        // Reconnection handled by 'close' listener
                        return;
                    }
                    this.lastSeq = msg.data.seq;
                    this.ob.applyDelta(data.b, data.a);
                    this.publish();
                }
            } catch (e) {
                console.error(`[Bybit ${this.symbol}] Message error`, e);
            }
        });

        this.ws.on('close', () => {
            console.warn(`[Bybit ${this.symbol}] WS closed, reconnecting...`);
            setTimeout(() => this.connectWS(), 1000);
        });

        this.ws.on('error', (err) => {
            console.error(`[Bybit ${this.symbol}] WS Error`, err);
            this.ws.terminate();
        });
    }

    private publish() {
        this.redis.publish(
            `depth:bybit:${this.symbol}`,
            JSON.stringify({
                symbol: this.symbol,
                bids: this.ob.bids,
                asks: this.ob.asks,
                timestamp: this.ob.timestamp
            })
        );
    }

    getOrderBook() {
        return this.ob;
    }
}

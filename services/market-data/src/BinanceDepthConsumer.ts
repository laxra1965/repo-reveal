import WebSocket from 'ws';
import fetch from 'node-fetch';
import Redis from 'ioredis';

export class BinanceDepthConsumer {
    private ws!: WebSocket;
    private lastUpdateId = 0;
    private symbol: string;
    private redis: Redis;

    constructor(symbol: string, redisInstance?: Redis) {
        this.symbol = symbol;
        this.redis = redisInstance || new Redis();
    }

    async start() {
        await this.loadSnapshot();
        this.connectWS();
    }

    private async loadSnapshot() {
        try {
            const res = await fetch(
                `https://api.binance.com/api/v3/depth?symbol=${this.symbol.toUpperCase()}&limit=1000`
            );
            const snap = await res.json() as any;

            this.lastUpdateId = snap.lastUpdateId;

            console.log(`[${this.symbol}] Snapshot loaded @ ${this.lastUpdateId}`);

            this.redis.publish(
                `depth:binance:${this.symbol}`,
                JSON.stringify({
                    type: 'snapshot',
                    symbol: this.symbol,
                    bids: snap.bids,
                    asks: snap.asks,
                    lastUpdateId: this.lastUpdateId,
                    timestamp: Date.now()
                })
            );
        } catch (e) {
            console.error(`[${this.symbol}] Snapshot failed`, e);
            setTimeout(() => this.start(), 2000);
        }
    }

    private connectWS() {
        this.ws = new WebSocket(
            `wss://stream.binance.com:9443/ws/${this.symbol.toLowerCase()}@depth@100ms`
        );

        this.ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());

                if (msg.u <= this.lastUpdateId) return;

                // Gap detection: If not first event and gap found
                if (this.lastUpdateId > 0 && msg.U > this.lastUpdateId + 1) {
                    console.warn(`[${this.symbol}] Sequence gap detected (${msg.U} > ${this.lastUpdateId + 1}), resyncing...`);
                    this.ws.close();
                    this.start();
                    return;
                }

                this.lastUpdateId = msg.u;

                this.redis.publish(
                    `depth:binance:${this.symbol}`,
                    JSON.stringify({
                        type: 'delta',
                        symbol: this.symbol,
                        bids: msg.b,
                        asks: msg.a,
                        u: msg.u,
                        U: msg.U,
                        timestamp: Date.now()
                    })
                );
            } catch (e) {
                console.error(`[${this.symbol}] WS Message error`, e);
            }
        });

        this.ws.on('close', () => {
            console.warn(`[${this.symbol}] WS closed, reconnecting...`);
            setTimeout(() => this.connectWS(), 1000);
        });

        this.ws.on('error', (err) => {
            console.error(`[${this.symbol}] WS Error`, err);
            this.ws?.terminate();
        });
    }
}

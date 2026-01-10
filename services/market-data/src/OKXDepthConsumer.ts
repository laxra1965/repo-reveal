import fetch from 'node-fetch';
import Redis from 'ioredis';
import WebSocket from 'ws';

export class OKXDepthConsumer {
    private ws: WebSocket | null = null;
    private symbol: string;
    private redis: Redis;

    // OKX uses timestamp-based sequencing
    private snapshotInProgress = false;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private reconnectDelay = 1000;

    constructor(symbol: string, redisInstance?: Redis) {
        this.symbol = symbol;
        this.redis = redisInstance || new Redis();
    }

    async start() {
        if (this.snapshotInProgress) return;
        await this.loadSnapshot();
        this.connectWS();
    }

    // =========================
    // SNAPSHOT
    // =========================
    private async loadSnapshot() {
        this.snapshotInProgress = true;

        try {
            const res = await fetch(
                `https://www.okx.com/api/v5/market/books?instId=${this.symbol}&sz=400`
            );
            const json = await res.json();

            const book = json?.data?.[0];
            if (!book) throw new Error('Invalid OKX snapshot');

            console.log(`[OKX ${this.symbol}] Snapshot loaded`);

            await this.redis.publish(
                `depth:okx:${this.symbol}`,
                JSON.stringify({
                    type: 'snapshot',
                    exchange: 'okx',
                    symbol: this.symbol,
                    bids: book.bids,
                    asks: book.asks,
                    timestamp: Date.now()
                })
            );

            this.reconnectDelay = 1000;
        } catch (e) {
            console.error(`[OKX ${this.symbol}] Snapshot failed`, e);
            this.scheduleReconnect();
        } finally {
            this.snapshotInProgress = false;
        }
    }

    // =========================
    // WEBSOCKET
    // =========================
    private connectWS() {
        if (this.ws) return;

        this.ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');

        this.ws.on('open', () => {
            console.log(`[OKX ${this.symbol}] WS Connected`);

            this.ws?.send(
                JSON.stringify({
                    op: 'subscribe',
                    args: [
                        {
                            channel: 'books',
                            instId: this.symbol
                        }
                    ]
                })
            );
        });

        this.ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());

                if (!msg?.data?.[0]) return;

                const data = msg.data[0];

                // OKX sends full refresh or partial updates
                const type = data.action === 'snapshot' ? 'snapshot' : 'delta';

                this.redis.publish(
                    `depth:okx:${this.symbol}`,
                    JSON.stringify({
                        type,
                        exchange: 'okx',
                        symbol: this.symbol,
                        bids: data.bids || [],
                        asks: data.asks || [],
                        timestamp: Date.now()
                    })
                );
            } catch (e) {
                console.error(`[OKX ${this.symbol}] WS message error`, e);
            }
        });

        this.ws.on('close', () => {
            console.warn(`[OKX ${this.symbol}] WS closed`);
            this.cleanupWS();
            this.scheduleReconnect();
        });

        this.ws.on('error', (err) => {
            console.error(`[OKX ${this.symbol}] WS error`, err);
            this.cleanupWS();
            this.scheduleReconnect();
        });
    }

    // =========================
    // RECONNECT CONTROL
    // =========================
    private cleanupWS() {
        if (this.ws) {
            try {
                this.ws.terminate();
            } catch {}
            this.ws = null;
        }
    }

    private scheduleReconnect() {
        if (this.reconnectTimer) return;

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.start();
        }, this.reconnectDelay);

        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
    }
}


import fetch from 'node-fetch';
import Redis from 'ioredis';
import WebSocket from 'ws';

export class GateDepthConsumer {
    private ws: WebSocket | null = null;
    private symbol: string;
    private redis: Redis;

    private snapshotInProgress = false;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private reconnectDelay = 1000; // 1s  backoff
    private lastUpdateId = 0;

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
                `https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${this.symbol}&limit=100`
            );

            const snap = await res.json() as any;

            this.lastUpdateId = Number(snap.id);

            console.log(`[Gate ${this.symbol}] Snapshot loaded @ ${this.lastUpdateId}`);

            await this.redis.publish(
                `depth:gate:${this.symbol}`,
                JSON.stringify({
                    type: 'snapshot',
                    exchange: 'gate',
                    symbol: this.symbol,
                    bids: snap.bids,
                    asks: snap.asks,
                    lastUpdateId: this.lastUpdateId,
                    timestamp: Date.now()
                })
            );

            this.reconnectDelay = 1000;
        } catch (e) {
            console.error(`[Gate ${this.symbol}] Snapshot failed`, e);
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

        this.ws = new WebSocket('wss://api.gateio.ws/ws/v4/');

        this.ws.on('open', () => {
            console.log(`[Gate ${this.symbol}] WS Connected`);

            this.ws?.send(
                JSON.stringify({
                    time: Date.now(),
                    channel: 'spot.order_book_update',
                    event: 'subscribe',
                    payload: [this.symbol, '100ms']
                })
            );
        });

        this.ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());

                if (!msg.result || !msg.result.id) return;

                const updateId = Number(msg.result.id);

                // ignore old updates
                if (updateId <= this.lastUpdateId) return;

                // GAP DETECTION
                if (this.lastUpdateId && updateId !== this.lastUpdateId + 1) {
                    console.warn(
                        `[Gate ${this.symbol}] Gap detected (${updateId} != ${this.lastUpdateId + 1})  resync`
                    );
                    this.forceResync();
                    return;
                }

                this.lastUpdateId = updateId;

                this.redis.publish(
                    `depth:gate:${this.symbol}`,
                    JSON.stringify({
                        type: 'delta',
                        exchange: 'gate',
                        symbol: this.symbol,
                        bids: msg.result.b,
                        asks: msg.result.a,
                        lastUpdateId: updateId,
                        timestamp: Date.now()
                    })
                );
            } catch (e) {
                console.error(`[Gate ${this.symbol}] WS message error`, e);
            }
        });

        this.ws.on('close', () => {
            console.warn(`[Gate ${this.symbol}] WS closed`);
            this.cleanupWS();
            this.scheduleReconnect();
        });

        this.ws.on('error', (err) => {
            console.error(`[Gate ${this.symbol}] WS error`, err);
            this.cleanupWS();
            this.scheduleReconnect();
        });
    }

    // =========================
    // RESYNC / RECONNECT
    // =========================
    private forceResync() {
        this.cleanupWS();
        this.lastUpdateId = 0;
        this.start();
    }

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


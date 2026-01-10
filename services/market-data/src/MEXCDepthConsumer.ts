import fetch from 'node-fetch';
import Redis from 'ioredis';
import WebSocket from 'ws';

export class MEXCDepthConsumer {
    private ws: WebSocket | null = null;
    private symbol: string;
    private redis: Redis;

    private snapshotInProgress = false;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private reconnectDelay = 1000;

    private lastVersion = 0;

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
                `https://api.mexc.com/api/v3/depth?symbol=${this.symbol}&limit=1000`
            );

            const snap = await res.json();

            this.lastVersion = snap.lastUpdateId;

            console.log(`[MEXC ${this.symbol}] Snapshot loaded @ ${this.lastVersion}`);

            await this.redis.publish(
                `depth:mexc:${this.symbol}`,
                JSON.stringify({
                    type: 'snapshot',
                    symbol: this.symbol,
                    bids: snap.bids,
                    asks: snap.asks,
                    lastUpdateId: this.lastVersion,
                    timestamp: Date.now()
                })
            );

            this.reconnectDelay = 1000;
        } catch (e) {
            console.error(`[MEXC ${this.symbol}] Snapshot failed`, e);
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

        this.ws = new WebSocket(
            `wss://wbs.mexc.com/ws`
        );

        this.ws.on('open', () => {
            this.ws!.send(JSON.stringify({
                method: 'SUBSCRIPTION',
                params: [`spot@public.depth.v3.api@${this.symbol}@100ms`]
            }));
        });

        this.ws.on('message', (raw) => {
            const msg = JSON.parse(raw.toString());
            if (!msg.d) return;

            const { u, b, a } = msg.d;

            if (u <= this.lastVersion) return;

            if (this.lastVersion && u > this.lastVersion + 1) {
                console.warn(`[MEXC ${this.symbol}] Gap detected  resync`);
                this.forceResync();
                return;
            }

            this.lastVersion = u;

            this.redis.publish(
                `depth:mexc:${this.symbol}`,
                JSON.stringify({
                    type: 'delta',
                    symbol: this.symbol,
                    bids: b,
                    asks: a,
                    u,
                    timestamp: Date.now()
                })
            );
        });

        this.ws.on('close', () => {
            console.warn(`[MEXC ${this.symbol}] WS closed`);
            this.cleanupWS();
            this.scheduleReconnect();
        });

        this.ws.on('error', (err) => {
            console.error(`[MEXC ${this.symbol}] WS error`, err);
            this.cleanupWS();
            this.scheduleReconnect();
        });
    }

    // =========================
    // RECONNECT CONTROL
    // =========================
    private forceResync() {
        this.cleanupWS();
        this.lastVersion = 0;
        this.start();
    }

    private cleanupWS() {
        if (this.ws) {
            try { this.ws.terminate(); } catch {}
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


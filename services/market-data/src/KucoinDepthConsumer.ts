import fetch from 'node-fetch';
import Redis from 'ioredis';
import WebSocket from 'ws';

export class KucoinDepthConsumer {
    private ws: WebSocket | null = null;
    private symbol: string;
    private redis: Redis;

    private snapshotInProgress = false;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private reconnectDelay = 1000;

    private lastSequence = 0;
    private wsEndpoint = '';
    private wsToken = '';

    constructor(symbol: string, redisInstance?: Redis) {
        this.symbol = symbol;
        this.redis = redisInstance || new Redis();
    }

    async start() {
        if (this.snapshotInProgress) return;
        await this.loadSnapshot();
        await this.connectWS();
    }

    // =========================
    // SNAPSHOT
    // =========================
    private async loadSnapshot() {
        this.snapshotInProgress = true;

        try {
            const res = await fetch(
                `https://api.kucoin.com/api/v1/market/orderbook/level2?symbol=${this.symbol}`
            );

            const json = await res.json();
            const snap = json.data;

            this.lastSequence = snap.sequence;

            console.log(`[KuCoin ${this.symbol}] Snapshot loaded @ ${this.lastSequence}`);

            await this.redis.publish(
                `depth:kucoin:${this.symbol}`,
                JSON.stringify({
                    type: 'snapshot',
                    symbol: this.symbol,
                    bids: snap.bids,
                    asks: snap.asks,
                    sequence: this.lastSequence,
                    timestamp: Date.now()
                })
            );

            this.reconnectDelay = 1000;
        } catch (e) {
            console.error(`[KuCoin ${this.symbol}] Snapshot failed`, e);
            this.scheduleReconnect();
        } finally {
            this.snapshotInProgress = false;
        }
    }

    // =========================
    // WEBSOCKET
    // =========================
    private async connectWS() {
        if (this.ws) return;

        try {
            const res = await fetch('https://api.kucoin.com/api/v1/bullet-public');
            const json = await res.json();

            this.wsToken = json.data.token;
            const server = json.data.instanceServers[0];
            this.wsEndpoint = `${server.endpoint}?token=${this.wsToken}`;

            this.ws = new WebSocket(this.wsEndpoint);

            this.ws.on('open', () => {
                this.ws!.send(JSON.stringify({
                    id: Date.now(),
                    type: 'subscribe',
                    topic: `/market/level2:${this.symbol}`,
                    response: true
                }));
            });

            this.ws.on('message', (raw) => {
                const msg = JSON.parse(raw.toString());
                if (!msg.data) return;

                const { sequenceStart, sequenceEnd, changes } = msg.data;

                if (sequenceStart > this.lastSequence + 1) {
                    console.warn(`[KuCoin ${this.symbol}] Gap detected  resync`);
                    this.forceResync();
                    return;
                }

                this.lastSequence = sequenceEnd;

                this.redis.publish(
                    `depth:kucoin:${this.symbol}`,
                    JSON.stringify({
                        type: 'delta',
                        symbol: this.symbol,
                        bids: changes.bids,
                        asks: changes.asks,
                        sequence: sequenceEnd,
                        timestamp: Date.now()
                    })
                );
            });

            this.ws.on('close', () => {
                console.warn(`[KuCoin ${this.symbol}] WS closed`);
                this.cleanupWS();
                this.scheduleReconnect();
            });

            this.ws.on('error', (err) => {
                console.error(`[KuCoin ${this.symbol}] WS error`, err);
                this.cleanupWS();
                this.scheduleReconnect();
            });

        } catch (e) {
            console.error(`[KuCoin ${this.symbol}] WS init failed`, e);
            this.scheduleReconnect();
        }
    }

    // =========================
    // RECONNECT CONTROL
    // =========================
    private forceResync() {
        this.cleanupWS();
        this.lastSequence = 0;
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


import Redis from "ioredis";
import WebSocket from "ws";

interface BybitDelta {
    u: number;
    pu: number;
    b: [string, string][];
    a: [string, string][];
}

export class BybitDepthConsumer {
    private ws: WebSocket | null = null;
    private readonly wsUrl = "wss://stream.bybit.com/v5/public/spot";

    private readonly symbol: string;
    private readonly redis: Redis;

    private lastUpdateId = 0;

    // safety
    private snapshotInProgress = false;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private reconnectDelay = 1000;

    constructor(symbol: string, redis?: Redis) {
        this.symbol = symbol;
        this.redis = redis || new Redis();
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
                `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${this.symbol}&limit=50`
            );

            const json: any = await res.json();
            const data = json?.result;

            if (!data?.u) throw new Error("Invalid snapshot");

            this.lastUpdateId = Number(data.u);

            console.log(`[Bybit ${this.symbol}] Snapshot loaded @ ${this.lastUpdateId}`);

            await this.redis.publish(
                `depth:bybit:${this.symbol}`,
                JSON.stringify({
                    type: "snapshot",
                    exchange: "bybit",
                    symbol: this.symbol,
                    bids: data.b,
                    asks: data.a,
                    u: this.lastUpdateId,
                    timestamp: Date.now()
                })
            );

            this.reconnectDelay = 1000;
        } catch (e) {
            console.error(`[Bybit ${this.symbol}] Snapshot failed`, e);
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

        const ws = new WebSocket(this.wsUrl);
        this.ws = ws;

        ws.on("open", () => {
            console.log(`[Bybit ${this.symbol}] WS Connected`);
            ws.send(JSON.stringify({
                op: "subscribe",
                args: [`orderbook.50.${this.symbol}`]
            }));
        });

        ws.on("message", (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                const data: BybitDelta | undefined = msg?.data;

                if (!data || typeof data.u !== "number") return;

                // accept monotonic updates only
                if (data.u <= this.lastUpdateId) return;

                this.lastUpdateId = data.u;

                this.redis.publish(
                    `depth:bybit:${this.symbol}`,
                    JSON.stringify({
                        type: "delta",
                        exchange: "bybit",
                        symbol: this.symbol,
                        bids: data.b,
                        asks: data.a,
                        u: data.u,
                        pu: data.pu,
                        timestamp: Date.now()
                    })
                );
            } catch (e) {
                console.error(`[Bybit ${this.symbol}] WS message error`, e);
            }
        });

        ws.on("close", () => {
            console.warn(`[Bybit ${this.symbol}] WS closed`);
            this.cleanupWS();
            this.scheduleReconnect();
        });

        ws.on("error", (err) => {
            console.error(`[Bybit ${this.symbol}] WS error`, err);
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


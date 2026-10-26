import { BaseExchangeSync, DepthUpdate } from './base-sync.ts';

export class MexcSync extends BaseExchangeSync {
    constructor(symbols: string[]) {
        super('mexc', symbols, 'wss://wbs.mexc.com/ws');
    }

    protected onConnect() {
        const params = this.symbols.map(s => `spot@public.limit.depth.v3.api@${s}@20`);
        this.ws?.send(JSON.stringify({
            method: "SUBSCRIPTION",
            params: params,
            id: 1
        }));

        this.symbols.forEach(s => this.syncSnapshot(s));
    }

    protected startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ method: "PING" }));
            }
        }, 30000);
    }

    protected async handleMessage(msg: any) {
        if (msg.c?.includes('spot@public.limit.depth.v3.api')) {
            const symbol = msg.s;
            if (this.isSyncing.get(symbol)) {
                this.messageBuffer.get(symbol)?.push(msg.d);
            } else {
                await this.processUpdate(symbol, msg.d);
            }
        }
    }

    protected async processUpdate(symbol: string, data: any) {
        const update: DepthUpdate = {
            symbol: symbol,
            bids: data.bids.map((b: any) => [parseFloat(b[0]), parseFloat(b[1])]),
            asks: data.asks.map((a: any) => [parseFloat(a[0]), parseFloat(a[1])]),
            timestamp: Date.now(),
            sequence: data.r // MEXC sequence
        };

        await this.applyUpdate(symbol, update);
    }
}

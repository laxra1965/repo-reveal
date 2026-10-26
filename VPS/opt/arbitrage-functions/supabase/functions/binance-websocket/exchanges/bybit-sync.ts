import { BaseExchangeSync, DepthUpdate } from './base-sync.ts';

export class BybitSync extends BaseExchangeSync {
    constructor(symbols: string[]) {
        super('bybit', symbols, 'wss://stream.bybit.com/v5/public/spot');
    }

    protected onConnect() {
        const args = this.symbols.map(s => `orderbook.50.${s}`);
        this.ws?.send(JSON.stringify({
            op: "subscribe",
            args: args
        }));

        this.symbols.forEach(s => this.syncSnapshot(s));
    }

    protected startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ op: "ping" }));
            }
        }, 20000);
    }

    protected async handleMessage(msg: any) {
        if (msg.topic?.startsWith('orderbook.')) {
            const symbol = msg.data.s;
            if (this.isSyncing.get(symbol)) {
                this.messageBuffer.get(symbol)?.push(msg.data);
            } else {
                await this.processUpdate(symbol, msg.data);
            }
        }
    }

    protected async processUpdate(symbol: string, data: any) {
        const update: DepthUpdate = {
            symbol: symbol,
            bids: data.b.map((b: any) => [parseFloat(b[0]), parseFloat(b[1])]),
            asks: data.a.map((a: any) => [parseFloat(a[0]), parseFloat(a[1])]),
            timestamp: Date.now(),
            sequence: data.u // Bybit sequence
        };

        await this.applyUpdate(symbol, update);
    }
}

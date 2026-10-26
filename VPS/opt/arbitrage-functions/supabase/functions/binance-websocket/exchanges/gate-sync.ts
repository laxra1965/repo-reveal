import { BaseExchangeSync, DepthUpdate } from './base-sync.ts';

export class GateSync extends BaseExchangeSync {
    constructor(symbols: string[]) {
        super('gate', symbols, 'wss://api.gateio.ws/ws/v4/');
    }

    protected onConnect() {
        this.symbols.forEach(s => {
            this.ws?.send(JSON.stringify({
                time: Math.floor(Date.now() / 1000),
                channel: "spot.order_book_update",
                event: "subscribe",
                payload: [this._formatSymbol(s), "100ms"]
            }));
            this.syncSnapshot(s);
        });
    }

    protected async handleMessage(msg: any) {
        if (msg.channel === 'spot.order_book_update' && msg.event === 'update') {
            const symbol = msg.result.s.replace("_", "");
            if (this.isSyncing.get(symbol)) {
                this.messageBuffer.get(symbol)?.push(msg.result);
            } else {
                await this.processUpdate(symbol, msg.result);
            }
        }
    }

    protected async processUpdate(symbol: string, data: any) {
        const update: DepthUpdate = {
            symbol: symbol,
            bids: data.b.map((b: any) => [parseFloat(b[0]), parseFloat(b[1])]),
            asks: data.a.map((a: any) => [parseFloat(a[0]), parseFloat(a[1])]),
            timestamp: Date.now(),
            sequence: data.u // Gate sequence
        };

        await this.applyUpdate(symbol, update);
    }

    private _formatSymbol(symbol: string): string {
        // BTCUSDT -> BTC_USDT
        return symbol.replace(/([A-Z]+)(USDT|BTC|ETH|BNB)$/, '$1_$2');
    }
}

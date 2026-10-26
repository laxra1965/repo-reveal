import { BaseExchangeSync, DepthUpdate } from './base-sync.ts';
import { logError } from '../../utils/logger.ts';

export class KuCoinSync extends BaseExchangeSync {
    private token: string = '';
    private instanceId: string = '';

    constructor(symbols: string[]) {
        // Initial dummy URL, will be updated after fetching token
        super('kucoin', symbols, '');
    }

    async connect() {
        try {
            const response = await fetch('https://api.kucoin.com/api/v1/bullet-public', { method: 'POST' });
            const data = await response.json();
            if (data.code === '200000') {
                const server = data.data.instanceServers[0];
                this.token = data.data.token;
                this.wsUrl = `${server.endpoint}?token=${this.token}`;
                await super.connect();
            } else {
                throw new Error(data.msg);
            }
        } catch (error) {
            logError('kucoin-ws', 'Failed to get WebSocket token', { error });
            setTimeout(() => this.connect(), 5000);
        }
    }

    protected onConnect() {
        const topics = this.symbols.map(s => `/market/level2:${this._formatSymbol(s)}`).join(',');
        this.ws?.send(JSON.stringify({
            id: Date.now(),
            type: "subscribe",
            topic: topics,
            privateChannel: false,
            response: true
        }));

        this.symbols.forEach(s => this.syncSnapshot(s));
    }

    protected startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    id: Date.now(),
                    type: "ping"
                }));
            }
        }, 18000);
    }

    protected async handleMessage(msg: any) {
        if (msg.type === 'message' && msg.topic?.includes('/market/level2:')) {
            const symbol = msg.topic.split(":")[1].replace("-", "");
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
            bids: data.changes.bids.map((b: any) => [parseFloat(b[0]), parseFloat(b[1])]),
            asks: data.changes.asks.map((a: any) => [parseFloat(a[0]), parseFloat(a[1])]),
            timestamp: Date.now(),
            sequence: data.sequenceEnd // KuCoin sequence
        };

        await this.applyUpdate(symbol, update);
    }

    private _formatSymbol(symbol: string): string {
        // BTCUSDT -> BTC-USDT
        return symbol.replace(/([A-Z]+)(USDT|BTC|ETH|BNB)$/, '$1-$2');
    }
}

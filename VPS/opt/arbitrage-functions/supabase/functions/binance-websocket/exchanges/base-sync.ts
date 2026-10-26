import { logInfo, logError } from '../../utils/logger.ts';
import { orderBookEngine } from '../../utils/order-book-engine.ts';

export type DepthUpdate = {
    symbol: string;
    bids: [number, number][];
    asks: [number, number][];
    timestamp: number;
    sequence: number;
};

export abstract class BaseExchangeSync {
    protected ws: WebSocket | null = null;
    protected messageBuffer: Map<string, any[]> = new Map();
    protected isSyncing: Map<string, boolean> = new Map();
    protected heartbeatTimer: number | null = null;

    constructor(
        protected exchange: string,
        protected symbols: string[],
        protected wsUrl: string
    ) {}

    async connect() {
        logInfo(`${this.exchange}-ws`, `Connecting to ${this.exchange} WebSocket...`);
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
            logInfo(`${this.exchange}-ws`, 'WebSocket connected');
            this.onConnect();
            this.startHeartbeat();
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (error) {
                logError(`${this.exchange}-ws`, 'Error parsing message', { error });
            }
        };

        this.ws.onclose = () => {
            logInfo(`${this.exchange}-ws`, 'WebSocket closed, reconnecting...');
            this.stopHeartbeat();
            setTimeout(() => this.connect(), 2000);
        };

        this.ws.onerror = (error) => {
            logError(`${this.exchange}-ws`, 'WebSocket error', { error });
            this.ws?.close();
        };
    }

    protected abstract onConnect(): void;
    protected abstract handleMessage(data: any): void;
    
    protected startHeartbeat() {}
    protected stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    protected async syncSnapshot(symbol: string) {
        try {
            this.isSyncing.set(symbol, true);
            this.messageBuffer.set(symbol, []);
            
            logInfo(`${this.exchange}-ws`, `Fetching snapshot for ${symbol}...`);
            const book = await orderBookEngine.fetchOrderBook(this.exchange, symbol, false);
            
            if (book) {
                logInfo(`${this.exchange}-ws`, `Snapshot synced for ${symbol} at sequence ${book.sequence}`);
                this.isSyncing.set(symbol, false);
                
                const buffer = this.messageBuffer.get(symbol) || [];
                for (const msg of buffer) {
                    await this.processUpdate(symbol, msg);
                }
                this.messageBuffer.set(symbol, []);
            }
        } catch (error) {
            logError(`${this.exchange}-ws`, `Failed to sync snapshot for ${symbol}`, { error });
            setTimeout(() => this.syncSnapshot(symbol), 5000);
        }
    }

    protected abstract processUpdate(symbol: string, data: any): Promise<void>;

    protected async applyUpdate(symbol: string, update: DepthUpdate): Promise<boolean> {
        const success = orderBookEngine.updateOrderBook(
            this.exchange,
            symbol,
            update.bids,
            update.asks,
            update.sequence,
            update.timestamp
        );

        if (!success) {
            logError(`${this.exchange}-ws`, `Sequence out of sync for ${symbol}, resyncing...`);
            await this.syncSnapshot(symbol);
            return false;
        }
        return true;
    }
}

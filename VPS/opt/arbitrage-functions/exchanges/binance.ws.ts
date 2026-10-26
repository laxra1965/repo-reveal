/**
 * BinanceWS - WebSocket connection for real-time Binance order book updates
 * Streams depth data at 100ms intervals for specified symbols
 */

export class BinanceWS {
    private ws: WebSocket | null = null;
    private isConnected = false;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private reconnectDelay = 2000;

    constructor(
        private symbols: string[],
        private onUpdate: (
            symbol: string,
            bids: [number, number][],
            asks: [number, number][],
            timestamp: number
        ) => void,
        private onError?: (error: Error) => void
    ) {}

    /**
     * Connect to Binance WebSocket streams
     */
    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                // Subscribe to all depth streams at 100ms interval
                const streams = this.symbols
                    .map(s => `${s.toLowerCase()}@depth100ms`)
                    .join('/');

                const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

                this.ws = new WebSocket(url);

                this.ws.onopen = () => {
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    console.log('✅ [BinanceWS] Connected to Binance WebSocket');
                    resolve();
                };

                this.ws.onmessage = (event: MessageEvent) => {
                    try {
                        const message = JSON.parse(event.data as string);
                        this.handleMessage(message);
                    } catch (error) {
                        console.error('❌ [BinanceWS] Failed to parse message:', error);
                    }
                };

                this.ws.onclose = () => {
                    this.isConnected = false;
                    console.warn('⚠️ [BinanceWS] Connection closed, attempting reconnect...');
                    this.scheduleReconnect();
                };

                this.ws.onerror = (event: Event) => {
                    const error = new Error('WebSocket error');
                    console.error('❌ [BinanceWS] WebSocket error:', error);
                    if (this.onError) {
                        this.onError(error);
                    }
                    reject(error);
                };
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                reject(err);
            }
        });
    }

    /**
     * Handle incoming WebSocket message
     */
    private handleMessage(message: any) {
        try {
            if (!message.data || !message.data.s) return;

            const payload = message.data;
            const symbol = payload.s; // symbol
            const bids = (payload.b || []).map((b: any[]) => [
                parseFloat(b[0]),
                parseFloat(b[1])
            ]);
            const asks = (payload.a || []).map((a: any[]) => [
                parseFloat(a[0]),
                parseFloat(a[1])
            ]);

            // Validate data
            if (!Array.isArray(bids) || !Array.isArray(asks)) return;
            if (bids.length === 0 || asks.length === 0) return;

            // Call the registered handler
            this.onUpdate(symbol, bids, asks, Date.now());
        } catch (error) {
            console.error('❌ [BinanceWS] Error handling message:', error);
        }
    }

    /**
     * Schedule reconnection with exponential backoff
     */
    private async scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('❌ [BinanceWS] Max reconnection attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

        console.log(
            `🔄 [BinanceWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
        );

        setTimeout(() => {
            this.connect().catch(err => {
                console.error('❌ [BinanceWS] Reconnection failed:', err);
                this.scheduleReconnect();
            });
        }, delay);
    }

    /**
     * Disconnect from WebSocket
     */
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.isConnected = false;
            console.log('⏹️ [BinanceWS] Disconnected');
        }
    }

    /**
     * Check if connected
     */
    getIsConnected(): boolean {
        return this.isConnected;
    }

    /**
     * Get subscribed symbols
     */
    getSymbols(): string[] {
        return [...this.symbols];
    }

    /**
     * Subscribe to additional symbols
     */
    addSymbols(newSymbols: string[]) {
        const uniqueSymbols = new Set([...this.symbols, ...newSymbols]);
        const addedSymbols = newSymbols.filter(s => !this.symbols.includes(s));

        if (addedSymbols.length === 0) return;

        this.symbols = Array.from(uniqueSymbols);

        if (this.isConnected && this.ws) {
            // Reconstruct subscription
            this.disconnect();
            this.connect().catch(error => {
                console.error('❌ [BinanceWS] Failed to resubscribe:', error);
            });
        }
    }

    /**
     * Get connection stats
     */
    getStats() {
        return {
            isConnected: this.isConnected,
            symbolCount: this.symbols.length,
            symbols: this.symbols,
            reconnectAttempts: this.reconnectAttempts
        };
    }
}

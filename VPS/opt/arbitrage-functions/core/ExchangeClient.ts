/**
 * ExchangeClient - Unified interface for trading on multiple exchanges
 * Supports Binance, Bybit, OKX, Gate.io
 */

export interface ExchangeConfig {
    exchange: string;
    apiKey: string;
    apiSecret: string;
    apiPassphrase?: string;  // For OKX
    testMode: boolean;
}

export interface OrderResult {
    orderId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    executedQuantity: number;
    price: number;
    executedPrice: number;
    commission: number;
    timestamp: number;
    status: 'filled' | 'partial' | 'cancelled' | 'failed';
    error?: string;
}

export class ExchangeClient {
    private config: ExchangeConfig;
    private baseUrl: string;

    constructor(config: ExchangeConfig) {
        this.config = config;
        this.baseUrl = this.getBaseUrl(config.exchange, config.testMode);
        console.log(`📡 [ExchangeClient] Initialized for ${config.exchange}`);
    }

    /**
     * Get base URL for exchange
     */
    private getBaseUrl(exchange: string, testMode: boolean): string {
        const urls: Record<string, string> = {
            binance: testMode 
                ? 'https://testnet.binance.vision' 
                : 'https://api.binance.com',
            bybit: testMode
                ? 'https://api-testnet.bybit.com'
                : 'https://api.bybit.com',
            okx: testMode
                ? 'https://www.okx.com'
                : 'https://www.okx.com',
            gate: 'https://api.gateio.ws'
        };

        return urls[exchange] || urls.binance;
    }

    /**
     * Create a limit order
     */
    async createOrder(
        symbol: string,
        side: 'BUY' | 'SELL',
        quantity: number,
        price: number
    ): Promise<OrderResult> {
        try {
            switch (this.config.exchange) {
                case 'binance':
                    return await this.createBinanceOrder(symbol, side, quantity, price);
                case 'bybit':
                    return await this.createBybitOrder(symbol, side, quantity, price);
                case 'okx':
                    return await this.createOKXOrder(symbol, side, quantity, price);
                case 'gate':
                    return await this.createGateOrder(symbol, side, quantity, price);
                default:
                    throw new Error(`Unsupported exchange: ${this.config.exchange}`);
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`❌ [ExchangeClient] Order failed on ${this.config.exchange}:`, errorMsg);

            return {
                orderId: '',
                symbol,
                side,
                quantity,
                executedQuantity: 0,
                price,
                executedPrice: 0,
                commission: 0,
                timestamp: Date.now(),
                status: 'failed',
                error: errorMsg
            };
        }
    }

    /**
     * Binance order creation with HMAC-SHA256 authentication
     */
    private async createBinanceOrder(
        symbol: string,
        side: 'BUY' | 'SELL',
        quantity: number,
        price: number
    ): Promise<OrderResult> {
        try {
            const timestamp = Date.now();
            
            // Build request body
            const params = {
                symbol: symbol.toUpperCase(),
                side: side.toUpperCase(),
                type: 'LIMIT',
                timeInForce: 'GTC',
                quantity: quantity.toString(),
                price: price.toString(),
                timestamp: timestamp.toString(),
                recvWindow: '5000'
            };

            // Create query string
            const queryString = Object.entries(params)
                .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
                .join('&');

            // Generate signature
            const signature = await this.generateBinanceSignature(queryString);
            const finalUrl = `${this.baseUrl}/api/v3/order?${queryString}&signature=${signature}`;

            // Make request
            const response = await fetch(finalUrl, {
                method: 'POST',
                headers: {
                    'X-MBX-APIKEY': this.config.apiKey,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Binance API error: ${errorData.msg || response.statusText}`);
            }

            const result = await response.json();

            console.log(`✅ [Binance] ${side} order created: ${result.orderId}`);

            return {
                orderId: result.orderId.toString(),
                symbol: result.symbol,
                side: result.side as 'BUY' | 'SELL',
                quantity: parseFloat(result.origQty),
                executedQuantity: parseFloat(result.executedQty),
                price: parseFloat(result.price),
                executedPrice: parseFloat(result.cummulativeQuoteQty) / parseFloat(result.executedQty) || 0,
                commission: parseFloat(result.fills?.[0]?.commission || 0),
                timestamp: result.time,
                status: result.status === 'FILLED' ? 'filled' : 
                        result.status === 'PARTIALLY_FILLED' ? 'partial' : 'failed'
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`❌ [Binance] Order creation failed:`, errorMsg);
            
            throw error;
        }
    }

    /**
     * Generate Binance HMAC-SHA256 signature
     */
    private async generateBinanceSignature(queryString: string): Promise<string> {
        // Encode secret as bytes
        const secretBytes = new TextEncoder().encode(this.config.apiSecret);
        const messageBytes = new TextEncoder().encode(queryString);

        // Create HMAC-SHA256
        const key = await crypto.subtle.importKey(
            'raw',
            secretBytes,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );

        const signature = await crypto.subtle.sign('HMAC', key, messageBytes);

        // Convert to hex string
        return Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    /**
     * Bybit order creation with HMAC-SHA256 authentication
     */
    private async createBybitOrder(
        symbol: string,
        side: 'BUY' | 'SELL',
        quantity: number,
        price: number
    ): Promise<OrderResult> {
        try {
            const timestamp = Date.now().toString();

            // Build request body
            const body = {
                symbol: symbol.toUpperCase(),
                side: side.toUpperCase(),
                orderType: 'Limit',
                qty: quantity.toString(),
                price: price.toString(),
                timeInForce: 'GTC',
                timestamp
            };

            // Create signature
            const queryString = Object.entries(body)
                .map(([key, value]) => `${key}=${value}`)
                .join('&');

            const signature = await this.generateBybitSignature(queryString);

            // Make request
            const response = await fetch(`${this.baseUrl}/v5/order/create`, {
                method: 'POST',
                headers: {
                    'X-BAPI-API-KEY': this.config.apiKey,
                    'X-BAPI-TIMESTAMP': timestamp,
                    'X-BAPI-SIGN': signature,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Bybit API error: ${errorData.ret_msg || response.statusText}`);
            }

            const result = await response.json();
            const orderData = result.result;

            console.log(`✅ [Bybit] ${side} order created: ${orderData.orderId}`);

            return {
                orderId: orderData.orderId,
                symbol: orderData.symbol,
                side: orderData.side as 'BUY' | 'SELL',
                quantity: parseFloat(orderData.qty),
                executedQuantity: parseFloat(orderData.cumExecQty || 0),
                price: parseFloat(orderData.price),
                executedPrice: parseFloat(orderData.cumExecValue || 0) / parseFloat(orderData.cumExecQty || 1),
                commission: 0, // Bybit returns commission in separate call
                timestamp: parseInt(orderData.createdTime),
                status: orderData.orderStatus === 'Filled' ? 'filled' : 
                        orderData.orderStatus === 'PartiallyFilled' ? 'partial' : 'failed'
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`❌ [Bybit] Order creation failed:`, errorMsg);
            throw error;
        }
    }

    /**
     * Generate Bybit HMAC-SHA256 signature
     */
    private async generateBybitSignature(queryString: string): Promise<string> {
        const secretBytes = new TextEncoder().encode(this.config.apiSecret);
        const messageBytes = new TextEncoder().encode(queryString);

        const key = await crypto.subtle.importKey(
            'raw',
            secretBytes,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );

        const signature = await crypto.subtle.sign('HMAC', key, messageBytes);

        return Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    /**
     * OKX order creation with HMAC-SHA256 and passphrase authentication
     */
    private async createOKXOrder(
        symbol: string,
        side: 'BUY' | 'SELL',
        quantity: number,
        price: number
    ): Promise<OrderResult> {
        try {
            const timestamp = new Date().toISOString();

            // Build request body
            const body = {
                instId: symbol.toUpperCase(),
                tdMode: 'cash',
                clOrdId: `OKX_${Date.now()}`,
                side: side.toLowerCase(),
                ordType: 'limit',
                sz: quantity.toString(),
                px: price.toString()
            };

            // Create signature
            const bodyStr = JSON.stringify(body);
            const message = timestamp + 'POST' + '/api/v5/trade/order' + bodyStr;
            const signature = await this.generateOKXSignature(message);

            // Make request
            const response = await fetch(`${this.baseUrl}/api/v5/trade/order`, {
                method: 'POST',
                headers: {
                    'OK-ACCESS-KEY': this.config.apiKey,
                    'OK-ACCESS-SIGN': signature,
                    'OK-ACCESS-TIMESTAMP': timestamp,
                    'OK-ACCESS-PASSPHRASE': this.config.apiPassphrase || '',
                    'Content-Type': 'application/json'
                },
                body: bodyStr
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`OKX API error: ${errorData.msg || response.statusText}`);
            }

            const result = await response.json();
            const orderData = result.data[0];

            console.log(`✅ [OKX] ${side} order created: ${orderData.ordId}`);

            return {
                orderId: orderData.ordId,
                symbol: orderData.instId,
                side: orderData.side === 'buy' ? 'BUY' : 'SELL',
                quantity: parseFloat(orderData.sz),
                executedQuantity: parseFloat(orderData.accFillSz || 0),
                price: parseFloat(orderData.px),
                executedPrice: parseFloat(orderData.avgPx || 0),
                commission: 0, // OKX returns commission in separate call
                timestamp: parseInt(orderData.cTime),
                status: orderData.state === 'filled' ? 'filled' : 
                        orderData.state === 'partially_filled' ? 'partial' : 'failed'
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`❌ [OKX] Order creation failed:`, errorMsg);
            throw error;
        }
    }

    /**
     * Generate OKX HMAC-SHA256 signature
     */
    private async generateOKXSignature(message: string): Promise<string> {
        const secretBytes = new TextEncoder().encode(this.config.apiSecret);
        const messageBytes = new TextEncoder().encode(message);

        const key = await crypto.subtle.importKey(
            'raw',
            secretBytes,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );

        const signature = await crypto.subtle.sign('HMAC', key, messageBytes);
        
        // OKX wants base64 encoded signature
        const signatureArray = new Uint8Array(signature);
        const binaryString = String.fromCharCode(...signatureArray);
        return btoa(binaryString);
    }

    /**
     * Gate.io order creation with HMAC-SHA512 authentication
     */
    private async createGateOrder(
        symbol: string,
        side: 'BUY' | 'SELL',
        quantity: number,
        price: number
    ): Promise<OrderResult> {
        try {
            const timestamp = Math.floor(Date.now() / 1000).toString();

            // Build request body
            const body = {
                text: `GATEIO_${Date.now()}`,
                currency_pair: symbol.toLowerCase(),
                type: 'limit',
                account: 'spot',
                side: side.toLowerCase(),
                amount: quantity.toString(),
                price: price.toString(),
                time_in_force: 'gtc'
            };

            // Create signature
            const bodyStr = JSON.stringify(body);
            const message = 'POST\n/api/v4/spot/orders\n' + bodyStr + '\n' + timestamp;
            const signature = await this.generateGateSignature(message);

            // Make request
            const response = await fetch(`${this.baseUrl}/api/v4/spot/orders`, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'KEY': this.config.apiKey,
                    'Timestamp': timestamp,
                    'SIGN': signature
                },
                body: bodyStr
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Gate.io API error: ${errorData.label || response.statusText}`);
            }

            const result = await response.json();

            console.log(`✅ [Gate.io] ${side} order created: ${result.id}`);

            return {
                orderId: result.id,
                symbol: result.currency_pair.toUpperCase(),
                side: result.side === 'buy' ? 'BUY' : 'SELL',
                quantity: parseFloat(result.amount),
                executedQuantity: parseFloat(result.filled_total || 0),
                price: parseFloat(result.price),
                executedPrice: parseFloat(result.filled_total || 0) > 0 ? 
                               parseFloat(result.filled_total) / parseFloat(result.filled_total || 1) : 0,
                commission: 0, // Gate.io returns commission in separate call
                timestamp: parseInt(result.create_time) * 1000,
                status: result.status === 'closed' ? 'filled' : 
                        result.filled_total && parseFloat(result.filled_total) > 0 ? 'partial' : 'failed'
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`❌ [Gate.io] Order creation failed:`, errorMsg);
            throw error;
        }
    }

    /**
     * Generate Gate.io HMAC-SHA512 signature
     */
    private async generateGateSignature(message: string): Promise<string> {
        const secretBytes = new TextEncoder().encode(this.config.apiSecret);
        const messageBytes = new TextEncoder().encode(message);

        const key = await crypto.subtle.importKey(
            'raw',
            secretBytes,
            { name: 'HMAC', hash: 'SHA-512' },
            false,
            ['sign']
        );

        const signature = await crypto.subtle.sign('HMAC', key, messageBytes);

        return Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    /**
     * Cancel an order
     */
    async cancelOrder(symbol: string, orderId: string): Promise<boolean> {
        try {
            console.log(`⏹️  [ExchangeClient] Cancelling order ${orderId} on ${symbol}`);
            // TODO: Implement cancel logic for each exchange
            return true;
        } catch (error) {
            console.error(`❌ [ExchangeClient] Cancel failed:`, error);
            return false;
        }
    }

    /**
     * Get account balance
     */
    async getBalance(asset: string): Promise<number> {
        try {
            console.log(`💰 [ExchangeClient] Getting balance for ${asset}`);
            // TODO: Implement balance check for each exchange
            return 0;
        } catch (error) {
            console.error(`❌ [ExchangeClient] Balance check failed:`, error);
            return 0;
        }
    }

    /**
     * Get order status
     */
    async getOrderStatus(symbol: string, orderId: string): Promise<{
        status: string;
        executedQuantity: number;
        executedPrice: number;
    }> {
        try {
            console.log(`🔍 [ExchangeClient] Checking order ${orderId}`);
            // TODO: Implement order status check for each exchange
            return {
                status: 'filled',
                executedQuantity: 1,
                executedPrice: 40000
            };
        } catch (error) {
            console.error(`❌ [ExchangeClient] Status check failed:`, error);
            return {
                status: 'unknown',
                executedQuantity: 0,
                executedPrice: 0
            };
        }
    }
}

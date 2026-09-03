
import crypto from 'crypto';
import fetch from 'node-fetch';
import { IExchangeExecutor } from './ExecutionEngine';
import { KeyManager } from './KeyManager';
import { assertTradingEnabled, isDryRun } from './config';

export class BybitExecutor implements IExchangeExecutor {
    private keyManager: KeyManager;
    private readonly baseUrl = 'https://api.bybit.com';
    private precisions: Map<string, number> = new Map();

    constructor() {
        this.keyManager = new KeyManager();
    }

    async initialize() {
        try {
            const res = await fetch(`${this.baseUrl}/v5/market/instruments-info?category=spot`);
            const data = await res.json() as any;
            if (data.retCode === 0 && data.result?.list) {
                for (const item of data.result.list) {
                    // basePrecision or lotSizeFilter? Bybit V5 uses lotSizeFilter.qtyStep
                    const step = item.lotSizeFilter?.qtyStep || '0.001';
                    // We need decimals.
                    const decimals = Math.abs(Math.log10(parseFloat(step)));
                    this.precisions.set(item.symbol, decimals);
                }
                console.log(`[BybitExecutor] Loaded precisions for ${this.precisions.size} symbols.`);
            }
        } catch (e: any) {
            console.error(`[BybitExecutor] Failed to load instruments: ${e.message}`);
        }
    }

    private roundQty(symbol: string, qty: number): string {
        const precision = this.precisions.get(symbol) ?? 4; // Default 4
        const factor = Math.pow(10, precision);
        const rounded = Math.floor(qty * factor) / factor;
        return rounded.toFixed(precision);
    }

    private async verifyOrder(orderId: string, symbol: string, keys: any) {
        // 14.2.3 Execution Confirmation (Poll ONCE)
        const timestamp = Date.now().toString();
        const recvWindow = '5000';
        const query = `category=spot&orderId=${orderId}&symbol=${symbol}`;

        const signData = timestamp + keys.apiKey + recvWindow + query;
        const signature = crypto.createHmac('sha256', keys.apiSecret).update(signData).digest('hex');

        const res = await fetch(`${this.baseUrl}/v5/order/history?${query}`, {
            headers: {
                'X-BAPI-API-KEY': keys.apiKey,
                'X-BAPI-SIGN': signature,
                'X-BAPI-TIMESTAMP': timestamp,
                'X-BAPI-RECV-WINDOW': recvWindow
            }
        });

        const data = await res.json() as any;
        if (data.retCode !== 0) throw new Error(`Bybit Verify Failed: ${data.retMsg}`);

        const order = data.result?.list?.[0];
        if (!order) throw new Error("Bybit Order not found in history");

        if (order.orderStatus !== 'Filled') {
            throw new Error(`Bybit execution incomplete: Status ${order.orderStatus}`);
        }
        if (parseFloat(order.cumExecQty) <= 0) {
            throw new Error("Bybit filled quantity is zero");
        }

        return order;
    }

    async executeMarketOrder(
        userId: string,
        exchange: string,
        symbol: string,
        side: 'BUY' | 'SELL',
        amount: number
    ): Promise<{ fillPrice: number, fillAmount: number, fee: number }> {
        // PHASE E: HARD EXECUTION BLOCK (MANDATORY)
        assertTradingEnabled(`bybit ${symbol} ${side}`);

        if (isDryRun()) {
            console.log(`[DRY RUN] Bybit executeMarketOrder: ${side} ${amount} ${symbol}`);
            return { fillPrice: 0, fillAmount: amount, fee: 0 };
        }

        const keys = await this.keyManager.getKeys(userId, 'bybit');
        if (!keys) throw new Error(`Missing Bybit keys for user ${userId}`);

        const timestamp = Date.now().toString();
        const recvWindow = '5000';

        const qtyStr = this.roundQty(symbol.toUpperCase(), amount);

        const payload = {
            category: 'spot',
            symbol: symbol.toUpperCase(),
            side: side.charAt(0).toUpperCase() + side.slice(1).toLowerCase(),
            orderType: 'Market',
            qty: qtyStr
        };

        const rawPayload = JSON.stringify(payload);
        const signData = timestamp + keys.apiKey + recvWindow + rawPayload;
        const signature = crypto
            .createHmac('sha256', keys.apiSecret)
            .update(signData)
            .digest('hex');

        const response = await fetch(`${this.baseUrl}/v5/order/create`, {
            method: 'POST',
            headers: {
                'X-BAPI-API-KEY': keys.apiKey,
                'X-BAPI-SIGN': signature,
                'X-BAPI-TIMESTAMP': timestamp,
                'X-BAPI-RECV-WINDOW': recvWindow,
                'Content-Type': 'application/json'
            },
            body: rawPayload
        });

        const data = await response.json() as any;

        if (data.retCode !== 0) {
            throw new Error(`Bybit Order Error: ${data.retMsg}`);
        }

        const orderId = data.result?.orderId;
        if (!orderId) throw new Error("Bybit did not return orderId");

        // Verify (returns the filled order)
        const order = await this.verifyOrder(orderId, symbol.toUpperCase(), keys);
        const execQty = parseFloat(order.cumExecQty || qtyStr);
        const execValue = parseFloat(order.cumExecValue || '0');
        const avgPrice = parseFloat(order.avgPrice || (execQty > 0 ? (execValue / execQty).toString() : '0'));
        const fee = parseFloat(order.cumExecFee || '0');

        return {
            fillAmount: side === 'BUY' ? execQty : execValue,
            fillPrice: avgPrice,
            fee
        };
    }

    async cancelAllOrders(userId: string, exchange: string, symbol?: string): Promise<void> {
        console.log(`[Bybit] CancelAllOrders for ${userId} on ${symbol || 'ALL'} - DRY RUN MOCK`);
        // V5: POST /v5/order/cancel-all
    }

    async withdraw(userId: string, exchange: string, asset: string, amount: number, address: string): Promise<string> {
        console.log(`[Bybit] Withdrawal for ${userId}: ${amount} ${asset} to ${address} - DRY RUN MOCK`);
        // V5: POST /v5/asset/withdraw/create
        return "bybit_mock_tx_id";
    }
}

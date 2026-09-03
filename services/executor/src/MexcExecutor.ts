
import crypto from 'crypto';
import fetch from 'node-fetch';
import { IExchangeExecutor } from './ExecutionEngine';
import { KeyManager } from './KeyManager';
import { assertTradingEnabled, isDryRun } from './config';

const BASE_URL = 'https://api.mexc.com';
const MEXC_MAX_USDT_PER_TRADE = 50;

/**
 * MEXC spot market order executor (Binance-compatible HMAC SHA-256 signing).
 */
export class MexcExecutor implements IExchangeExecutor {
    private keyManager = new KeyManager();

    private signedQuery(params: Record<string, string>, secret: string): string {
        const query = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
        const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
        return `${query}&signature=${signature}`;
    }

    async executeMarketOrder(
        userId: string,
        exchange: string,
        symbol: string,
        side: 'BUY' | 'SELL',
        amount: number
    ): Promise<{ fillPrice: number, fillAmount: number, fee: number }> {
        assertTradingEnabled(`mexc ${symbol} ${side}`);

        // Safety net capital clamp (also enforced by the allocation engine)
        if (side === 'BUY' && amount > MEXC_MAX_USDT_PER_TRADE) {
            console.warn(`MEXC capital clamp: reducing ${amount} to ${MEXC_MAX_USDT_PER_TRADE}`);
            amount = MEXC_MAX_USDT_PER_TRADE;
        }

        if (isDryRun()) {
            console.log(`[DRY RUN] MEXC executeMarketOrder: ${side} ${amount} ${symbol}`);
            return { fillPrice: 0, fillAmount: amount, fee: 0 };
        }

        const keys = await this.keyManager.getKeys(userId, 'mexc');
        if (!keys) throw new Error(`Missing MEXC keys for user ${userId}`);

        const params: Record<string, string> = {
            symbol: symbol.toUpperCase().replace('_', ''),
            side: side.toUpperCase(),
            type: 'MARKET',
            timestamp: Date.now().toString(),
            recvWindow: '5000'
        };
        // BUY spends quote currency, SELL sells base quantity
        if (side === 'BUY') params.quoteOrderQty = amount.toFixed(8);
        else params.quantity = amount.toFixed(8);

        const query = this.signedQuery(params, keys.apiSecret);

        const res = await fetch(`${BASE_URL}/api/v3/order?${query}`, {
            method: 'POST',
            headers: { 'X-MEXC-APIKEY': keys.apiKey, 'Content-Type': 'application/json' }
        });

        const data = await res.json() as any;
        if (!res.ok || data.code) {
            throw new Error(`MEXC Order Error: ${data.msg || res.statusText}`);
        }

        const executedQty = parseFloat(data.executedQty || '0');
        const cummulativeQuote = parseFloat(data.cummulativeQuoteQty || '0');
        if (executedQty <= 0) throw new Error('MEXC filled quantity is zero');
        if (data.status && !['FILLED', 'PARTIALLY_FILLED'].includes(data.status)) {
            throw new Error(`MEXC execution incomplete: status ${data.status}`);
        }
        if (data.status === 'PARTIALLY_FILLED') {
            throw new Error('MEXC partial fill detected — unwind required');
        }

        const avgPrice = executedQty > 0 ? cummulativeQuote / executedQty : 0;

        return {
            fillAmount: side === 'BUY' ? executedQty : cummulativeQuote,
            fillPrice: avgPrice,
            fee: cummulativeQuote * 0.001
        };
    }

    async cancelAllOrders(userId: string, exchange: string, symbol?: string): Promise<void> {
        assertTradingEnabled('mexc cancelAllOrders');
        if (isDryRun() || !symbol) {
            console.log(`[DRY RUN] MEXC cancelAllOrders for ${userId}`);
            return;
        }
        const keys = await this.keyManager.getKeys(userId, 'mexc');
        if (!keys) throw new Error(`Missing MEXC keys for user ${userId}`);
        const query = this.signedQuery({
            symbol: symbol.toUpperCase().replace('_', ''),
            timestamp: Date.now().toString()
        }, keys.apiSecret);
        const res = await fetch(`${BASE_URL}/api/v3/openOrders?${query}`, {
            method: 'DELETE',
            headers: { 'X-MEXC-APIKEY': keys.apiKey }
        });
        if (!res.ok) throw new Error(`MEXC cancel failed: ${res.statusText}`);
    }

    async withdraw(userId: string, exchange: string, asset: string, amount: number, address: string): Promise<string> {
        throw new Error('MEXC withdrawals are disabled for safety');
    }
}

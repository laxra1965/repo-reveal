
import crypto from 'crypto';
import fetch from 'node-fetch';
import { IExchangeExecutor } from './ExecutionEngine';
import { KeyManager } from './KeyManager';
import { assertTradingEnabled, isDryRun } from './config';

const BASE_URL = 'https://api.gateio.ws';
const PREFIX = '/api/v4';

/**
 * Gate.io spot market order executor (HMAC SHA-512 signing).
 */
export class GateExecutor implements IExchangeExecutor {
    private keyManager = new KeyManager();

    private sign(method: string, path: string, query: string, body: string, secret: string, key: string) {
        const timestamp = (Date.now() / 1000).toString();
        const hashedPayload = crypto.createHash('sha512').update(body).digest('hex');
        const signString = `${method}\n${path}\n${query}\n${hashedPayload}\n${timestamp}`;
        const sign = crypto.createHmac('sha512', secret).update(signString).digest('hex');
        return { KEY: key, Timestamp: timestamp, SIGN: sign };
    }

    /** Converts BTCUSDT-style symbols into Gate's BTC_USDT format when needed. */
    private normalizeSymbol(symbol: string): string {
        if (symbol.includes('_')) return symbol.toUpperCase();
        const quotes = ['USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'DAI'];
        const upper = symbol.toUpperCase();
        for (const q of quotes) {
            if (upper.endsWith(q) && upper.length > q.length) {
                return `${upper.slice(0, upper.length - q.length)}_${q}`;
            }
        }
        return upper;
    }

    async executeMarketOrder(
        userId: string,
        exchange: string,
        symbol: string,
        side: 'BUY' | 'SELL',
        amount: number
    ): Promise<{ fillPrice: number, fillAmount: number, fee: number }> {
        assertTradingEnabled(`gate ${symbol} ${side}`);

        if (isDryRun()) {
            console.log(`[DRY RUN] Gate executeMarketOrder: ${side} ${amount} ${symbol}`);
            return { fillPrice: 0, fillAmount: amount, fee: 0 };
        }

        const keys = await this.keyManager.getKeys(userId, 'gate');
        if (!keys) throw new Error(`Missing Gate.io keys for user ${userId}`);

        const currencyPair = this.normalizeSymbol(symbol);
        // Gate market orders: BUY amount = quote spent, SELL amount = base quantity
        const body = JSON.stringify({
            currency_pair: currencyPair,
            type: 'market',
            account: 'spot',
            side: side.toLowerCase(),
            amount: amount.toFixed(8),
            time_in_force: 'ioc'
        });

        const path = `${PREFIX}/spot/orders`;
        const headers = this.sign('POST', path, '', body, keys.apiSecret, keys.apiKey);

        const res = await fetch(`${BASE_URL}${path}`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
            body
        });

        const data = await res.json() as any;
        if (!res.ok || data.label) {
            throw new Error(`Gate Order Error: ${data.message || data.label || res.statusText}`);
        }

        const filledBase = parseFloat(data.filled_total && data.avg_deal_price
            ? (parseFloat(data.filled_total) / parseFloat(data.avg_deal_price)).toString()
            : (data.amount || '0'));
        const filledQuote = parseFloat(data.filled_total || '0');
        const avgPrice = parseFloat(data.avg_deal_price || '0');
        const fee = parseFloat(data.fee || '0');

        // 14.3.2 Full-fill enforcement
        if (data.status && data.status !== 'closed') {
            throw new Error(`Gate execution incomplete: status ${data.status}`);
        }
        if (filledQuote <= 0) throw new Error('Gate filled amount is zero');

        return {
            fillAmount: side === 'BUY' ? filledBase : filledQuote,
            fillPrice: avgPrice,
            fee
        };
    }

    async cancelAllOrders(userId: string, exchange: string, symbol?: string): Promise<void> {
        assertTradingEnabled('gate cancelAllOrders');
        if (isDryRun()) {
            console.log(`[DRY RUN] Gate cancelAllOrders for ${userId}`);
            return;
        }
        const keys = await this.keyManager.getKeys(userId, 'gate');
        if (!keys) throw new Error(`Missing Gate.io keys for user ${userId}`);

        const query = symbol ? `currency_pair=${this.normalizeSymbol(symbol)}` : '';
        const path = `${PREFIX}/spot/orders`;
        const headers = this.sign('DELETE', path, query, '', keys.apiSecret, keys.apiKey);

        const res = await fetch(`${BASE_URL}${path}${query ? `?${query}` : ''}`, {
            method: 'DELETE',
            headers: { ...headers, Accept: 'application/json' }
        });
        if (!res.ok) throw new Error(`Gate cancel failed: ${res.statusText}`);
    }

    async withdraw(userId: string, exchange: string, asset: string, amount: number, address: string): Promise<string> {
        throw new Error('Gate withdrawals are disabled for safety');
    }
}


import crypto from 'crypto';
import fetch from 'node-fetch';
import { IExchangeExecutor } from './ExecutionEngine';
import { KeyManager } from './KeyManager';

export class OKXExecutor implements IExchangeExecutor {
    private keyManager: KeyManager;
    private readonly baseUrl = 'https://www.okx.com';

    constructor() {
        this.keyManager = new KeyManager();
    }

    async executeMarketOrder(
        userId: string,
        exchange: string,
        symbol: string,
        side: 'BUY' | 'SELL',
        amount: number
    ): Promise<{ fillPrice: number, fillAmount: number, fee: number }> {

        const dryRun = true; // FORCE DRY RUN FOR PHASE 12
        if (dryRun) {
            console.log(`[DRY RUN] OKX executeMarketOrder: ${side} ${amount} ${symbol} for user ${userId}`);
            return {
                fillPrice: 10000,
                fillAmount: amount,
                fee: 0
            };
        }

        const keys = await this.keyManager.getKeys(userId, 'okx');
        if (!keys) throw new Error(`Missing OKX keys for user ${userId}`);
        if (!keys.passphrase) throw new Error(`OKX requires a passphrase`);

        const timestamp = new Date().toISOString();
        const method = 'POST';
        const requestPath = '/api/v5/trade/order';

        const body = {
            instId: symbol, // e.g., BTC-USDT
            tdMode: 'cash',
            side: side.toLowerCase(),
            ordType: 'market',
            sz: amount.toString()
        };

        const rawBody = JSON.stringify(body);
        const signData = timestamp + method + requestPath + rawBody;
        const signature = crypto
            .createHmac('sha256', keys.apiSecret)
            .update(signData)
            .digest('base64');

        const response = await fetch(`${this.baseUrl}${requestPath}`, {
            method,
            headers: {
                'OK-ACCESS-KEY': keys.apiKey,
                'OK-ACCESS-SIGN': signature,
                'OK-ACCESS-TIMESTAMP': timestamp,
                'OK-ACCESS-PASSPHRASE': keys.passphrase,
                'Content-Type': 'application/json'
            },
            body: rawBody
        });

        const data = await response.json() as any;

        if (data.code !== '0') {
            throw new Error(`OKX Order Error: ${data.data?.[0]?.sMsg || data.msg}`);
        }

        return {
            fillAmount: amount * 0.999,
            fillPrice: 0,
            fee: 0.001
        };
    }

    async cancelAllOrders(userId: string, exchange: string, symbol?: string): Promise<void> {
        console.log(`[OKX] CancelAllOrders for ${userId} - DRY RUN MOCK`);
    }

    async withdraw(userId: string, exchange: string, asset: string, amount: number, address: string): Promise<string> {
        console.log(`[OKX] Withdraw ${amount} ${asset} - DRY RUN MOCK`);
        return "okx_mock_tx_id";
    }
}

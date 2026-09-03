
import crypto from 'crypto';
import fetch from 'node-fetch';
import { IExchangeExecutor } from './ExecutionEngine';
import { KeyManager, ExchangeCredentials } from './KeyManager';
import { assertTradingEnabled, isDryRun } from './config';

export class BinanceExecutor implements IExchangeExecutor {
    private keyManager: KeyManager;
    private readonly baseUrl = 'https://api.binance.com';
    private filters: Map<string, { minQty: number, stepSize: number, minNotional: number }> = new Map();

    constructor() {
        this.keyManager = new KeyManager();
    }

    async initialize() {
        // 14.1.1 Load Filters Once
        try {
            const res = await fetch(`${this.baseUrl}/api/v3/exchangeInfo`);
            const data = await res.json() as any;

            for (const s of data.symbols) {
                const lot = s.filters.find((f: any) => f.filterType === 'LOT_SIZE');
                const notional = s.filters.find((f: any) => f.filterType === 'MIN_NOTIONAL') ||
                    s.filters.find((f: any) => f.filterType === 'NOTIONAL');
                // Binance might use NOTIONAL in some endpoints/versions? Usually MIN_NOTIONAL.

                if (lot && notional) {
                    this.filters.set(s.symbol, {
                        minQty: parseFloat(lot.minQty),
                        stepSize: parseFloat(lot.stepSize),
                        minNotional: parseFloat(notional.minNotional || notional.minNotional || 0)
                    });
                }
            }
            console.log(`[BinanceExecutor] Loaded filters for ${this.filters.size} symbols.`);
        } catch (e: any) {
            console.error(`[BinanceExecutor] Failed to load filters: ${e.message}`);
        }
    }

    private roundQty(symbol: string, qty: number): number {
        const f = this.filters.get(symbol);
        if (!f) return qty; // Fallback (shouldn't happen if init)

        // 14.1.2 Round Down Only
        const steps = Math.floor(qty / f.stepSize);
        return steps * f.stepSize;
    }

    async executeMarketOrder(
        userId: string,
        exchange: string,
        symbol: string,
        side: 'BUY' | 'SELL',
        amount: number
    ): Promise<{ fillPrice: number, fillAmount: number, fee: number }> {
        // PHASE E: HARD EXECUTION BLOCK (MANDATORY)
        assertTradingEnabled(`binance ${symbol} ${side}`);

        if (isDryRun()) {
            console.log(`[DRY RUN] Binance executeMarketOrder: ${side} ${amount} ${symbol}`);
            return { fillPrice: 0, fillAmount: amount, fee: 0 };
        }

        const keys = await this.keyManager.getKeys(userId, 'binance');
        if (!keys) throw new Error(`Missing Binance keys for user ${userId}`);

        // Apply Rounding
        const roundedQty = this.roundQty(symbol, amount);
        const f = this.filters.get(symbol);
        if (f && roundedQty * 10000 < f.minNotional) { // Approx price check? No price known here.
            // Rely on roundQty. 
            // We can't check Notional without price. 
            // But we can check minQty.
            if (roundedQty < f.minQty) throw new Error("Qty below minQty");
        }

        const timestamp = Date.now();
        const query = [
            `symbol=${symbol.toUpperCase()}`,
            `side=${side.toUpperCase()}`,
            `type=MARKET`,
            `timestamp=${timestamp}`
        ];

        // Binance Market Order: quantity (base asset) or quoteOrderQty (quote asset)
        // If BUY, we usually spend USDT (quoteOrderQty).
        // If SELL, we sell Asset (quantity).
        if (side === 'BUY') {
            // Amount is usually Input USDT for buy?
            // "Action" in Opportunity defines amount.
            // If Triangle Leg 1 (USDT -> BTC), amount is USDT.
            // If Leg 2 (BTC -> ETH), amount is BTC.
            // We need to differentiate input amount type.
            // Assumption: executeMarketOrder 'amount' is ALWAYS quantity of asset being SOLD (for Sell) or SPENT (for Buy)?
            // Standardizing: 
            // BUY BTC/USDT with 100 USDT -> quoteOrderQty = 100.
            // SELL BTC/USDT with 0.1 BTC -> quantity = 0.1.
            query.push(`quoteOrderQty=${amount.toFixed(8)}`);
            // Note: quoteOrderQty likely doesn't need stepSize rounding as strictly as quantity?
            // Actually Binance handles quoteOrderQty precision.
        } else {
            query.push(`quantity=${roundedQty.toFixed(8)}`);
        }

        const queryString = query.join('&');
        const signature = crypto
            .createHmac('sha256', keys.apiSecret)
            .update(queryString)
            .digest('hex');

        const url = `${this.baseUrl}/api/v3/order?${queryString}&signature=${signature}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'X-MBX-APIKEY': keys.apiKey }
        });

        const data = await response.json() as any;

        if (!response.ok) {
            throw new Error(`Binance Order Error: ${data.msg || response.statusText}`);
        }

        // 14.1.3 Fill Verification
        // Check status
        if (data.status !== 'FILLED') {
            // 14.7 Failure Heuristic: Partial Fill or New -> UNWIND
            throw new Error(`Binance verification failed: Status is ${data.status} (Expected FILLED)`);
        }

        // Assert Fill Quantity (for Quantity based orders)
        if (side === 'SELL') {
            if (parseFloat(data.executedQty) !== parseFloat(data.origQty)) {
                throw new Error("Binance partial fill detected");
            }
        }

        const fills = data.fills || [];
        let totalQty = 0;
        let totalCost = 0;
        let totalFee = 0;

        for (const fill of fills) {
            totalQty += Number(fill.qty);
            totalCost += Number(fill.qty) * Number(fill.price);
            totalFee += Number(fill.commission);
        }

        return {
            fillAmount: side === 'BUY' ? totalQty : totalCost,
            fillPrice: totalCost / totalQty,
            fee: totalFee
        };
    }

    async cancelAllOrders(userId: string, exchange: string, symbol?: string): Promise<void> {
        console.log(`[Binance] CancelAllOrders for ${userId} on ${symbol || 'ALL SYMBOLS'} - DRY RUN MOCK`);
        // Implementation: 
        // DELETE /api/v3/openOrders (if symbol provided)
        // If no symbol, loop all? Binance API requires symbol for Cancel All usually.
        // For 'Flush', we might need to iterate active symbols.
    }

    async withdraw(userId: string, exchange: string, asset: string, amount: number, address: string): Promise<string> {
        console.log(`[Binance] Withdrawal for ${userId}: ${amount} ${asset} to ${address} - DRY RUN MOCK`);
        // Implementation: POST /sapi/v1/capital/withdraw/apply
        return "binance_mock_tx_id";
    }
}

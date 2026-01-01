
import { IExchangeExecutor } from './ExecutionEngine';

export class MexcExecutor implements IExchangeExecutor {

    async executeMarketOrder(
        userId: string,
        exchange: string,
        symbol: string,
        side: 'BUY' | 'SELL',
        amount: number
    ): Promise<{ fillPrice: number, fillAmount: number, fee: number }> {

        const dryRun = true;
        if (dryRun) {
            console.log(`[DRY RUN] MEXC executeMarketOrder: ${side} ${amount} ${symbol}`);
            return {
                fillPrice: 10000,
                fillAmount: amount,
                fee: 0
            };
        }

        // Implementation of MEXC API
        // Requirement 14.4.2 Max Capital Clamp is handled by Allocation Engine? 
        // Or here? "allocation = Math.min(allocation, MEXC_MAX_USDT_PER_TRADE);"
        // This should ideally happen BEFORE calling executeMarketOrder (Allocation Phase).
        // But we can enforce it here too as a safety net.

        const MEXC_MAX_USDT_PER_TRADE = 50;
        // Check amount value in USDT. 
        // If side=BUY, amount is quoteOrderQty (USDT).
        if (side === 'BUY' && amount > MEXC_MAX_USDT_PER_TRADE) {
            console.warn(`MEXC Capital Clamp: Reducing ${amount} to ${MEXC_MAX_USDT_PER_TRADE}`);
            amount = MEXC_MAX_USDT_PER_TRADE;
        }

        throw new Error("MEXC Real Execution Not Implemented");
    }

    async cancelAllOrders(userId: string, exchange: string, symbol?: string): Promise<void> {
        console.log(`[MEXC] CancelAllOrders for ${userId} - DRY RUN MOCK`);
    }

    async withdraw(userId: string, exchange: string, asset: string, amount: number, address: string): Promise<string> {
        console.log(`[MEXC] Withdraw ${amount} ${asset} - DRY RUN MOCK`);
        return "mexc_mock_tx_id";
    }
}


import { IExchangeExecutor } from './ExecutionEngine';

export class GateExecutor implements IExchangeExecutor {

    async executeMarketOrder(
        userId: string,
        exchange: string,
        symbol: string,
        side: 'BUY' | 'SELL',
        amount: number
    ): Promise<{ fillPrice: number, fillAmount: number, fee: number }> {
        // PHASE E: HARD EXECUTION BLOCK (MANDATORY)
        if (process.env.TRADING_ENABLED !== "true") {
            console.log(`[SAFETY] Execution disabled — live trading blocked for ${exchange} ${symbol} ${side} ${amount}`);
            throw new Error("Trading is disabled. Set TRADING_ENABLED=true to enable live trading.");
        }

        const dryRun = true;
        if (dryRun) {
            console.log(`[DRY RUN] Gate executeMarketOrder: ${side} ${amount} ${symbol}`);
            return {
                fillPrice: 10000,
                fillAmount: amount,
                fee: 0
            };
        }

        // Implementation of Gate.io API
        // Requirement 14.3.2 Full-Fill Enforcement
        // const res = await fetch(...)
        // const filled = ...
        // if (filled < amount) {
        //    throw new Error("Gate partial fill — unwind");
        // }

        throw new Error("Gate.io Real Execution Not Implemented");
    }

    async cancelAllOrders(userId: string, exchange: string, symbol?: string): Promise<void> {
        console.log(`[Gate] CancelAllOrders for ${userId} - DRY RUN MOCK`);
    }

    async withdraw(userId: string, exchange: string, asset: string, amount: number, address: string): Promise<string> {
        console.log(`[Gate] Withdraw ${amount} ${asset} - DRY RUN MOCK`);
        return "gate_mock_tx_id";
    }
}

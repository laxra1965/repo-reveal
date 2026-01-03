
import { IExchangeExecutor } from './ExecutionEngine';
import { BinanceExecutor } from './BinanceExecutor';
import { BybitExecutor } from './BybitExecutor';
import { OKXExecutor } from './OKXExecutor';
import { GateExecutor } from './GateExecutor';
import { MexcExecutor } from './MexcExecutor';

export class MultiExchangeExecutor implements IExchangeExecutor {
    private executors: Record<string, IExchangeExecutor>;
    private failureCount: Record<string, number> = {};
    private suspendedUntil: Record<string, number> = {};
    private readonly MAX_FAILURES = 3;
    private readonly SUSPENSION_MS = 5 * 60 * 1000; // 5 minutes

    constructor() {
        this.executors = {
            'binance': new BinanceExecutor(),
            'bybit': new BybitExecutor(),
            'okx': new OKXExecutor(),
            'gate': new GateExecutor(),
            'mexc': new MexcExecutor()
        };
    }

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
        
        const exName = exchange.toLowerCase();

        // Circuit Breaker check
        if (this.suspendedUntil[exName] && Date.now() < this.suspendedUntil[exName]) {
            throw new Error(`Exchange ${exName} is suspended until ${new Date(this.suspendedUntil[exName]).toISOString()}`);
        }

        const executor = this.executors[exName];
        if (!executor) throw new Error(`Exchange ${exchange} not supported in MultiExecutor`);

        try {
            const res = await executor.executeMarketOrder(userId, exchange, symbol, side, amount);
            // Reset failures on success
            if (this.failureCount[exName] > 0) this.failureCount[exName] = 0;
            return res;
        } catch (error) {
            this.handleFailure(exName);
            throw error;
        }
    }

    async cancelAllOrders(userId: string, exchange: string, symbol?: string): Promise<void> {
        const exName = exchange.toLowerCase();
        const executor = this.executors[exName];
        if (!executor) throw new Error(`Exchange ${exchange} not supported`);
        return executor.cancelAllOrders(userId, exchange, symbol);
    }

    async withdraw(userId: string, exchange: string, asset: string, amount: number, address: string): Promise<string> {
        const exName = exchange.toLowerCase();
        const executor = this.executors[exName];
        if (!executor) throw new Error(`Exchange ${exchange} not supported`);
        return executor.withdraw(userId, exchange, asset, amount, address);
    }

    private handleFailure(exName: string): void {
        this.failureCount[exName] = (this.failureCount[exName] || 0) + 1;

        if (this.failureCount[exName] >= this.MAX_FAILURES) {
            this.suspendedUntil[exName] = Date.now() + this.SUSPENSION_MS;
            console.error(`CIRCUIT BREAKER TRIGGERED: ${exName} suspended due to ${this.MAX_FAILURES} failures.`);
        }
    }
}

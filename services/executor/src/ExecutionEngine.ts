import { Opportunity, OrderBook } from '../../../shared/src/types';
import { getTierConfig, TierLevel, TierConfig } from '../../../shared/src/tier.config';

// Phase 15-17 Constants
const RISK_LIMITS = {
    maxCapitalPctPerTrade: 0.02,
    maxCapitalPerTradeUSDT: 200,
    maxTradesPerMinute: 3,
};
const MAX_LOSS_PCT_PER_TRADE = 0.35;
const MAX_DAILY_DRAWDOWN_PCT = 2.0;
const MAX_CONSECUTIVE_FAILURES = 3;

export enum ExecutionState {
    INIT = 'INIT',
    LEG1_PLACED = 'LEG1_PLACED',
    LEG1_FILLED = 'LEG1_FILLED',
    LEG2_PLACED = 'LEG2_PLACED',
    LEG2_FILLED = 'LEG2_FILLED',
    LEG3_PLACED = 'LEG3_PLACED',
    COMPLETE = 'COMPLETE',
    FAILED = 'FAILED'
}

export interface ExecutionJob {
    id: string;
    userId: string;
    opportunity: Opportunity;
    allocation: number;
    userEquity: number; // 17.1 Requirement: Snapshot for Drawdown calc
    state: ExecutionState;
    logs: string[];
    currentAsset: string;
    currentAmount: number;
}

export interface IExchangeExecutor {
    executeMarketOrder(
        userId: string,
        exchange: string,
        symbol: string,
        side: 'BUY' | 'SELL',
        amount: number
    ): Promise<{ fillPrice: number, fillAmount: number, fee: number }>;

    cancelAllOrders(userId: string, exchange: string, symbol?: string): Promise<void>;
    withdraw(userId: string, exchange: string, asset: string, amount: number, address: string): Promise<string>;
}

export type Outcome = "CLEAN_WIN" | "LOW_EDGE_WIN" | "FEE_LEAK" | "SLIPPAGE_LOSS" | "EXECUTION_FAILURE";

export interface TradeForensics {
    id: string;
    exchange: string;
    path: string[];
    capitalIn: number;
    capitalOut: number;
    expectedProfitPct: number;
    actualProfitPct: number;
    feesPaid: number;
    slippagePct: number;
    latencyMs: number;
    timestamp: number;
    outcome: Outcome;
}

class TradeRateLimiter {
    private timestamps: number[] = [];
    allow(): boolean {
        const now = Date.now();
        this.timestamps = this.timestamps.filter(t => now - t < 60_000);
        if (this.timestamps.length >= RISK_LIMITS.maxTradesPerMinute) return false;
        this.timestamps.push(now);
        return true;
    }
}

class DailyPnL {
    // Map userId -> { startEquity, currentPnl }
    private stats = new Map<string, { startEquity: number, currentPnl: number }>();

    registerStart(userId: string, equity: number) {
        if (!this.stats.has(userId)) {
            this.stats.set(userId, { startEquity: equity, currentPnl: 0 });
        }
    }

    addProfit(userId: string, profit: number): number {
        const stat = this.stats.get(userId);
        if (!stat) return 0;
        stat.currentPnl += profit;
        return (stat.currentPnl / stat.startEquity) * 100; // Drawdown % (negative if loss)
    }
}

export class ExecutionEngine {
    private rateLimiter = new TradeRateLimiter();
    private dailyPnL = new DailyPnL();
    private consecutiveFailures = 0;
    private systemPaused = false;
    private resumeKey = process.env.RESUME_KEY;

    constructor(
        private exchangeExecutor: IExchangeExecutor,
        private orderBooks: Map<string, OrderBook>
    ) { }

    private assertState(job: ExecutionJob, expected: ExecutionState) {
        if (job.state !== expected) {
            throw new Error(`Invalid state transition ${job.state} -> ${expected} (expected)`);
        }
    }

    private assertSlippage(expectedPrice: number, executedPrice: number, maxSlipPct: number) {
        if (!expectedPrice || expectedPrice === 0) return;
        const slip = Math.abs(executedPrice - expectedPrice) / executedPrice; // Note: Formula variation in prompt
        // 16.2 says: ((actual - expected) / expected) * 100. 
        // 13.4 says: Math.abs(executed - expected) / expected * 100.
        // We stick to 13.4 definition for Guard (Absolute deviation).
        if (slip > maxSlipPct) {
            throw new Error(`Slippage ${(slip * 100).toFixed(3)}% exceeds limit ${(maxSlipPct * 100).toFixed(3)}%`);
        }
    }

    // 17.3 Manual Resume
    public resumeSystem(secret: string) {
        if (secret !== this.resumeKey) {
            throw new Error("Unauthorized resume attempt");
        }
        this.systemPaused = false;
        this.consecutiveFailures = 0;
        console.log("SYSTEM RESUMED via Manual Override");
    }

    private pauseSystem(reason: string) {
        this.systemPaused = true;
        console.error("⛔ SYSTEM PAUSED:", reason);
    }

    async executeJob(job: ExecutionJob, userTier: TierLevel) {
        // PHASE E: HARD EXECUTION BLOCK (MANDATORY)
        if (process.env.TRADING_ENABLED !== "true") {
            console.log(`[SAFETY] Execution disabled — live trading blocked for job ${job.id}`);
            throw new Error("Trading is disabled. Set TRADING_ENABLED=true to enable live trading.");
        }
        
        // 17.3 System Pause Check
        if (this.systemPaused) {
            job.logs.push("JOB REJECTED: System Paused");
            throw new Error("System paused — execution blocked");
        }

        // 15.3 Rate Limit
        if (!this.rateLimiter.allow()) {
            job.logs.push("JOB REJECTED: Rate Limit Exceeded");
            throw new Error("Rate limit exceeded");
        }

        const tierConfig = getTierConfig(userTier);
        job.state = ExecutionState.INIT;
        job.logs.push(`Starting [${job.id}] for User ${job.userId}. Allocation: ${job.allocation} USDT. Equity: ${job.userEquity}`);

        // Register Equity for Daily PnL
        this.dailyPnL.registerStart(job.userId, job.userEquity);

        const startTime = Date.now();
        let feesPaid = 0;
        let finalOutcome: Outcome = 'EXECUTION_FAILURE';

        try {
            // --- LEG 1 ---
            this.assertState(job, ExecutionState.INIT);
            job.state = ExecutionState.LEG1_PLACED;
            const res1 = await this.executeLeg(job, 0, tierConfig, userTier);
            job.currentAmount = res1.fillAmount;
            feesPaid += res1.fee;
            job.currentAsset = job.opportunity.path[1];
            job.state = ExecutionState.LEG1_FILLED;

            // --- LEG 2 ---
            this.assertState(job, ExecutionState.LEG1_FILLED);
            job.state = ExecutionState.LEG2_PLACED;
            const res2 = await this.executeLeg(job, 1, tierConfig, userTier);
            job.currentAmount = res2.fillAmount;
            feesPaid += res2.fee;
            job.currentAsset = job.opportunity.path[2];
            job.state = ExecutionState.LEG2_FILLED;

            // --- LEG 3 ---
            this.assertState(job, ExecutionState.LEG2_FILLED);
            job.state = ExecutionState.LEG3_PLACED;
            const res3 = await this.executeLeg(job, 2, tierConfig, userTier);
            job.currentAmount = res3.fillAmount;
            feesPaid += res3.fee;
            job.currentAsset = job.opportunity.path[0];
            job.state = ExecutionState.COMPLETE;
            job.logs.push(`SUCCESS: Final USDT: ${job.currentAmount}`);

            // 14.5 Fee-Aware & 15.2 Loss Bound
            const startAmount = job.allocation;
            const profit = job.currentAmount - startAmount;
            const profitPct = (profit / startAmount) * 100;

            if (profitPct < -MAX_LOSS_PCT_PER_TRADE) { // 15.2
                throw new Error(`Per-trade loss bound violated: ${profitPct.toFixed(2)}%`);
            }
            if (profitPct < 0) { // 14.5 Fee Leakage check logic
                // Requirement: "if (actualProfitPct < 0) throw error 'Fee leakage'".
                // If we strictly throw here, we might count it as failure.
                // We log it as warning for now or Error if strict? 
                // 14.5 says "throw new Error".
                throw new Error(`Fee leakage detected: Profit ${profitPct.toFixed(3)}% < 0`);
            }

            // 16.3 Fee Drift Check
            // Rough expected fee = 0.1% * 3 = 0.3%. 
            // expectedFees logic needed? 
            // "if (feesPaid > expectedFees * 1.15)"
            // Simplification: Expected Fee ~ 0.3% of Volume.
            const expectedFees = job.allocation * 0.003;
            if (feesPaid > expectedFees * 1.15) {
                throw new Error("Unexpected fee escalation");
            }

            // Success Updates
            const pnlPct = this.dailyPnL.addProfit(job.userId, profit);
            // 17.1 Daily Drawdown
            if (pnlPct < -MAX_DAILY_DRAWDOWN_PCT) {
                this.pauseSystem(`Daily drawdown exceeded for user ${job.userId} (${pnlPct.toFixed(2)}%)`);
            }

            // Classification
            finalOutcome = this.classify(profitPct, feesPaid, job.opportunity.profitPct);
            if (finalOutcome === 'CLEAN_WIN' || finalOutcome === 'LOW_EDGE_WIN') {
                this.consecutiveFailures = 0;
            } else {
                this.consecutiveFailures++;
            }

        } catch (error: any) {
            job.logs.push(`CRITICAL FAIL: ${error.message}`);
            job.state = ExecutionState.FAILED;
            await this.unwind(job);

            this.consecutiveFailures++;
            finalOutcome = 'EXECUTION_FAILURE';

            // Check consecutiveness
            // 17.2 Consecutive Failure Guard
            if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                this.pauseSystem("Repeated execution failures");
            }
            throw error; // Propagate
        } finally {
            // 16.1 Forensics Persistence
            const forensics: TradeForensics = {
                id: job.id,
                exchange: job.opportunity.exchange,
                path: job.opportunity.path,
                capitalIn: job.allocation,
                capitalOut: job.currentAmount,
                expectedProfitPct: job.opportunity.profitPct,
                actualProfitPct: ((job.currentAmount - job.allocation) / job.allocation) * 100,
                feesPaid,
                slippagePct: 0, // Should calculate slippage vs expected
                latencyMs: Date.now() - startTime,
                timestamp: Date.now(),
                outcome: finalOutcome
            };
            this.persistForensics(forensics);
        }
    }

    private classify(actualProfitPct: number, feesPaid: number, expectedProfitPct: number): Outcome {
        if (actualProfitPct > 0.15) return "CLEAN_WIN";
        if (actualProfitPct > 0) return "LOW_EDGE_WIN";
        if (feesPaid > expectedProfitPct) return "FEE_LEAK"; // heuristic
        // Slippage outcome requires slippage data
        return "EXECUTION_FAILURE";
    }

    private persistForensics(f: TradeForensics) {
        console.log(`FORENSICS:${JSON.stringify(f)}`);
    }

    private async executeLeg(job: ExecutionJob, legIndex: number, tier: TierConfig, userTier: TierLevel) {
        const action = job.opportunity.actions[legIndex];
        const exchange = job.opportunity.exchange;

        if (exchange === 'mexc' && userTier.toString().toUpperCase() !== 'VIP') {
            throw new Error("MEXC restricted to VIP only");
        }
        if (exchange === 'gate' && job.opportunity.profitPct < tier.minProfitPct + 0.15) {
            throw new Error("Gate profit buffer insufficient");
        }

        const key = `${job.opportunity.exchange}:${action.symbol}`;
        const ob = this.orderBooks.get(key);
        let expectedPrice = 0;

        if (ob) {
            const staleness = Date.now() - ob.timestamp;
            if (staleness > 1000) throw new Error(`Execution aborted: Data too stale (${staleness}ms)`);
            const sim = ob.simulateMarketOrder(action.side, job.currentAmount);
            if (!sim.filled) throw new Error(`Execution aborted: Insufficient depth for leg ${legIndex + 1}`);
            expectedPrice = sim.avgPrice;

            if (exchange === 'mexc') {
                const bid = ob.getBestBid();
                const ask = ob.getBestAsk();
                if (bid && ask) {
                    const spread = (ask.price - bid.price) / bid.price * 100;
                    if (spread > 0.3) throw new Error("MEXC spread too wide");
                }
            }

            const bestPrice = action.side === 'BUY' ? ob.getBestAsk()?.price : ob.getBestBid()?.price;
            if (bestPrice) {
                const slippage = Math.abs(sim.avgPrice - bestPrice) / bestPrice;
                if (slippage > tier.maxSlippage) {
                    throw new Error(`Execution aborted: Pre-flight slippage (${(slippage * 100).toFixed(2)}%) exceeds limit`);
                }
            }
        }

        job.logs.push(`Executing Leg ${legIndex + 1}: ${action.side} ${action.symbol} amount ${job.currentAmount}`);
        const result = await this.exchangeExecutor.executeMarketOrder(
            job.userId, job.opportunity.exchange, action.symbol, action.side, job.currentAmount
        );

        if (!result || result.fillAmount <= 0) throw new Error(`Leg ${legIndex + 1} fill was zero or failed`);

        const extraBuffer = exchange === 'bybit' ? 0.0015 : 0;
        this.assertSlippage(expectedPrice, result.fillPrice, tier.maxSlippage + extraBuffer);

        return result;
    }

    private async unwind(job: ExecutionJob) {
        job.logs.push(`TRIGGERING IMMEDIATE UNWIND from state ${job.state}`);
        const startAsset = job.opportunity.path[0];
        if (job.currentAsset === startAsset || job.currentAmount <= 0) return;

        try {
            let unwindSymbol = '';
            let unwindSide: 'BUY' | 'SELL' = 'SELL';

            if (job.currentAsset === job.opportunity.path[1]) {
                const leg1 = job.opportunity.actions[0];
                unwindSymbol = leg1.symbol;
                unwindSide = leg1.side === 'BUY' ? 'SELL' : 'BUY';
            } else if (job.currentAsset === job.opportunity.path[2]) {
                const leg3 = job.opportunity.actions[2];
                unwindSymbol = leg3.symbol;
                unwindSide = leg3.side;
            }

            if (unwindSymbol) {
                job.logs.push(`UNWIND TRADE: ${unwindSide} ${unwindSymbol} amount ${job.currentAmount}`);
                await this.exchangeExecutor.executeMarketOrder(
                    job.userId, job.opportunity.exchange, unwindSymbol, unwindSide, job.currentAmount
                );
                job.logs.push(`UNWIND SUCCESSFUL.`);
            } else {
                job.logs.push(`ERROR: Could not determine unwind path for ${job.currentAsset}`);
            }
        } catch (e: any) {
            job.logs.push(`EMERGENCY: Unwind failed: ${e.message}`);
        }
    }
}

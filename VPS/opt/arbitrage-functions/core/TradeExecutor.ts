/**
 * TradeExecutor - Handles both paper and real trade execution
 * Integrates with OrderBook for depth-aware execution
 * Includes position tracking and risk management
 */

import { OrderBook } from '../core/OrderBook.ts';
import { StandardOpportunity } from '../scanner/types.ts';

export enum TradeMode {
    PAPER = 'paper',      // Simulation only
    REAL = 'real'         // Live trading
}

export enum TradeStatus {
    PENDING = 'pending',
    FILLED = 'filled',
    PARTIAL = 'partial',
    CANCELLED = 'cancelled',
    FAILED = 'failed'
}

export interface Trade {
    id: string;
    opportunityId: string;
    mode: TradeMode;
    status: TradeStatus;
    
    // Execution details
    exchange: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    
    // Results
    filledQuantity: number;
    filledPrice: number;
    commission: number;
    
    // Timestamps
    createdAt: number;
    executedAt?: number;
    
    // Metadata
    orderId?: string;
    error?: string;
}

export interface ExecutionConfig {
    mode: TradeMode;
    maxPositionSize: number;      // Max USDT per trade
    maxOpenPositions: number;     // Max concurrent positions
    riskPerTrade: number;         // Risk % per trade
    commissionRate: number;       // Exchange commission %
    slippageBuffer: number;       // Extra % to account for slippage
}

export interface ExecutionResult {
    success: boolean;
    trades: Trade[];
    totalCost: number;
    totalProceeds: number;
    profitLoss: number;
    profitPercent: number;
    error?: string;
}

export class TradeExecutor {
    private trades: Map<string, Trade> = new Map();
    private positions: Map<string, number> = new Map(); // symbol -> quantity
    private config: ExecutionConfig;
    private tradeIdCounter = 0;

    constructor(config: ExecutionConfig) {
        this.config = config;
        console.log(`🤖 [TradeExecutor] Initialized in ${config.mode} mode`);
    }

    /**
     * Execute a complete arbitrage cycle
     * Paper mode: Simulate the trade
     * Real mode: Actually execute it
     */
    async executeOpportunity(
        opportunity: StandardOpportunity,
        orderBooks: Map<string, OrderBook>
    ): Promise<ExecutionResult> {
        const result: ExecutionResult = {
            success: false,
            trades: [],
            totalCost: 0,
            totalProceeds: 0,
            profitLoss: 0,
            profitPercent: 0
        };

        try {
            // Validate opportunity
            if (!this.validateOpportunity(opportunity)) {
                result.error = 'Opportunity validation failed';
                return result;
            }

            // Check risk limits
            if (!this.checkRiskLimits(opportunity)) {
                result.error = 'Risk limits exceeded';
                return result;
            }

            // Execute each step of the triangular path
            const steps = this.buildExecutionSteps(opportunity, orderBooks);

            for (const step of steps) {
                try {
                    const trade = await this.executeTrade(step, orderBooks);
                    result.trades.push(trade);

                    if (!trade.orderId && this.config.mode === TradeMode.REAL) {
                        throw new Error(`Trade ${step.symbol} failed: no order ID`);
                    }

                    // Update position
                    this.updatePosition(step.symbol, step.side, trade.filledQuantity);

                } catch (error) {
                    result.error = `Step failed: ${error instanceof Error ? error.message : String(error)}`;
                    // Attempt to close any opened positions
                    await this.closeOpenPositions(steps, result.trades);
                    return result;
                }
            }

            // Calculate PnL
            this.calculatePnL(result);
            result.success = true;

            console.log(
                `${this.config.mode === TradeMode.REAL ? '🚀' : '📊'} [TradeExecutor] ` +
                `Opportunity executed: ${opportunity.path.join(' → ')} ` +
                `P&L: ${result.profitLoss.toFixed(4)} USDT (${result.profitPercent.toFixed(4)}%)`
            );

        } catch (error) {
            result.error = error instanceof Error ? error.message : String(error);
            console.error(`❌ [TradeExecutor] Execution failed:`, result.error);
        }

        return result;
    }

    /**
     * Validate opportunity before execution
     */
    private validateOpportunity(opportunity: StandardOpportunity): boolean {
        // Check profit is above minimum
        if (opportunity.profit_percent < 0.1) {
            console.warn(`⚠️ [TradeExecutor] Profit too low: ${opportunity.profit_percent.toFixed(4)}%`);
            return false;
        }

        // Check all pairs exist
        if (!opportunity.pair1 || !opportunity.pair2 || !opportunity.pair3) {
            console.warn(`⚠️ [TradeExecutor] Missing pairs`);
            return false;
        }

        return true;
    }

    /**
     * Check risk limits
     */
    private checkRiskLimits(opportunity: StandardOpportunity): boolean {
        // Check position count
        if (this.positions.size >= this.config.maxOpenPositions) {
            console.warn(`⚠️ [TradeExecutor] Max open positions reached: ${this.positions.size}`);
            return false;
        }

        // Calculate potential position size
        const estimatedSize = 100; // USDT (configurable)
        if (estimatedSize > this.config.maxPositionSize) {
            console.warn(`⚠️ [TradeExecutor] Position size exceeds limit: ${estimatedSize} > ${this.config.maxPositionSize}`);
            return false;
        }

        return true;
    }

    /**
     * Build execution steps from opportunity
     */
    private buildExecutionSteps(
        opportunity: StandardOpportunity,
        orderBooks: Map<string, OrderBook>
    ): Array<{
        pair: string;
        side: 'BUY' | 'SELL';
        quantity: number;
        exchange: string;
    }> {
        const steps = [];
        const [base, intermediate, quote] = [opportunity.pair1, opportunity.pair2, opportunity.pair3];

        // Step 1: Buy intermediate with base (USDT -> BNB)
        if (base) {
            steps.push({
                pair: base,
                side: 'BUY' as const,
                quantity: this.calculateQuantity(base, orderBooks),
                exchange: opportunity.exchange1 || 'binance'
            });
        }

        // Step 2: Sell intermediate for quote (BNB -> SOL)
        if (intermediate) {
            steps.push({
                pair: intermediate,
                side: 'SELL' as const,
                quantity: this.calculateQuantity(intermediate, orderBooks),
                exchange: opportunity.exchange2 || 'binance'
            });
        }

        // Step 3: Sell quote for base (SOL -> USDT)
        if (quote) {
            steps.push({
                pair: quote,
                side: 'SELL' as const,
                quantity: this.calculateQuantity(quote, orderBooks),
                exchange: opportunity.exchange3 || 'binance'
            });
        }

        return steps;
    }

    /**
     * Calculate execution quantity
     */
    private calculateQuantity(pair: string, orderBooks: Map<string, OrderBook>): number {
        const ob = orderBooks.get(pair);
        if (!ob) return 1; // Fallback

        // In real mode, use depth to determine safe quantity
        if (this.config.mode === TradeMode.REAL) {
            const topBid = ob.bids[0];
            const topAsk = ob.asks[0];
            if (!topBid || !topAsk) return 1;

            // Use conservative quantity
            return Math.min(topBid[1], topAsk[1]) * 0.5;
        }

        // Paper mode: just use 1 unit
        return 1;
    }

    /**
     * Execute a single trade
     */
    private async executeTrade(
        step: {
            pair: string;
            side: 'BUY' | 'SELL';
            quantity: number;
            exchange: string;
        },
        orderBooks: Map<string, OrderBook>
    ): Promise<Trade> {
        const tradeId = `TRADE_${++this.tradeIdCounter}_${Date.now()}`;
        const ob = orderBooks.get(step.pair);

        const trade: Trade = {
            id: tradeId,
            opportunityId: '',
            mode: this.config.mode,
            status: TradeStatus.PENDING,
            exchange: step.exchange,
            symbol: step.pair,
            side: step.side,
            quantity: step.quantity,
            price: 0,
            filledQuantity: step.quantity,
            filledPrice: 0,
            commission: 0,
            createdAt: Date.now()
        };

        try {
            if (this.config.mode === TradeMode.PAPER) {
                // Paper trading: simulate execution
                trade.status = TradeStatus.FILLED;
                trade.executedAt = Date.now();
                trade.orderId = `PAPER_${tradeId}`;

                if (ob) {
                    const result = ob.consume(step.quantity, step.side);
                    trade.filledPrice = result.avgPrice;
                    trade.filledQuantity = result.filled;
                    trade.price = result.avgPrice;
                } else {
                    trade.filledPrice = 1; // Fallback price
                }

                console.log(
                    `📊 [PAPER] ${step.side} ${trade.filledQuantity} ${step.pair} @ ${trade.filledPrice.toFixed(8)}`
                );

            } else {
                // Real trading: call exchange API
                const result = await this.executeOnExchange(step, ob);
                trade.status = result.status;
                trade.orderId = result.orderId;
                trade.filledPrice = result.filledPrice;
                trade.filledQuantity = result.filledQuantity;
                trade.executedAt = Date.now();

                if (!result.success) {
                    trade.status = TradeStatus.FAILED;
                    trade.error = result.error;
                    throw new Error(result.error);
                }

                console.log(
                    `🚀 [REAL] ${step.side} ${trade.filledQuantity} ${step.pair} @ ${trade.filledPrice.toFixed(8)}`
                );
            }

            // Calculate commission
            trade.commission = (trade.filledQuantity * trade.filledPrice) * (this.config.commissionRate / 100);

            this.trades.set(tradeId, trade);
            return trade;

        } catch (error) {
            trade.status = TradeStatus.FAILED;
            trade.error = error instanceof Error ? error.message : String(error);
            this.trades.set(tradeId, trade);
            throw error;
        }
    }

    /**
     * Execute trade on real exchange (placeholder)
     */
    private async executeOnExchange(
        step: {
            pair: string;
            side: 'BUY' | 'SELL';
            quantity: number;
            exchange: string;
        },
        orderBook: OrderBook | undefined
    ): Promise<{
        success: boolean;
        status: TradeStatus;
        orderId?: string;
        filledQuantity: number;
        filledPrice: number;
        error?: string;
    }> {
        // TODO: Integrate with actual exchange APIs (Binance, Bybit, OKX, Gate)
        // For now, simulate using orderbook data
        
        if (!orderBook) {
            return {
                success: false,
                status: TradeStatus.FAILED,
                filledQuantity: 0,
                filledPrice: 0,
                error: `OrderBook not available for ${step.pair}`
            };
        }

        const result = orderBook.consume(step.quantity, step.side);

        return {
            success: result.filled > 0,
            status: result.filled === step.quantity ? TradeStatus.FILLED : TradeStatus.PARTIAL,
            orderId: `REAL_${Date.now()}`,
            filledQuantity: result.filled,
            filledPrice: result.avgPrice
        };
    }

    /**
     * Update position tracking
     */
    private updatePosition(symbol: string, side: 'BUY' | 'SELL', quantity: number) {
        const current = this.positions.get(symbol) || 0;
        const newPosition = side === 'BUY' ? current + quantity : current - quantity;
        this.positions.set(symbol, newPosition);
    }

    /**
     * Close any open positions if trade fails mid-execution
     */
    private async closeOpenPositions(
        steps: Array<any>,
        executedTrades: Trade[]
    ): Promise<void> {
        console.warn(`⚠️ [TradeExecutor] Closing ${executedTrades.length} open positions...`);
        // Reverse operations for executed trades
        // TODO: Implement emergency close logic
    }

    /**
     * Calculate profit/loss
     */
    private calculatePnL(result: ExecutionResult): void {
        let totalCost = 0;
        let totalProceeds = 0;

        for (const trade of result.trades) {
            const value = trade.filledQuantity * trade.filledPrice;
            const withCommission = value + trade.commission;

            if (trade.side === 'BUY') {
                totalCost += withCommission;
            } else {
                totalProceeds += value - trade.commission;
            }
        }

        result.totalCost = totalCost;
        result.totalProceeds = totalProceeds;
        result.profitLoss = totalProceeds - totalCost;
        result.profitPercent = totalCost > 0 ? (result.profitLoss / totalCost) * 100 : 0;
    }

    /**
     * Get execution statistics
     */
    getStats() {
        return {
            mode: this.config.mode,
            totalTrades: this.trades.size,
            openPositions: this.positions.size,
            positions: Object.fromEntries(this.positions),
            config: this.config
        };
    }

    /**
     * Get recent trades
     */
    getRecentTrades(limit: number = 10): Trade[] {
        return Array.from(this.trades.values())
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, limit);
    }

    /**
     * Get trade by ID
     */
    getTrade(tradeId: string): Trade | undefined {
        return this.trades.get(tradeId);
    }
}

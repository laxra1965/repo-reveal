/**
 * RiskManager - Position management and risk controls
 * Prevents over-leverage, ensures capital preservation
 */

export interface Position {
    symbol: string;
    quantity: number;
    entryPrice: number;
    currentPrice: number;
    entryTime: number;
    unrealizedPnL: number;
    percentage: number;
}

export interface RiskConfig {
    maxDrawdown: number;           // % max loss from peak
    maxPositionPercent: number;    // % of capital per position
    maxDailyLoss: number;          // $ max loss per day
    maxOpenPositions: number;      // Number of concurrent trades
    stopLossPercent: number;       // % loss trigger for stop
}

export class RiskManager {
    private positions: Map<string, Position> = new Map();
    private dailyPnL = 0;
    private peakCapital = 100000;   // Starting capital
    private currentCapital = 100000;
    private config: RiskConfig;

    constructor(config: RiskConfig) {
        this.config = config;
        console.log(`🛡️  [RiskManager] Initialized with config:`, config);
    }

    /**
     * Check if a new position is allowed
     */
    canOpenPosition(symbol: string, size: number): {
        allowed: boolean;
        reason?: string;
    } {
        // Check max open positions
        if (this.positions.size >= this.config.maxOpenPositions) {
            return {
                allowed: false,
                reason: `Max open positions reached: ${this.positions.size}/${this.config.maxOpenPositions}`
            };
        }

        // Check position size
        const positionPercent = (size / this.currentCapital) * 100;
        if (positionPercent > this.config.maxPositionPercent) {
            return {
                allowed: false,
                reason: `Position size ${positionPercent.toFixed(2)}% exceeds max ${this.config.maxPositionPercent}%`
            };
        }

        // Check daily loss limit
        if (this.dailyPnL < -this.config.maxDailyLoss) {
            return {
                allowed: false,
                reason: `Daily loss limit reached: ${this.dailyPnL.toFixed(2)}/${-this.config.maxDailyLoss}`
            };
        }

        // Check drawdown
        const drawdown = ((this.peakCapital - this.currentCapital) / this.peakCapital) * 100;
        if (drawdown > this.config.maxDrawdown) {
            return {
                allowed: false,
                reason: `Max drawdown exceeded: ${drawdown.toFixed(2)}% > ${this.config.maxDrawdown}%`
            };
        }

        return { allowed: true };
    }

    /**
     * Update position
     */
    updatePosition(
        symbol: string,
        quantity: number,
        price: number
    ): void {
        const position = this.positions.get(symbol);

        if (quantity === 0) {
            // Close position
            this.positions.delete(symbol);
        } else {
            // Update or create position
            this.positions.set(symbol, {
                symbol,
                quantity,
                entryPrice: position?.entryPrice || price,
                currentPrice: price,
                entryTime: position?.entryTime || Date.now(),
                unrealizedPnL: (price - (position?.entryPrice || price)) * quantity,
                percentage: quantity > 0 ? 
                    ((price - (position?.entryPrice || price)) / (position?.entryPrice || price)) * 100 : 
                    0
            });
        }
    }

    /**
     * Update daily PnL
     */
    updateDailyPnL(pnl: number): void {
        this.dailyPnL += pnl;
        this.currentCapital += pnl;

        // Update peak capital
        if (this.currentCapital > this.peakCapital) {
            this.peakCapital = this.currentCapital;
        }

        console.log(`💰 [RiskManager] Daily PnL: ${this.dailyPnL.toFixed(2)}, Capital: ${this.currentCapital.toFixed(2)}`);
    }

    /**
     * Check if position should be force-closed due to stop loss
     */
    checkStopLoss(symbol: string): boolean {
        const position = this.positions.get(symbol);
        if (!position) return false;

        const loss = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
        return loss < -this.config.stopLossPercent;
    }

    /**
     * Get all open positions
     */
    getPositions(): Position[] {
        return Array.from(this.positions.values());
    }

    /**
     * Get position for symbol
     */
    getPosition(symbol: string): Position | undefined {
        return this.positions.get(symbol);
    }

    /**
     * Get total unrealized PnL
     */
    getTotalUnrealizedPnL(): number {
        return Array.from(this.positions.values())
            .reduce((sum, pos) => sum + pos.unrealizedPnL, 0);
    }

    /**
     * Get risk statistics
     */
    getStats() {
        const totalUnrealizedPnL = this.getTotalUnrealizedPnL();
        const drawdown = ((this.peakCapital - this.currentCapital) / this.peakCapital) * 100;

        return {
            currentCapital: this.currentCapital,
            peakCapital: this.peakCapital,
            drawdown: drawdown.toFixed(2),
            dailyPnL: this.dailyPnL.toFixed(2),
            totalUnrealizedPnL: totalUnrealizedPnL.toFixed(2),
            openPositions: this.positions.size,
            positions: Array.from(this.positions.values()),
            limits: this.config
        };
    }

    /**
     * Reset daily statistics
     */
    resetDaily(): void {
        this.dailyPnL = 0;
        console.log(`📅 [RiskManager] Daily statistics reset`);
    }
}

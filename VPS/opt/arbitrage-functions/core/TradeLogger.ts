/**
 * TradeLogger - Track and persist trade execution history
 * Logs to database and file for audit trail
 */

export interface TradeLog {
    id: string;
    tradeId: string;
    opportunityId: string;
    mode: 'paper' | 'real';
    exchange: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    filledQuantity: number;
    filledPrice: number;
    commission: number;
    status: string;
    error?: string;
    createdAt: number;
    updatedAt: number;
}

export interface DailyStats {
    date: string;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    totalPnL: number;
    winRate: number;
    largestWin: number;
    largestLoss: number;
}

export class TradeLogger {
    private logs: Map<string, TradeLog> = new Map();
    private dailyStats: Map<string, DailyStats> = new Map();

    /**
     * Log a trade execution
     */
    logTrade(trade: TradeLog): void {
        this.logs.set(trade.id, trade);

        // Update daily stats
        this.updateDailyStats(trade);

        // Log to console
        const mode = trade.mode === 'real' ? '🚀' : '📊';
        const status = trade.status === 'filled' ? '✅' : '⚠️';
        const pnl = ((trade.filledPrice - trade.price) / trade.price) * 100;

        console.log(
            `${mode} ${status} [${trade.exchange}] ${trade.symbol}: ` +
            `${trade.side} ${trade.filledQuantity} @ ${trade.filledPrice.toFixed(8)} ` +
            `(P&L: ${pnl.toFixed(4)}%)`
        );
    }

    /**
     * Update daily statistics
     */
    private updateDailyStats(trade: TradeLog): void {
        const date = new Date(trade.createdAt).toISOString().split('T')[0];
        const stats = this.dailyStats.get(date) || {
            date,
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            totalPnL: 0,
            winRate: 0,
            largestWin: 0,
            largestLoss: 0
        };

        // Calculate PnL for this trade
        const tradePnL = (trade.filledPrice - trade.price) * trade.filledQuantity - trade.commission;

        stats.totalTrades++;

        if (tradePnL > 0) {
            stats.winningTrades++;
            stats.largestWin = Math.max(stats.largestWin, tradePnL);
        } else if (tradePnL < 0) {
            stats.losingTrades++;
            stats.largestLoss = Math.min(stats.largestLoss, tradePnL);
        }

        stats.totalPnL += tradePnL;
        stats.winRate = stats.totalTrades > 0 ? (stats.winningTrades / stats.totalTrades) * 100 : 0;

        this.dailyStats.set(date, stats);
    }

    /**
     * Get trade log by ID
     */
    getTrade(tradeId: string): TradeLog | undefined {
        return this.logs.get(tradeId);
    }

    /**
     * Get all trades
     */
    getAllTrades(): TradeLog[] {
        return Array.from(this.logs.values())
            .sort((a, b) => b.createdAt - a.createdAt);
    }

    /**
     * Get trades for a specific date
     */
    getTradesForDate(date: string): TradeLog[] {
        const startOfDay = new Date(date).getTime();
        const endOfDay = startOfDay + 24 * 60 * 60 * 1000;

        return Array.from(this.logs.values())
            .filter(log => log.createdAt >= startOfDay && log.createdAt < endOfDay)
            .sort((a, b) => a.createdAt - b.createdAt);
    }

    /**
     * Get trades by symbol
     */
    getTradesBySymbol(symbol: string): TradeLog[] {
        return Array.from(this.logs.values())
            .filter(log => log.symbol === symbol)
            .sort((a, b) => b.createdAt - a.createdAt);
    }

    /**
     * Get trades by status
     */
    getTradesByStatus(status: string): TradeLog[] {
        return Array.from(this.logs.values())
            .filter(log => log.status === status);
    }

    /**
     * Get daily statistics
     */
    getDailyStats(date?: string): DailyStats | undefined {
        if (!date) {
            date = new Date().toISOString().split('T')[0];
        }
        return this.dailyStats.get(date);
    }

    /**
     * Get all daily statistics
     */
    getAllDailyStats(): DailyStats[] {
        return Array.from(this.dailyStats.values())
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    /**
     * Get summary statistics
     */
    getSummaryStats(): {
        totalTrades: number;
        winningTrades: number;
        losingTrades: number;
        totalPnL: number;
        winRate: number;
        averageWin: number;
        averageLoss: number;
        profitFactor: number;
        dateRange: { start: number; end: number };
    } {
        const trades = Array.from(this.logs.values());

        if (trades.length === 0) {
            return {
                totalTrades: 0,
                winningTrades: 0,
                losingTrades: 0,
                totalPnL: 0,
                winRate: 0,
                averageWin: 0,
                averageLoss: 0,
                profitFactor: 0,
                dateRange: { start: 0, end: 0 }
            };
        }

        let winningTrades = 0;
        let losingTrades = 0;
        let totalPnL = 0;
        let totalWins = 0;
        let totalLosses = 0;

        for (const trade of trades) {
            const pnl = (trade.filledPrice - trade.price) * trade.filledQuantity - trade.commission;

            if (pnl > 0) {
                winningTrades++;
                totalWins += pnl;
            } else if (pnl < 0) {
                losingTrades++;
                totalLosses += Math.abs(pnl);
            }

            totalPnL += pnl;
        }

        return {
            totalTrades: trades.length,
            winningTrades,
            losingTrades,
            totalPnL,
            winRate: (winningTrades / trades.length) * 100,
            averageWin: winningTrades > 0 ? totalWins / winningTrades : 0,
            averageLoss: losingTrades > 0 ? totalLosses / losingTrades : 0,
            profitFactor: totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? Infinity : 0),
            dateRange: {
                start: Math.min(...trades.map(t => t.createdAt)),
                end: Math.max(...trades.map(t => t.createdAt))
            }
        };
    }

    /**
     * Export trades to CSV format
     */
    exportToCSV(): string {
        const trades = Array.from(this.logs.values())
            .sort((a, b) => a.createdAt - b.createdAt);

        if (trades.length === 0) {
            return '';
        }

        const headers = [
            'ID', 'Trade ID', 'Mode', 'Exchange', 'Symbol', 'Side',
            'Quantity', 'Price', 'Filled Qty', 'Filled Price', 'Commission',
            'Status', 'Error', 'Timestamp'
        ];

        const rows = trades.map(t => [
            t.id,
            t.tradeId,
            t.mode,
            t.exchange,
            t.symbol,
            t.side,
            t.quantity,
            t.price,
            t.filledQuantity,
            t.filledPrice,
            t.commission,
            t.status,
            t.error || '',
            new Date(t.createdAt).toISOString()
        ]);

        const csv = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        ].join('\n');

        return csv;
    }

    /**
     * Clear old logs (keep only recent ones)
     */
    clearOldLogs(daysToKeep: number = 30): number {
        const cutoffDate = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
        let deleted = 0;

        for (const [id, log] of this.logs.entries()) {
            if (log.createdAt < cutoffDate) {
                this.logs.delete(id);
                deleted++;
            }
        }

        console.log(`🗑️  [TradeLogger] Cleared ${deleted} old log entries`);
        return deleted;
    }
}

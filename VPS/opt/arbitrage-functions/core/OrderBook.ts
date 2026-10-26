/**
 * OrderBook - In-memory depth management for a single symbol
 * Maintains sorted bids/asks and provides depth consumption methods
 */

export interface DepthLevel {
    price: number;
    quantity: number;
}

export class OrderBook {
    bids: DepthLevel[] = [];
    asks: DepthLevel[] = [];
    timestamp: number = 0;
    lastUpdate: number = 0;

    constructor(public symbol: string) {}

    /**
     * Update order book depth from WebSocket
     * Bids: high → low (descending)
     * Asks: low → high (ascending)
     */
    updateDepth(
        bids: [number, number][],
        asks: [number, number][],
        timestamp: number
    ) {
        this.bids = bids
            .map(([price, qty]) => ({ price, quantity: qty }))
            .sort((a, b) => b.price - a.price); // high → low

        this.asks = asks
            .map(([price, qty]) => ({ price, quantity: qty }))
            .sort((a, b) => a.price - b.price); // low → high

        this.timestamp = timestamp;
        this.lastUpdate = Date.now();
    }

    /**
     * Get best bid price (highest buy price)
     */
    getBestBid(): number | undefined {
        return this.bids[0]?.price;
    }

    /**
     * Get best ask price (lowest sell price)
     */
    getBestAsk(): number | undefined {
        return this.asks[0]?.price;
    }

    /**
     * Get spread in percentage
     */
    getSpread(): number {
        const bid = this.getBestBid();
        const ask = this.getBestAsk();
        if (!bid || !ask) return 0;
        return ((ask - bid) / bid) * 100;
    }

    /**
     * Consume quantity from a side of the book
     * Returns cost/proceeds in that asset
     * 
     * For BUY side: Returns USDT cost to buy amount
     * For SELL side: Returns USDT proceeds from selling amount
     */
    consume(amount: number, side: 'BUY' | 'SELL'): {
        filled: number;
        cost: number;
        avgPrice: number;
        slippage: number;
    } {
        if (amount <= 0) throw new Error('Amount must be positive');

        const book = side === 'BUY' ? this.asks : this.bids;
        if (book.length === 0) {
            return { filled: 0, cost: 0, avgPrice: 0, slippage: 0 };
        }

        let remaining = amount;
        let filled = 0;
        let totalCost = 0;
        const bestPrice = side === 'BUY' ? this.getBestAsk() : this.getBestBid();

        for (const level of book) {
            if (remaining <= 0) break;

            const tradeQty = Math.min(level.quantity, remaining);

            if (side === 'BUY') {
                // Buying: cost in QUOTE
                const levelCost = tradeQty * level.price;
                totalCost += levelCost;
                filled += tradeQty;
                remaining -= tradeQty;
            } else {
                // Selling: proceeds in QUOTE
                const levelProceeds = tradeQty * level.price;
                totalCost += levelProceeds;
                filled += tradeQty;
                remaining -= tradeQty;
            }
        }

        // Calculate average price and slippage
        const avgPrice = filled > 0 ? totalCost / filled : 0;
        const slippage = bestPrice ? Math.abs((avgPrice - bestPrice) / bestPrice) * 100 : 0;

        return {
            filled,
            cost: totalCost,
            avgPrice,
            slippage
        };
    }

    /**
     * Check if orderbook is stale (no updates for X ms)
     */
    isStale(maxAgeMs: number = 5000): boolean {
        return Date.now() - this.lastUpdate > maxAgeMs;
    }

    /**
     * Get depth statistics
     */
    getStats() {
        const bidQty = this.bids.reduce((sum, b) => sum + b.quantity, 0);
        const askQty = this.asks.reduce((sum, a) => sum + a.quantity, 0);

        return {
            symbol: this.symbol,
            timestamp: this.timestamp,
            lastUpdate: this.lastUpdate,
            bid: this.getBestBid(),
            ask: this.getBestAsk(),
            spread: this.getSpread(),
            bidQty,
            askQty,
            bidDepth: this.bids.length,
            askDepth: this.asks.length,
            isStale: this.isStale()
        };
    }
}

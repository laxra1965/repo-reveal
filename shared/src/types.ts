
export type Level = [price: number, qty: number];

export class OrderBook {
    bids: Level[] = []; // DESC
    asks: Level[] = []; // ASC
    lastUpdateId = 0;
    timestamp = 0;

    public symbol: string;
    constructor(symbol: string) {
        this.symbol = symbol;
    }

    applySnapshot(bids: Level[], asks: Level[]) {
        this.bids = bids
            .map(b => [Number(b[0]), Number(b[1])] as Level)
            .filter(b => b[1] > 0)
            .sort((a, b) => b[0] - a[0]);

        this.asks = asks
            .map(a => [Number(a[0]), Number(a[1])] as Level)
            .filter(a => a[1] > 0)
            .sort((a, b) => a[0] - b[0]);

        this.timestamp = Date.now();
    }

    applyDelta(bids: Level[], asks: Level[]) {
        const updateSide = (side: Level[], updates: Level[], desc: boolean) => {
            const map = new Map(side.map(l => [l[0], l[1]]));
            for (const [p, q] of updates) {
                const price = Number(p);
                const qty = Number(q);
                if (qty === 0) map.delete(price);
                else map.set(price, qty);
            }
            return [...map.entries()]
                .map(([p, q]) => [p, q] as Level)
                .sort((a, b) => desc ? b[0] - a[0] : a[0] - b[0]);
        };

        this.bids = updateSide(this.bids, bids, true);
        this.asks = updateSide(this.asks, asks, false);
        this.timestamp = Date.now();
    }

    simulateMarketOrder(
        side: 'BUY' | 'SELL',
        amountIn: number
    ): { output: number; filled: boolean; avgPrice: number } {
        let remaining = amountIn;
        let output = 0;
        let cost = 0;

        const levels = side === 'BUY' ? this.asks : this.bids;

        for (const [price, qty] of levels) {
            if (remaining <= 0) break;

            if (side === 'BUY') {
                const maxBase = remaining / price;
                const taken = Math.min(qty, maxBase);
                remaining -= taken * price;
                output += taken;
                cost += taken * price;
            } else {
                const taken = Math.min(qty, remaining);
                remaining -= taken;
                output += taken * price;
                cost += taken * price;
            }
        }

        if (remaining > 1e-8) {
            return { output: 0, filled: false, avgPrice: 0 };
        }

        return {
            output,
            filled: true,
            avgPrice: cost / (side === 'BUY' ? output : amountIn)
        };
    }

    getBestBid(): { price: number, qty: number } | null {
        if (this.bids.length === 0) return null;
        return { price: this.bids[0][0], qty: this.bids[0][1] };
    }

    getBestAsk(): { price: number, qty: number } | null {
        if (this.asks.length === 0) return null;
        return { price: this.asks[0][0], qty: this.asks[0][1] };
    }

    update(price: number, qty: number, isBid: boolean) {
        this.applyDelta(isBid ? [[price, qty]] : [], isBid ? [] : [[price, qty]]);
    }
}

export interface Opportunity {
    exchange: string;
    path: string[]; // [AssetA, AssetB, AssetC]
    actions: { symbol: string, side: 'BUY' | 'SELL' }[];
    maxExecutableUSDT: number;
    profitPct: number;
    estimatedSlippage: number; // fraction 0-1
    timestamp: number;
}

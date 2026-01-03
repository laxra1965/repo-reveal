
import { OrderBook as SharedOrderBook, Level } from '../../../shared/src/types';

export class OrderBook extends SharedOrderBook {
    constructor(symbol: string) {
        super(symbol);
    }

    /**
     * Resets the order book (Step 2)
     */
    reset() {
        this.bids = [];
        this.asks = [];
        this.timestamp = Date.now();
    }

    /**
     * Updates a single side (Step 4)
     */
    updateSide(side: 'bids' | 'asks', price: number, qty: number) {
        const book = side === 'bids' ? this.bids : this.asks;
        const idx = book.findIndex(l => l[0] === price);

        if (qty === 0) {
            if (idx !== -1) book.splice(idx, 1);
        } else {
            if (idx !== -1) {
                book[idx] = [price, qty];
            } else {
                book.push([price, qty]);
            }
        }

        // keep sorted: bids DESC, asks ASC
        book.sort((a, b) => side === 'bids' ? b[0] - a[0] : a[0] - b[0]);
        this.timestamp = Date.now();
    }
}

export { SharedOrderBook };

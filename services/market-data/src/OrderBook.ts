
import { OrderBook as SharedOrderBook } from '../../../shared/src/types';

export class OrderBook extends SharedOrderBook {
    // Keep the same class name but inherit from shared for logic consistency
    // This allows us to keep existing imports working while using the new logic.
    // Or we can just export it.
}

export { SharedOrderBook };

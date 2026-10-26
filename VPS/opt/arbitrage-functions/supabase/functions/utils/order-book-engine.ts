import { logInfo, logError, logDebug } from './logger.ts';

/**
 * Real Order Book Depth Engine
 * Maintains live order book snapshots and provides advanced depth analysis
 * Tracks: mid-price, spread, cumulative volume, liquidity concentration, pressure
 */

interface OrderLevel {
  price: number;
  size: number;
  cumulative_size: number;
  cumulative_value: number;
}

interface OrderBook {
  symbol: string;
  exchange: string;
  timestamp: number;
  sequence: number; // For tracking updates
  bids: OrderLevel[];
  asks: OrderLevel[];
  raw_bids: Array<[number, number]>; // [price, size] pairs
  raw_asks: Array<[number, number]>;
}

interface DepthAnalysis {
  mid_price: number;
  spread: number;
  spread_bps: number; // basis points
  bid_askImbalance: number; // -1 to 1: -1 = all asks, 1 = all bids
  bidSideVolume_5: number; // cumulative volume for top 5 levels
  askSideVolume_5: number;
  bidSideVolume_10: number;
  askSideVolume_10: number;
  bidSideVolume_20: number;
  askSideVolume_20: number;
  cumImbalance_5: number; // ratio of bid/ask volume at depth 5
  cumImbalance_10: number;
  cumImbalance_20: number;
  avgBidPrice_5: number;
  avgAskPrice_5: number;
  priceDepth_1pct: number; // price levels to move price 1%
  priceDepth_5pct: number;
  liquidityIndex: number; // 0-1, higher = better liquidity
  timeDecayFactor: number; // 0-1, decay from request time
}

interface ExchangeSpecificConfig {
  maxLevels: number;
  updateInterval: number; // ms
  useWeighting: boolean;
}

// Exchange-specific configurations
const EXCHANGE_CONFIG: Record<string, ExchangeSpecificConfig> = {
  binance: { maxLevels: 50, updateInterval: 100, useWeighting: true },
  bybit: { maxLevels: 50, updateInterval: 150, useWeighting: true },
  gate: { maxLevels: 50, updateInterval: 200, useWeighting: false },
  mexc: { maxLevels: 50, updateInterval: 200, useWeighting: false },
  kucoin: { maxLevels: 20, updateInterval: 300, useWeighting: false },
  okx: { maxLevels: 50, updateInterval: 150, useWeighting: true },
};

class OrderBookEngine {
  private books: Map<string, OrderBook> = new Map();
  private bookHistory: Map<string, OrderBook[]> = new Map(); // Keep last 10 snapshots
  private lastUpdateTime: Map<string, number> = new Map();
  private requestCache: Map<string, { data: OrderBook; time: number }> = new Map();
  private cacheExpiry = 2000; // 2 seconds

  /**
   * Fetch and cache order book from exchange API
   */
  async fetchOrderBook(
    exchange: string,
    symbol: string,
    useCache: boolean = true
  ): Promise<OrderBook | null> {
    const cacheKey = `${exchange}:${symbol}`;
    const now = Date.now();

    // Check cache first
    if (useCache && this.requestCache.has(cacheKey)) {
      const cached = this.requestCache.get(cacheKey)!;
      if (now - cached.time < this.cacheExpiry) {
        return cached.data;
      }
    }

    try {
      const book = await this._fetchFromExchange(exchange, symbol);
      if (book) {
        this.books.set(cacheKey, book);
        this.requestCache.set(cacheKey, { data: book, time: now });
        this.lastUpdateTime.set(cacheKey, now);

        // Keep history (last 10 snapshots)
        if (!this.bookHistory.has(cacheKey)) {
          this.bookHistory.set(cacheKey, []);
        }
        const history = this.bookHistory.get(cacheKey)!;
        history.push({ ...book });
        if (history.length > 10) history.shift();

        logDebug('order-book-engine', 'Fetched order book', {
          exchange,
          symbol,
          bid_count: book.bids.length,
          ask_count: book.asks.length,
        });
      }
      return book;
    } catch (error) {
      logError('order-book-engine', `Order book fetch failed for ${exchange} ${symbol}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Exchange-specific order book fetching
   */
  private async _fetchFromExchange(exchange: string, symbol: string): Promise<OrderBook | null> {
    const config = EXCHANGE_CONFIG[exchange.toLowerCase()] || EXCHANGE_CONFIG.binance;
    const exSymbol = this._standardizeSymbol(exchange, symbol);
    const now = Date.now();

    try {
      if (exchange.toLowerCase() === 'binance') {
        const response = await fetch(
          `https://api.binance.com/api/v3/depth?symbol=${exSymbol}&limit=${config.maxLevels}`
        );
        if (!response.ok) throw new Error(`Binance API ${response.status}`);
        const data = await response.json();

        return this._buildOrderBook(
          symbol,
          exchange,
          data.bids || [],
          data.asks || [],
          now,
          data.lastUpdateId || 0
        );
      }

      if (exchange.toLowerCase() === 'bybit') {
        const response = await fetch(
          `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${exSymbol}&limit=${config.maxLevels}`
        );
        if (!response.ok) throw new Error(`Bybit API ${response.status}`);
        const data = await response.json();

        const bids = data.result?.b || [];
        const asks = data.result?.a || [];

        return this._buildOrderBook(symbol, exchange, bids, asks, now, data.result?.u || 0);
      }

      if (exchange.toLowerCase() === 'gate') {
        const response = await fetch(
          `https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${exSymbol}&limit=${config.maxLevels}`
        );
        if (!response.ok) throw new Error(`Gate API ${response.status}`);
        const data = await response.json();

        return this._buildOrderBook(
          symbol,
          exchange,
          data.bids || [],
          data.asks || [],
          now,
          data.id || 0
        );
      }

      if (exchange.toLowerCase() === 'mexc') {
        const response = await fetch(
          `https://api.mexc.com/api/v3/depth?symbol=${exSymbol}&limit=${config.maxLevels}`
        );
        if (!response.ok) throw new Error(`MEXC API ${response.status}`);
        const data = await response.json();

        return this._buildOrderBook(
          symbol,
          exchange,
          data.bids || [],
          data.asks || [],
          now,
          0
        );
      }

      if (exchange.toLowerCase() === 'kucoin') {
        const response = await fetch(
          `https://api.kucoin.com/api/v1/market/orderbook/level2_${config.maxLevels}?symbol=${exSymbol}`
        );
        if (!response.ok) throw new Error(`KuCoin API ${response.status}`);
        const data = await response.json();

        return this._buildOrderBook(
          symbol,
          exchange,
          data.data?.bids || [],
          data.data?.asks || [],
          now,
          0
        );
      }

      if (exchange.toLowerCase() === 'okx') {
        const response = await fetch(
          `https://www.okx.com/api/v5/market/books?instId=${exSymbol}&sz=${config.maxLevels}`
        );
        if (!response.ok) throw new Error(`OKX API ${response.status}`);
        const data = await response.json();

        const book = data.data?.[0] || {};
        return this._buildOrderBook(
          symbol,
          exchange,
          book.bids || [],
          book.asks || [],
          now,
          0
        );
      }

      return null;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Standardize symbol format per exchange requirements
   */
  private _standardizeSymbol(exchange: string, symbol: string): string {
    let upper = symbol.toUpperCase();
    const ex = exchange.toLowerCase();

    // Global MATIC -> POL mapping
    if (upper === 'MATICUSDT') upper = 'POLUSDT';
    if (upper === 'MATIC-USDT') upper = 'POL-USDT';
    if (upper === 'MATIC_USDT') upper = 'POL_USDT';

    if (ex === 'gate') {
      return upper.includes('_') ? upper : upper.replace(/([A-Z]+)([A-Z]{4})$/, '$1_$2');
    }
    if (ex === 'kucoin' || ex === 'okx') {
      return upper.includes('-') ? upper : upper.replace(/([A-Z]+)([A-Z]{4})$/, '$1-$2');
    }
    return upper;
  }

  /**
   * Build normalized order book with cumulative metrics
   */
  private _buildOrderBook(
    symbol: string,
    exchange: string,
    rawBids: Array<any>,
    rawAsks: Array<any>,
    timestamp: number,
    sequence: number
  ): OrderBook {
    // Parse and normalize
    const bids = rawBids
      .map(b => {
        const price = typeof b[0] === 'string' ? parseFloat(b[0]) : b[0];
        const size = typeof b[1] === 'string' ? parseFloat(b[1]) : b[1];
        return price > 0 && size > 0 ? { price, size } : null;
      })
      .filter((b): b is { price: number; size: number } => b !== null)
      .sort((a, b) => b.price - a.price); // Highest bid first

    const asks = rawAsks
      .map(a => {
        const price = typeof a[0] === 'string' ? parseFloat(a[0]) : a[0];
        const size = typeof a[1] === 'string' ? parseFloat(a[1]) : a[1];
        return price > 0 && size > 0 ? { price, size } : null;
      })
      .filter((a): a is { price: number; size: number } => a !== null)
      .sort((a, b) => a.price - b.price); // Lowest ask first

    // Compute cumulative metrics
    const bidsWithCum: OrderLevel[] = [];
    const asksWithCum: OrderLevel[] = [];

    let cumSize = 0,
      cumValue = 0;
    for (const bid of bids) {
      cumSize += bid.size;
      cumValue += bid.price * bid.size;
      bidsWithCum.push({
        ...bid,
        cumulative_size: cumSize,
        cumulative_value: cumValue,
      });
    }

    cumSize = 0;
    cumValue = 0;
    for (const ask of asks) {
      cumSize += ask.size;
      cumValue += ask.price * ask.size;
      asksWithCum.push({
        ...ask,
        cumulative_size: cumSize,
        cumulative_value: cumValue,
      });
    }

    return {
      symbol,
      exchange,
      timestamp,
      sequence,
      bids: bidsWithCum,
      asks: asksWithCum,
      raw_bids: bids.map(b => [b.price, b.size]),
      raw_asks: asks.map(a => [a.price, a.size]),
    };
  }

  /**
   * Update order book with incremental delta (e.g. from WebSocket)
   */
  public updateOrderBook(
    exchange: string,
    symbol: string,
    bids: Array<[number, number]>,
    asks: Array<[number, number]>,
    sequence: number,
    timestamp: number = Date.now(),
    firstSequence?: number
  ): boolean {
    const cacheKey = `${exchange}:${symbol}`;
    const book = this.books.get(cacheKey);

    if (!book) return false;

    // Sequencing check for Binance/other exchanges
    if (sequence > 0 && book.sequence > 0) {
      // BINANCE SPECIFIC HANDOFF:
      // u is 'sequence' (final update ID), U is 'firstSequence' (first update ID)
      // Snapshot sequence is 'lastUpdateId'
      
      // 1. If this event is entirely before the snapshot, ignore it
      if (sequence <= book.sequence) {
        return true; 
      }

      // 2. Handoff check (first update after snapshot)
      // If we just synced (sequence was low or this is first update since sync)
      // We allow a gap if firstSequence <= lastUpdateId + 1
      const isFirstUpdate = Date.now() - book.timestamp < 10000 && book.sequence > 0;
      
      if (isFirstUpdate && firstSequence !== undefined) {
          if (firstSequence > book.sequence + 1) {
              logError('order-book-engine', `Sequence gap in handoff for ${cacheKey}: ${book.sequence} -> ${firstSequence}`);
              return false;
          }
          // Valid handoff!
      } else if (sequence !== book.sequence + 1) {
          // Standard delta sequencing check
          // Some exchanges (Bybit) might not provide 'U', so we fall back to u = last_u + 1
          if (firstSequence !== undefined && firstSequence !== book.sequence + 1) {
              logError('order-book-engine', `Sequence gap detected for ${cacheKey}: ${book.sequence} -> ${firstSequence}`);
              return false;
          }
      }
    }

    // Update raw bids/asks
    const updateSide = (current: Array<[number, number]>, updates: Array<[number, number]>, isBid: boolean) => {
      const map = new Map(current);
      for (const [price, size] of updates) {
        if (size === 0) {
          map.delete(price);
        } else {
          map.set(price, size);
        }
      }
      return Array.from(map.entries()).sort((a, b) => isBid ? b[0] - a[0] : a[0] - b[0]);
    };

    const newRawBids = updateSide(book.raw_bids, bids, true);
    const newRawAsks = updateSide(book.raw_asks, asks, false);

    // Rebuild the book with cumulative metrics
    const updatedBook = this._buildOrderBook(
      symbol,
      exchange,
      newRawBids,
      newRawAsks,
      timestamp,
      sequence
    );

    this.books.set(cacheKey, updatedBook);
    this.lastUpdateTime.set(cacheKey, timestamp);

    return true;
  }

  /**
   * Real Depth Walk simulation for triangular arbitrage
   * Replaces top-of-book only simulation with a real order book walk
   * @param ob OrderBook snapshot
   * @param action 'BUY' (quote to base) or 'SELL' (base to quote)
   * @param amount Source currency amount (quote if BUY, base if SELL)
   * @returns Acquired currency amount, or null if liquidity is insufficient
   */
  public consumeOrderBook(
    ob: OrderBook,
    action: 'BUY' | 'SELL',
    amount: number
  ): number | null {
    let remaining = amount;
    let acquired = 0;

    // BUY means we are taking from ASKS (buying from sellers)
    // SELL means we are taking from BIDS (selling to buyers)
    const levels = action === 'BUY' ? ob.asks : ob.bids;

    if (!levels || levels.length === 0) return null;

    for (const level of levels) {
      if (remaining <= 0.00000001) break;

      const price = level.price;
      const qty = level.size;

      if (action === 'BUY') {
        // We have 'remaining' amount of quote currency (e.g. USDT)
        // We want to buy base currency (e.g. BTC)
        const maxCanBuy = remaining / price;
        const tradeSize = Math.min(maxCanBuy, qty);
        
        acquired += tradeSize;
        remaining -= tradeSize * price;
      } else {
        // We have 'remaining' amount of base currency (e.g. BTC)
        // We want to sell it for quote currency (e.g. USDT)
        const tradeSize = Math.min(remaining, qty);
        
        acquired += tradeSize * price;
        remaining -= tradeSize;
      }
    }

    // If we still have significant remaining amount, it means liquidity was insufficient
    return remaining > 0.00000001 ? null : acquired;
  }

  /**
   * Analyze order book depth and return comprehensive metrics
   */
  analyzeDepth(book: OrderBook, currentTime: number = Date.now()): DepthAnalysis {
    if (book.bids.length === 0 || book.asks.length === 0) {
      return this._emptyAnalysis();
    }

    const bestBid = book.bids[0];
    const bestAsk = book.asks[0];

    // 1. Mid-price and spread
    const midPrice = (bestBid.price + bestAsk.price) / 2;
    const spread = bestAsk.price - bestBid.price;
    const spreadBps = (spread / midPrice) * 10000;

    // 2. Volume analysis for various depths
    const bidVol5 = this._cumulativeVolume(book.bids, 5);
    const askVol5 = this._cumulativeVolume(book.asks, 5);
    const bidVol10 = this._cumulativeVolume(book.bids, 10);
    const askVol10 = this._cumulativeVolume(book.asks, 10);
    const bidVol20 = this._cumulativeVolume(book.bids, 20);
    const askVol20 = this._cumulativeVolume(book.asks, 20);

    // 3. Bid-ask imbalance (-1 = all asks, 0 = balanced, 1 = all bids)
    const totalVol = bidVol20 + askVol20;
    const bidAskImbalance =
      totalVol > 0 ? (bidVol20 - askVol20) / totalVol : 0;

    // 4. Cumulative imbalance (buy pressure vs sell pressure)
    const cumImbalance5 = askVol5 > 0 ? bidVol5 / askVol5 : 0;
    const cumImbalance10 = askVol10 > 0 ? bidVol10 / askVol10 : 0;
    const cumImbalance20 = askVol20 > 0 ? bidVol20 / askVol20 : 0;

    // 5. Average prices for each side
    const avgBidPrice5 = this._averagePrice(book.bids, 5);
    const avgAskPrice5 = this._averagePrice(book.asks, 5);

    // 6. Price depth analysis (levels needed to move price by X%)
    const priceDepth1pct = this._levelsToMovePrice(book, midPrice * 0.01);
    const priceDepth5pct = this._levelsToMovePrice(book, midPrice * 0.05);

    // 7. Liquidity Index (0-1, higher is better)
    const liquidityIndex = this._calculateLiquidityIndex(book, spreadBps);

    // 8. Time decay factor (freshness)
    const ageSec = (currentTime - book.timestamp) / 1000;
    const timeDecayFactor = Math.max(0, 1 - ageSec / 60); // 0 after 1 minute

    return {
      mid_price: midPrice,
      spread,
      spread_bps: spreadBps,
      bid_askImbalance: bidAskImbalance,
      bidSideVolume_5: bidVol5,
      askSideVolume_5: askVol5,
      bidSideVolume_10: bidVol10,
      askSideVolume_10: askVol10,
      bidSideVolume_20: bidVol20,
      askSideVolume_20: askVol20,
      cumImbalance_5: cumImbalance5,
      cumImbalance_10: cumImbalance10,
      cumImbalance_20: cumImbalance20,
      avgBidPrice_5: avgBidPrice5,
      avgAskPrice_5: avgAskPrice5,
      priceDepth_1pct: priceDepth1pct,
      priceDepth_5pct: priceDepth5pct,
      liquidityIndex,
      timeDecayFactor,
    };
  }

  /**
   * Estimate impact of a trade size on prices
   * Returns: {buy_impact, sell_impact} as percentage movement
   */
  estimateTradeImpact(book: OrderBook, tradeSize: number, side: 'buy' | 'sell'): {
    impact_pct: number;
    avg_fill_price: number;
    slippage_pct: number;
  } {
    if (book.asks.length === 0 || book.bids.length === 0) {
      return { impact_pct: 1, avg_fill_price: 0, slippage_pct: 1 };
    }

    const levels = side === 'buy' ? book.asks : book.bids;
    const bestPrice = side === 'buy' ? book.asks[0].price : book.bids[0].price;

    let remainingSize = tradeSize;
    let totalCost = 0;

    for (const level of levels) {
      if (remainingSize <= 0) break;

      const fillSize = Math.min(remainingSize, level.size);
      totalCost += fillSize * level.price;
      remainingSize -= fillSize;
    }

    const avgPrice = totalCost > 0 ? totalCost / tradeSize : bestPrice;
    const impactPct = Math.abs(avgPrice - bestPrice) / bestPrice;
    const slippagePct = impactPct; // Direct correlation

    return {
      impact_pct: impactPct,
      avg_fill_price: avgPrice,
      slippage_pct: slippagePct,
    };
  }

  /**
   * Get order book snapshot (immutable copy)
   */
  getSnapshot(exchange: string, symbol: string): OrderBook | null {
    return this.books.get(`${exchange}:${symbol}`) || null;
  }

  /**
   * Get order book history
   */
  getHistory(exchange: string, symbol: string): OrderBook[] {
    return this.bookHistory.get(`${exchange}:${symbol}`) || [];
  }

  /**
   * Clear cache for forced refresh
   */
  clearCache(exchange?: string, symbol?: string): void {
    if (exchange && symbol) {
      this.requestCache.delete(`${exchange}:${symbol}`);
    } else {
      this.requestCache.clear();
    }
  }

  // ===== Private helpers =====

  private _emptyAnalysis(): DepthAnalysis {
    return {
      mid_price: 0,
      spread: 0,
      spread_bps: 0,
      bid_askImbalance: 0,
      bidSideVolume_5: 0,
      askSideVolume_5: 0,
      bidSideVolume_10: 0,
      askSideVolume_10: 0,
      bidSideVolume_20: 0,
      askSideVolume_20: 0,
      cumImbalance_5: 0,
      cumImbalance_10: 0,
      cumImbalance_20: 0,
      avgBidPrice_5: 0,
      avgAskPrice_5: 0,
      priceDepth_1pct: 0,
      priceDepth_5pct: 0,
      liquidityIndex: 0,
      timeDecayFactor: 0,
    };
  }

  private _cumulativeVolume(side: OrderLevel[], levels: number): number {
    return side.slice(0, levels).reduce((sum, level) => sum + level.size, 0);
  }

  private _averagePrice(side: OrderLevel[], levels: number): number {
    const topLevels = side.slice(0, levels);
    if (topLevels.length === 0) return 0;

    const totalValue = topLevels.reduce((sum, level) => sum + level.price * level.size, 0);
    const totalSize = topLevels.reduce((sum, level) => sum + level.size, 0);

    return totalSize > 0 ? totalValue / totalSize : 0;
  }

  private _levelsToMovePrice(book: OrderBook, priceMove: number): number {
    const bestBid = book.bids[0];
    const bestAsk = book.asks[0];

    // For buy side: how many levels to absorb volume and move price up
    let buyLevels = 0;
    let absorbedCost = 0;
    for (const level of book.asks) {
      absorbedCost += level.price * level.size;
      buyLevels++;
      if (absorbedCost >= priceMove) break;
    }

    // For sell side: how many levels to absorb volume and move price down
    let sellLevels = 0;
    absorbedCost = 0;
    for (const level of book.bids) {
      absorbedCost += level.price * level.size;
      sellLevels++;
      if (absorbedCost >= priceMove) break;
    }

    return Math.max(buyLevels, sellLevels);
  }

  private _calculateLiquidityIndex(book: OrderBook, spreadBps: number): number {
    // Based on: spread (tighter = better), depth (deeper = better), balance
    const spreadScore = Math.max(0, 1 - spreadBps / 100); // 0 at 100 bps spread
    const depthScore = Math.min(1, (book.bids.length + book.asks.length) / 100); // 1 at 100 levels
    const bidVol5 = this._cumulativeVolume(book.bids, 5);
    const askVol5 = this._cumulativeVolume(book.asks, 5);
    const depthVolScore = Math.min(
      1,
      (Math.min(bidVol5, askVol5) || 0) / 100000
    );

    return (spreadScore * 0.4 + depthScore * 0.35 + depthVolScore * 0.25) * 0.95; // Max 0.95
  }
}

// Export singleton instance
export const orderBookEngine = new OrderBookEngine();

export type { OrderBook, DepthAnalysis, OrderLevel };

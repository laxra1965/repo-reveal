import { logDebug, logInfo } from './logger.ts';
import { orderBookEngine, type OrderBook, type DepthAnalysis } from './order-book-engine.ts';

/**
 * Accurate Slippage Predictor
 * Predicts execution slippage based on:
 * - Order book depth and structure
 * - Trade size relative to liquidity
 * - Historical volatility
 * - Market microstructure
 * - Time-of-execution impact
 */

interface SlippagePrediction {
  estimated_slippage_bps: number; // basis points
  estimated_slippage_pct: number; // percentage
  avg_execution_price: number;
  worst_case_slippage_bps: number; // 95th percentile
  best_case_slippage_bps: number; // 5th percentile
  confidence_score: number; // 0-1, higher = more confident
  factors: {
    spread_impact: number;
    depth_impact: number;
    size_impact: number;
    volatility_impact: number;
    liquidity_ratio: number;
  };
  recommendation: 'EXECUTE' | 'WARN' | 'AVOID'; // Action recommendation
  reasoning: string;
}

interface HistoricalVolatility {
  volatility_1m: number; // 1-minute volatility
  volatility_5m: number;
  volatility_15m: number;
  volatility_1h: number;
}

class SlippagePredictor {
  // Store trade history for volatility calculation
  private tradeHistory: Map<string, Array<{ price: number; time: number }>> = new Map();
  private maxHistorySize = 100;

  /**
   * Predict slippage for a potential trade
   * Uses multiple models and averages results
   */
  predictSlippage(
    book: OrderBook,
    tradeSize: number,
    side: 'buy' | 'sell',
    depth: DepthAnalysis,
    pair: string = ''
  ): SlippagePrediction {
    if (book.asks.length === 0 || book.bids.length === 0) {
      return this._getEmptyPrediction('Order book missing data');
    }

    // Step 1: Calculate base spread impact
    const spreadImpact = this._calculateSpreadImpact(depth.spread, depth.mid_price);

    // Step 2: Calculate liquidity depth impact
    const depthImpact = this._calculateDepthImpact(book, tradeSize, side);

    // Step 3: Calculate trade size impact (nonlinear)
    const sizeImpact = this._calculateSizeImpact(book, tradeSize, side, depth);

    // Step 4: Estimate volatility impact (if we have history)
    const volatilityImpact = this._estimateVolatilityImpact(pair);

    // Step 5: Combine impacts using weighted model
    const combinedSlippage = this._combineImpactFactors(
      spreadImpact,
      depthImpact,
      sizeImpact,
      volatilityImpact
    );

    // Step 6: Calculate execution price and confidence
    const bestPrice = side === 'buy' ? book.asks[0].price : book.bids[0].price;
    const avgExecutionPrice = bestPrice * (1 + combinedSlippage);
    const confidenceScore = this._calculateConfidence(book, tradeSize, depth);

    // Step 7: Estimate best/worst case (±2σ)
    const slippageStdDev = combinedSlippage * 0.3; // Assume 30% std dev
    const bestCaseSlippage = Math.max(0, combinedSlippage - 2 * slippageStdDev);
    const worstCaseSlippage = combinedSlippage + 2 * slippageStdDev;

    // Step 8: Generate recommendation
    const recommendation = this._generateRecommendation(
      combinedSlippage,
      confidenceScore,
      book,
      tradeSize,
      depth
    );

    // Step 9: Generate reasoning
    const reasoning = this._generateReasoning(
      combinedSlippage,
      recommendation,
      spreadImpact,
      depthImpact,
      sizeImpact,
      book,
      tradeSize
    );

    return {
      estimated_slippage_bps: combinedSlippage * 10000,
      estimated_slippage_pct: combinedSlippage * 100,
      avg_execution_price: avgExecutionPrice,
      worst_case_slippage_bps: worstCaseSlippage * 10000,
      best_case_slippage_bps: bestCaseSlippage * 10000,
      confidence_score: confidenceScore,
      factors: {
        spread_impact: spreadImpact,
        depth_impact: depthImpact,
        size_impact: sizeImpact,
        volatility_impact: volatilityImpact,
        liquidity_ratio: tradeSize / Math.max(1, depth.bidSideVolume_10 + depth.askSideVolume_10),
      },
      recommendation,
      reasoning,
    };
  }

  /**
   * Record a trade for volatility tracking
   */
  recordTrade(pair: string, price: number, time: number = Date.now()): void {
    if (!this.tradeHistory.has(pair)) {
      this.tradeHistory.set(pair, []);
    }
    const trades = this.tradeHistory.get(pair)!;
    trades.push({ price, time });

    // Keep only recent history
    if (trades.length > this.maxHistorySize) {
      trades.shift();
    }
  }

  /**
   * Get historical volatility for a pair
   */
  getHistoricalVolatility(pair: string): HistoricalVolatility {
    const trades = this.tradeHistory.get(pair) || [];
    if (trades.length < 2) {
      return {
        volatility_1m: 0.01,
        volatility_5m: 0.015,
        volatility_15m: 0.02,
        volatility_1h: 0.025,
      };
    }

    const now = Date.now();
    const returns: number[] = [];

    for (let i = 1; i < trades.length; i++) {
      const ret = Math.log(trades[i].price / trades[i - 1].price);
      returns.push(ret);
    }

    // Calculate simple standard deviation of returns
    const vol = this._calculateStdDev(returns);

    // Scale up based on time intervals (annualization approximation)
    return {
      volatility_1m: Math.max(0.001, vol * 0.5),
      volatility_5m: Math.max(0.002, vol * 1.0),
      volatility_15m: Math.max(0.003, vol * 1.5),
      volatility_1h: Math.max(0.005, vol * 2.0),
    };
  }

  /**
   * Predict multi-leg slippage (for triangular paths)
   * Assumes sequential execution
   */
  predictTriangularSlippage(
    books: [OrderBook, OrderBook, OrderBook],
    tradeSize: number,
    depths: [DepthAnalysis, DepthAnalysis, DepthAnalysis],
    pair: string = ''
  ): {
    leg1: SlippagePrediction;
    leg2: SlippagePrediction;
    leg3: SlippagePrediction;
    total_slippage_bps: number;
    total_slippage_pct: number;
  } {
    const leg1 = this.predictSlippage(books[0], tradeSize, 'buy', depths[0], pair + '_leg1');
    // After leg1 slippage, we have less to work with
    const amountAfterLeg1 = tradeSize / (1 + leg1.estimated_slippage_pct / 100);
    const leg2 = this.predictSlippage(books[1], amountAfterLeg1, 'buy', depths[1], pair + '_leg2');
    const amountAfterLeg2 = amountAfterLeg1 / (1 + leg2.estimated_slippage_pct / 100);
    const leg3 = this.predictSlippage(books[2], amountAfterLeg2, 'sell', depths[2], pair + '_leg3');

    // Combined slippage (multiplicative)
    const totalSlippagePct = (1 + leg1.estimated_slippage_pct / 100) * 
                              (1 + leg2.estimated_slippage_pct / 100) * 
                              (1 + leg3.estimated_slippage_pct / 100) - 1;

    return {
      leg1,
      leg2,
      leg3,
      total_slippage_bps: totalSlippagePct * 10000,
      total_slippage_pct: totalSlippagePct * 100,
    };
  }

  // ===== Private model methods =====

  /**
   * Spread impact model
   * Wide spreads = higher slippage
   */
  private _calculateSpreadImpact(spread: number, midPrice: number): number {
    const spreadRatio = spread / midPrice;
    // Linear: slippage is roughly half the spread for market orders
    return Math.min(spreadRatio * 0.5, 0.05); // Cap at 5%
  }

  /**
   * Depth impact model
   * Based on order book depth and structure
   */
  private _calculateDepthImpact(book: OrderBook, tradeSize: number, side: 'buy' | 'sell'): number {
    const levels = side === 'buy' ? book.asks : book.bids;
    if (levels.length === 0) return 0.1;

    // Calculate how many levels we need to penetrate
    let accumulatedSize = 0;
    let levelsNeeded = 0;

    for (const level of levels) {
      accumulatedSize += level.size;
      levelsNeeded++;
      if (accumulatedSize >= tradeSize) break;
    }

    // Depth score: 0 (good) to 1 (bad)
    // Penetrating more levels = worse depth
    const depthScore = Math.min(levelsNeeded / 10, 1); // 10 levels = score 1

    // Also consider if we fully exhaust available depth
    const totalAvailableSize = levels.reduce((sum, l) => sum + l.size, 0);
    const insufficientDepth = tradeSize > totalAvailableSize ? (1 - totalAvailableSize / tradeSize) * 0.5 : 0;

    return Math.min(depthScore * 0.02 + insufficientDepth, 0.1); // Max 10%
  }

  /**
   * Trade size impact model
   * Larger trades relative to liquidity = higher slippage
   * Uses nonlinear scaling (square root rule)
   */
  private _calculateSizeImpact(
    book: OrderBook,
    tradeSize: number,
    side: 'buy' | 'sell',
    depth: DepthAnalysis
  ): number {
    // Get relevant liquidity metric
    const availableLiquidity = side === 'buy' ? depth.askSideVolume_20 : depth.bidSideVolume_20;
    if (availableLiquidity <= 0) return 0.1;

    // Size ratio
    const sizeRatio = Math.min(tradeSize / availableLiquidity, 2); // Cap at 2x

    // Square root model (market microstructure)
    // Small trades: 0.001% slippage per unit of size ratio
    // Large trades: increases nonlinearly
    const baseSlippage = 0.0001;
    const sizeImpact = baseSlippage * (Math.sqrt(sizeRatio) - 1) * 100;

    return Math.min(sizeImpact, 0.15); // Cap at 15%
  }

  /**
   * Volatility impact model
   * Higher volatility = higher execution risk = higher expected slippage
   */
  private _estimateVolatilityImpact(pair: string): number {
    const vol = this.getHistoricalVolatility(pair);

    // Use 5-minute volatility as baseline
    // Each 1% volatility adds ~0.5bps expected slippage
    const volatilityImpact = vol.volatility_5m * 50;

    return Math.min(volatilityImpact, 0.05); // Cap at 5%
  }

  /**
   * Combine all impact factors using weighted model
   */
  private _combineImpactFactors(
    spreadImpact: number,
    depthImpact: number,
    sizeImpact: number,
    volatilityImpact: number
  ): number {
    // Weights based on empirical market microstructure research
    const weights = {
      spread: 0.35,
      depth: 0.25,
      size: 0.25,
      volatility: 0.15,
    };

    const combined =
      spreadImpact * weights.spread +
      depthImpact * weights.depth +
      sizeImpact * weights.size +
      volatilityImpact * weights.volatility;

    return Math.max(0, combined);
  }

  /**
   * Calculate confidence in prediction (0-1)
   * Depends on: order book freshness, depth, data quality
   */
  private _calculateConfidence(
    book: OrderBook,
    tradeSize: number,
    depth: DepthAnalysis
  ): number {
    let confidence = 0.9; // Start high

    // Reduce confidence if order book is old
    const ageSec = (Date.now() - book.timestamp) / 1000;
    if (ageSec > 5) confidence -= 0.1;
    if (ageSec > 10) confidence -= 0.2;

    // Reduce confidence if insufficient depth
    if (book.bids.length < 10 || book.asks.length < 10) {
      confidence -= 0.15;
    }

    // Reduce confidence if we need to penetrate many levels
    const totalLiquidity = depth.bidSideVolume_20 + depth.askSideVolume_20;
    if (tradeSize > totalLiquidity * 0.5) {
      confidence -= 0.2;
    }

    // Reduce confidence if spread is very wide (stale data)
    if (depth.spread_bps > 50) {
      confidence -= 0.1;
    }

    return Math.max(0.3, confidence); // Min confidence 0.3
  }

  /**
   * Generate action recommendation
   */
  private _generateRecommendation(
    slippage: number,
    confidence: number,
    book: OrderBook,
    tradeSize: number,
    depth: DepthAnalysis
  ): 'EXECUTE' | 'WARN' | 'AVOID' {
    // High slippage
    if (slippage > 0.02) return 'AVOID'; // >2%

    // Medium slippage or low confidence
    if (slippage > 0.01 || confidence < 0.5) return 'WARN'; // >1%

    // Check liquidity sufficiency
    const totalLiquidity = depth.bidSideVolume_20 + depth.askSideVolume_20;
    if (tradeSize > totalLiquidity * 0.3) return 'WARN';

    return 'EXECUTE';
  }

  /**
   * Generate human-readable reasoning
   */
  private _generateReasoning(
    slippage: number,
    recommendation: string,
    spreadImpact: number,
    depthImpact: number,
    sizeImpact: number,
    book: OrderBook,
    tradeSize: number
  ): string {
    const parts: string[] = [];

    if (slippage < 0.001) {
      parts.push('Excellent liquidity, minimal slippage expected.');
    } else if (slippage < 0.005) {
      parts.push('Good liquidity with low slippage.');
    } else if (slippage < 0.02) {
      parts.push('Moderate slippage due to trade size relative to liquidity.');
    } else {
      parts.push('High slippage expected - consider reducing trade size or breaking into multiple orders.');
    }

    const topFactors: [string, number][] = [
      ['spread', spreadImpact],
      ['depth', depthImpact],
      ['size', sizeImpact],
    ].sort((a, b) => (b[1] as number) - (a[1] as number)) as [string, number][];

    parts.push(
      `Primary factors: ${topFactors.map((f) => `${f[0]} (${((f[1] as number) * 100).toFixed(2)}%)`).join(', ')}`
    );

    if (sizeImpact > 0.01) {
      const totalAsks = book.asks.reduce((s, l) => s + l.size, 0);
      const avgLevelSize = totalAsks / Math.max(1, book.asks.length);
      parts.push(`Trade size is ${(tradeSize / Math.max(0.0001, avgLevelSize)).toFixed(1)}x the average depth level.`);
    }

    return parts.join(' ');
  }

  // ===== Utility methods =====

  private _calculateStdDev(values: number[]): number {
    if (values.length < 2) return 0;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;

    return Math.sqrt(variance);
  }

  private _getEmptyPrediction(reason: string): SlippagePrediction {
    return {
      estimated_slippage_bps: 10000, // 100% slippage for safety
      estimated_slippage_pct: 100,
      avg_execution_price: 0,
      worst_case_slippage_bps: 10000,
      best_case_slippage_bps: 10000,
      confidence_score: 0,
      factors: {
        spread_impact: 1,
        depth_impact: 1,
        size_impact: 1,
        volatility_impact: 1,
        liquidity_ratio: 1,
      },
      recommendation: 'AVOID',
      reasoning: `DATA ERROR: ${reason}`,
    };
  }
}

// Export singleton instance
export const slippagePredictor = new SlippagePredictor();

export type { SlippagePrediction, HistoricalVolatility };

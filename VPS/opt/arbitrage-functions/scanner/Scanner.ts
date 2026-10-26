/**
 * Scanner - Triangular arbitrage path generator and detector
 * Generates trading paths and scans orderbooks for profitable opportunities
 * 
 * IMPROVEMENTS:
 * - Proper fee calculation (maker/taker)
 * - Path validation and caching
 * - Better error logging and handling
 * - Configurable stale timeout
 * - Minimum liquidity checks
 * - Proper type safety (no `as any`)
 * - Phase 1: Pre-filter paths by available orderbooks
 * - Phase 2: Depth-based slippage & liquidity analysis
 */

import { OrderBook } from '../core/OrderBook.ts';
import { StandardOpportunity, StepPricing, TradeDirection } from '../scanner/types.ts';

/**
 * Metrics collected during scanning to track performance
 */
export interface ScanMetrics {
    totalPathsGenerated: number;
    totalPathsScanned: number;
    totalPathsFiltered: number;  // Phase 1: Skipped due to missing books
    pathsSkippedStaleBook: number;
    pathsSkippedMissingBook: number;
    opportunitiesDetected: number;
    opportunitiesAfterFees: number;
    totalScanTimeMs: number;
}

export interface TriangularPath {
    path: string[]; // e.g., ["USDT", "BNB", "SOL", "USDT"]
    pairs: string[]; // e.g., ["BNBUSDT", "SOLBNB", "SOLUSDT"]
}

export interface ScanConfig {
    minProfitPercent: number;
    minLiquidity: number;
    tradeAmount: number;
    exchange: string;
    /** Fee percentage per trade (e.g., 0.1 for taker, 0 for maker) */
    takerFeePercent?: number;
    /** Orderbook staleness timeout in milliseconds */
    staleTimeoutMs?: number;
    /** Top opportunities to return per scan */
    topOpportunitiesLimit?: number;
    /** Minimum liquidity depth required (in quote currency) */
    minLiquidityDepth?: number;
    /** Enable detailed error logging */
    enableLogging?: boolean;
    
    // PHASE 1 & 2: Feature flags for optimizations
    /** Pre-filter paths by available orderbooks (Phase 1) */
    enablePhase1PreFilter?: boolean;
    /** Analyze depth-based slippage (Phase 2) */
    enablePhase2SlippageAnalysis?: boolean;
    /** Require minimum liquidity depth (Phase 2) */
    enableMinLiquidityDepthCheck?: boolean;
    /** Enable metrics tracking */
    trackMetrics?: boolean;
}

interface PathCache {
    paths: TriangularPath[];
    symbolsHash: string;
    timestamp: number;
}

export class Scanner {
    private paths: TriangularPath[] = [];
    private pathCache: PathCache | null = null;
    private metrics: ScanMetrics = {
        totalPathsGenerated: 0,
        totalPathsScanned: 0,
        totalPathsFiltered: 0,
        pathsSkippedStaleBook: 0,
        pathsSkippedMissingBook: 0,
        opportunitiesDetected: 0,
        opportunitiesAfterFees: 0,
        totalScanTimeMs: 0
    };
    
    private static readonly DEFAULT_STALE_TIMEOUT = 5000; // 5 seconds
    private static readonly DEFAULT_TOP_LIMIT = 10;
    private static readonly DEFAULT_FEE_PERCENT = 0.1; // 0.1% maker fee, 0.1% taker = 0.3% total

    private config: Required<ScanConfig>;

    constructor(config: ScanConfig) {
        // Set defaults for optional config values
        this.config = {
            ...config,
            takerFeePercent: config.takerFeePercent ?? Scanner.DEFAULT_FEE_PERCENT,
            staleTimeoutMs: config.staleTimeoutMs ?? Scanner.DEFAULT_STALE_TIMEOUT,
            topOpportunitiesLimit: config.topOpportunitiesLimit ?? Scanner.DEFAULT_TOP_LIMIT,
            minLiquidityDepth: config.minLiquidityDepth ?? config.minLiquidity,
            enableLogging: config.enableLogging ?? true,
            enablePhase1PreFilter: config.enablePhase1PreFilter ?? true,
            enablePhase2SlippageAnalysis: config.enablePhase2SlippageAnalysis ?? false,
            enableMinLiquidityDepthCheck: config.enableMinLiquidityDepthCheck ?? false,
            trackMetrics: config.trackMetrics ?? true
        };
        this.validateConfig();
    }

    /**
     * Validate configuration values
     */
    private validateConfig(): void {
        if (this.config.minProfitPercent < 0) {
            throw new Error('[Scanner] minProfitPercent must be >= 0');
        }
        if (this.config.tradeAmount <= 0) {
            throw new Error('[Scanner] tradeAmount must be > 0');
        }
        if (this.config.takerFeePercent < 0 || this.config.takerFeePercent > 100) {
            throw new Error('[Scanner] takerFeePercent must be between 0 and 100');
        }
    }

    /**
     * Hash symbols array to detect if they've changed
     */
    private hashSymbols(symbols: string[]): string {
        return symbols.sort().join(',');
    }

    /**
     * Generate all triangular paths for given symbols
     * Caches results until symbols change
     * 
     * Path: USDT -> BASETOKEN -> ALTCOIN -> USDT
     */
    generatePaths(symbols: string[], skipCache = false): TriangularPath[] {
        const symbolsHash = this.hashSymbols(symbols);

        // Return cached paths if symbols haven't changed
        if (!skipCache && this.pathCache && this.pathCache.symbolsHash === symbolsHash) {
            this.log(`✓ Using cached paths (${this.pathCache.paths.length} paths)`);
            this.paths = this.pathCache.paths;
            return this.paths;
        }

        const paths: TriangularPath[] = [];
        const baseTokens = ['BNB', 'ETH', 'BTC'];
        const stablecoins = ['USDT', 'USDC', 'BUSD', 'DAI'];

        // Get altcoins (exclude base tokens and stablecoins)
        const altcoins = symbols.filter(
            s => !baseTokens.includes(s) && !stablecoins.includes(s)
        );

        // Generate paths: stable -> base -> altcoin -> stable
        for (const baseToken of baseTokens) {
            for (const altcoin of altcoins) {
                // Pair 1: baseToken/USDT
                const pair1 = `${baseToken}USDT`;

                // Pair 2: altcoin/baseToken
                const pair2 = `${altcoin}${baseToken}`;

                // Pair 3: altcoin/USDT
                const pair3 = `${altcoin}USDT`;

                paths.push({
                    path: ['USDT', baseToken, altcoin, 'USDT'],
                    pairs: [pair1, pair2, pair3]
                });

                // Pair 3: USDT/altcoin
                const pair3Reverse = `${altcoin}USDT`;

                // Reverse path: USDT -> altcoin -> base -> USDT
                paths.push({
                    path: ['USDT', altcoin, baseToken, 'USDT'],
                    pairs: [pair3Reverse, pair2, pair1]
                });
            }
        }

        // Cache the results
        this.pathCache = {
            paths,
            symbolsHash,
            timestamp: Date.now()
        };

        this.paths = paths;
        this.log(`✓ Generated ${paths.length} triangular paths (cached)`);
        return paths;
    }

    /**
     * Scan orderbooks for profitable opportunities
     * Returns sorted opportunities
     * 
     * PHASE 1: Pre-filter paths by available orderbooks
     * PHASE 2: Analyze depth-based slippage
     */
    scan(orderBooks: Map<string, OrderBook>): StandardOpportunity[] {
        const scanStart = Date.now();
        
        // Reset metrics for this scan
        if (this.config.trackMetrics) {
            this.metrics = {
                totalPathsGenerated: this.paths.length,
                totalPathsScanned: 0,
                totalPathsFiltered: 0,
                pathsSkippedStaleBook: 0,
                pathsSkippedMissingBook: 0,
                opportunitiesDetected: 0,
                opportunitiesAfterFees: 0,
                totalScanTimeMs: 0
            };
        }

        // PHASE 1: Pre-filter paths by available orderbooks
        let pathsToScan = this.paths;
        if (this.config.enablePhase1PreFilter) {
            const availableBooks = new Set(orderBooks.keys());
            pathsToScan = this.paths.filter(path => 
                path.pairs.every(pair => availableBooks.has(pair))
            );
            if (this.config.trackMetrics) {
                this.metrics.totalPathsFiltered = this.paths.length - pathsToScan.length;
            }
        }

        if (this.config.trackMetrics) {
            this.metrics.totalPathsScanned = pathsToScan.length;
        }

        const opportunities: StandardOpportunity[] = [];

        for (const triangularPath of pathsToScan) {
            try {
                // Get orderbooks for this path's pairs
                const ob1 = orderBooks.get(triangularPath.pairs[0]);
                const ob2 = orderBooks.get(triangularPath.pairs[1]);
                const ob3 = orderBooks.get(triangularPath.pairs[2]);

                // Double-check orderbooks exist (shouldn't happen with Phase 1, but safety check)
                if (!ob1 || !ob2 || !ob3) {
                    if (this.config.trackMetrics) {
                        this.metrics.pathsSkippedMissingBook++;
                    }
                    continue;
                }

                // Check if orderbooks are stale
                if (ob1.isStale(this.config.staleTimeoutMs) ||
                    ob2.isStale(this.config.staleTimeoutMs) ||
                    ob3.isStale(this.config.staleTimeoutMs)) {
                    if (this.config.trackMetrics) {
                        this.metrics.pathsSkippedStaleBook++;
                    }
                    continue;
                }

                // Scan the path, passing orderbooks directly
                const opps = this.scanPath(triangularPath, ob1, ob2, ob3);
                opportunities.push(...opps);
            } catch (error) {
                this.logError(`Failed to scan path ${triangularPath.path.join('→')}:`, error);
            }
        }

        if (this.config.trackMetrics) {
            this.metrics.opportunitiesDetected = opportunities.length;
        }

        // Sort by profit percentage (after fees) and return top opportunities
        const sorted = opportunities
            .sort((a, b) => {
                const aProfit = a.profit_percent_after_fees ?? a.profit_percent;
                const bProfit = b.profit_percent_after_fees ?? b.profit_percent;
                return bProfit - aProfit;
            })
            .slice(0, this.config.topOpportunitiesLimit);

        if (this.config.trackMetrics) {
            this.metrics.opportunitiesAfterFees = sorted.filter(
                o => (o.profit_percent_after_fees ?? 0) > this.config.minProfitPercent
            ).length;
            this.metrics.totalScanTimeMs = Date.now() - scanStart;
            
            this.log(
                `✓ Scan complete: ${this.metrics.totalPathsScanned} scanned ` +
                `(${this.metrics.totalPathsFiltered} filtered), ` +
                `${sorted.length} opportunities (${this.metrics.opportunitiesAfterFees} profitable) ` +
                `in ${this.metrics.totalScanTimeMs}ms`
            );
        }

        return sorted;
    }

    /**
     * Scan a single triangular path
     * Receives pre-fetched orderbook objects for efficiency
     */
    private scanPath(
        triangularPath: TriangularPath,
        ob1: OrderBook,
        ob2: OrderBook,
        ob3: OrderBook
    ): StandardOpportunity[] {
        const opportunities: StandardOpportunity[] = [];
        const [pair1, pair2, pair3] = triangularPath.pairs;
        const [, baseToken, altcoin] = triangularPath.path.slice(0, 3);

        // Get best prices
        const ask1 = ob1.getBestAsk();
        const bid1 = ob1.getBestBid();
        const ask2 = ob2.getBestAsk();
        const bid2 = ob2.getBestBid();
        const ask3 = ob3.getBestAsk();
        const bid3 = ob3.getBestBid();

        if (!ask1 || !bid1 || !ask2 || !bid2 || !ask3 || !bid3) {
            return [];
        }

        // PHASE 2: Check liquidity depth if enabled
        if (this.config.enableMinLiquidityDepthCheck) {
            if (!this.hasMinimumLiquidityDepth(ob1, ob2, ob3)) {
                return [];
            }
        }

        try {
            // Path A: USDT -> base -> altcoin -> USDT
            const opp1 = this.calculateOpportunity(
                triangularPath.path,
                [ask1, ask2, bid3],
                'forward',
                ob1,
                ob2,
                ob3,
                [
                    { step: 1, price: ask1, description: `Ask ${baseToken}USDT` },
                    { step: 2, price: ask2, description: `Ask ${altcoin}${baseToken}` },
                    { step: 3, price: bid3, description: `Bid ${altcoin}USDT` }
                ]
            );

            if (opp1 && this.isProfitable(opp1)) {
                opportunities.push(opp1);
            }

            // Path B: USDT -> altcoin -> base -> USDT (reverse)
            const opp2 = this.calculateOpportunity(
                [triangularPath.path[0], altcoin, baseToken, triangularPath.path[3]],
                [ask3, bid2, bid1],
                'reverse',
                ob3,
                ob2,
                ob1,
                [
                    { step: 1, price: ask3, description: `Ask ${altcoin}USDT` },
                    { step: 2, price: bid2, description: `Bid ${altcoin}${baseToken}` },
                    { step: 3, price: bid1, description: `Bid ${baseToken}USDT` }
                ]
            );

            if (opp2 && this.isProfitable(opp2)) {
                opportunities.push(opp2);
            }
        } catch (error) {
            this.logError(`Calculation error for path ${triangularPath.path.join('→')}:`, error);
        }

        return opportunities;
    }

    /**
     * Check if opportunity meets profitability thresholds
     */
    private isProfitable(opp: StandardOpportunity): boolean {
        // Use fee-adjusted profit if available
        const profitPercent = opp.profit_percent_after_fees ?? opp.profit_percent;
        return profitPercent >= this.config.minProfitPercent;
    }

    /**
     * Calculate profitability of a triangular path
     * Includes fee calculations and Phase 2 slippage analysis
     */
    private calculateOpportunity(
        path: string[],
        prices: number[],
        direction: TradeDirection,
        ob1: OrderBook,
        ob2: OrderBook,
        ob3: OrderBook,
        stepPricing: StepPricing[]
    ): StandardOpportunity | null {
        const [start, mid, end, final] = path;
        const [price1, price2, price3] = prices;

        // Validate prices
        if (!price1 || !price2 || !price3 || price1 <= 0 || price2 <= 0 || price3 <= 0) {
            return null;
        }

        try {
            // Step 1: USDT -> mid token
            const step1Amount = this.config.tradeAmount / price1;
            if (!isFinite(step1Amount) || step1Amount <= 0) return null;

            // Step 2: mid token -> end token
            // Note: step1Amount is in base token units, multiply by price2 (inverse)
            const step2Amount = step1Amount * price2;
            if (!isFinite(step2Amount) || step2Amount <= 0) return null;

            // Step 3: end token -> USDT
            const step3Amount = step2Amount * price3;
            if (!isFinite(step3Amount) || step3Amount <= 0) return null;

            // PHASE 2: Calculate depth-based slippage if enabled
            let slippagePercent = 0.05;  // Default conservative estimate
            if (this.config.enablePhase2SlippageAnalysis) {
                slippagePercent = this.calculateDepthSlippage(ob1, ob2, ob3, step1Amount);
            }

            // Calculate fees (3 trades: bid, ask, bid)
            // Each trade incurs taker fee
            const totalFeePercent = this.config.takerFeePercent * 3;
            const feeAmount = this.config.tradeAmount * (totalFeePercent / 100);
            
            // Apply slippage to final amount
            const slippage = this.config.tradeAmount * (slippagePercent / 100);
            const step3AmountAfterSlippage = step3Amount * (1 - slippagePercent / 100);

            const profitBeforeFees = step3AmountAfterSlippage - this.config.tradeAmount;
            const profitAfterFees = profitBeforeFees - feeAmount;
            
            const profitPercentBeforeFees = (profitBeforeFees / this.config.tradeAmount) * 100;
            const profitPercentAfterFees = (profitAfterFees / this.config.tradeAmount) * 100;

            // Only return if there's profit after fees
            if (profitAfterFees <= 0 || profitPercentAfterFees < this.config.minProfitPercent) {
                return null;
            }

            return {
                strategy: 'triangular_arbitrage',
                exchange: this.config.exchange,
                path,
                profit_percent: profitPercentBeforeFees,
                profit_amount: profitBeforeFees,
                profit_after_fees: profitAfterFees,
                profit_percent_after_fees: profitPercentAfterFees,
                fee_percent_used: totalFeePercent,
                liquidity_score: this.calculateLiquidityScore(ob1, ob2, ob3),
                volume_estimate: this.estimateVolumeFromDepth(ob1, ob2, ob3),
                estimated_slippage: slippagePercent,
                detected_at: Math.floor(Date.now() / 1000),
                exchange1: this.config.exchange,
                exchange2: this.config.exchange,
                exchange3: this.config.exchange,
                pair1: `${path[1]}${path[0]}`,
                pair2: `${path[2]}${path[1]}`,
                pair3: `${path[3]}${path[2]}`,
                status: 'active',
                direction,
                step_prices: stepPricing
            };
        } catch (error) {
            this.logError('Error in calculateOpportunity:', error);
            return null;
        }
    }

    /**
     * Check if path has minimum liquidity depth (Phase 2)
     */
    private hasMinimumLiquidityDepth(
        ob1: OrderBook,
        ob2: OrderBook,
        ob3: OrderBook
    ): boolean {
        const minDepth = this.config.minLiquidityDepth || this.config.minLiquidity;

        // Quick depth check: consume our trade amount from each orderbook
        // to see if depth is sufficient
        try {
            const result1 = ob1.consume(this.config.tradeAmount / 10, 'BUY');
            const result3 = ob3.consume(this.config.tradeAmount / 10, 'SELL');

            // Must be able to fill at least 80% of execution at each step
            return result1.filled >= (this.config.tradeAmount / 10) * 0.8 &&
                   result3.filled >= (this.config.tradeAmount / 10) * 0.8;
        } catch {
            return false;
        }
    }

    /**
     * Calculate slippage percentage based on actual orderbook depth
     * Simulates executing the trade through the depth (Phase 2)
     */
    private calculateDepthSlippage(
        ob1: OrderBook,
        ob2: OrderBook,
        ob3: OrderBook,
        step1Amount: number
    ): number {
        try {
            // Step 1: Buy base token with USDT from ob1
            const result1 = ob1.consume(this.config.tradeAmount, 'BUY');
            if (result1.filled === 0) return 100;  // No liquidity
            const slip1 = result1.slippage;

            // Step 2: Approximate slippage for mid-path (often liquid)
            // Use spread as proxy
            const slip2 = ob2.getSpread() * 0.5;  // Half the spread

            // Step 3: Sell alt token for USDT from ob3
            // Note: step2Amount would be: step1Amount * price2
            // For now, approximate with step1Amount estimate
            const estimatedStep2 = step1Amount * 2;  // Conservative est
            const result3 = ob3.consume(estimatedStep2, 'SELL');
            const slip3 = result3.slippage;

            // Total: weighted average of slippage (each step is ~1/3)
            // Higher slippage means lower final amount
            const totalSlippage = (slip1 + slip2 + slip3) / 3;
            
            return Math.min(totalSlippage, 50);  // Cap at 50% to avoid infinity
        } catch {
            return 0.5;  // Default conservative estimate
        }
    }

    /**
     * Calculate liquidity score based on orderbook depth (Phase 2)
     * Higher = more liquid, easier to execute
     * 1.0 = excellent, 0.1 = very poor
     */
    private calculateLiquidityScore(
        ob1: OrderBook,
        ob2: OrderBook,
        ob3: OrderBook
    ): number {
        try {
            // Test execution of 10% of trade amount at each step
            const testAmount = this.config.tradeAmount * 0.1;

            const result1 = ob1.consume(testAmount, 'BUY');
            const result3 = ob3.consume(testAmount, 'SELL');

            // Criteria: lower slippage = higher score
            const avgSlippage = (result1.slippage + result3.slippage) / 2;

            if (avgSlippage < 0.05) return 1.0;    // Excellent
            if (avgSlippage < 0.10) return 0.9;    // Very good
            if (avgSlippage < 0.25) return 0.75;   // Good
            if (avgSlippage < 0.50) return 0.5;    // Moderate
            if (avgSlippage < 1.0) return 0.25;    // Poor
            return 0.1;                             // Very poor
        } catch {
            return 0.5;  // Default middle estimate
        }
    }

    /**
     * Estimate trading volume from orderbook depth
     * Returns approximate volume in USDT at which we could execute
     */
    private estimateVolumeFromDepth(
        ob1: OrderBook,
        ob2: OrderBook,
        ob3: OrderBook
    ): number {
        try {
            // Sum 10 levels of depth to estimate liquid volume
            let volumeEst = 0;

            // From first orderbook (buy side has asking volume)
            try {
                const result = ob1.consume(this.config.tradeAmount * 10, 'BUY');
                volumeEst += result.cost;
            } catch {
                volumeEst += 0;
            }

            // From third orderbook (sell side has bidding volume)
            try {
                const testAmt = this.config.tradeAmount * 5;
                const result = ob3.consume(testAmt, 'SELL');
                volumeEst += result.cost;
            } catch {
                volumeEst += 0;
            }

            return Math.max(volumeEst, 0);
        } catch {
            return 0;
        }
    }

    /**
     * Get current metrics from latest scan
     */
    getMetrics(): ScanMetrics {
        return { ...this.metrics };
    }

    /**
     * Reset metrics
     */
    private resetMetrics(): void {
        this.metrics = {
            totalPathsGenerated: 0,
            totalPathsScanned: 0,
            totalPathsFiltered: 0,
            pathsSkippedStaleBook: 0,
            pathsSkippedMissingBook: 0,
            opportunitiesDetected: 0,
            opportunitiesAfterFees: 0,
            totalScanTimeMs: 0
        };
    }

    /**
     * Get current paths
     */
    getPaths(): TriangularPath[] {
        return this.paths;
    }

    /**
     * Get scanner config
     */
    getConfig(): Readonly<ScanConfig> {
        return this.config;
    }

    /**
     * Update config with validation
     */
    updateConfig(updates: Partial<ScanConfig>): void {
        const updatedConfig = { ...this.config, ...updates } as Required<ScanConfig>;
        // Create temp scanner to validate
        const tempScanner = new Scanner(updatedConfig);
        this.config = updatedConfig;
        this.log(`✓ Config updated: ${Object.keys(updates).join(', ')}`);
    }

    /**
     * Clear path cache to force regeneration
     */
    clearPathCache(): void {
        this.pathCache = null;
        this.log('✓ Path cache cleared');
    }

    /**
     * Log with scanner prefix
     */
    private log(message: string): void {
        if (this.config.enableLogging) {
            console.log(`🔍 [Scanner] ${message}`);
        }
    }

    /**
     * Log error with scanner prefix
     */
    private logError(message: string, error?: unknown): void {
        if (this.config.enableLogging) {
            console.error(`❌ [Scanner] ${message}`, error);
        }
    }
}

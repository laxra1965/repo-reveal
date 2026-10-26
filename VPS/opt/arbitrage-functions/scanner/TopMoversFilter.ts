/**
 * TopMoversFilter - Filter symbols by trading activity and volatility
 * Only scans hot symbols to reduce computation and improve signal quality
 * 
 * IMPROVEMENTS:
 * - Support for multiple stablecoins (USDT, USDC, BUSD, DAI)
 * - Better input validation
 * - Configurable thresholds
 * - Improved error handling and logging
 * - Phase 2: Multi-timeframe volatility analysis
 * - Phase 2: Volume anomaly detection
 */

export interface TopMoverConfig {
    minVolume24h?: number;
    minPrice24hChange?: number; // percentage (e.g., 1.0 for 1%)
    maxTopMovers?: number;
    refreshIntervalMs?: number;
    /** Stablecoins to track (e.g., USDT, USDC, BUSD) */
    stablecoins?: string[];
    /** Enable detailed logging */
    enableLogging?: boolean;
    /** Phase 2: Enable multi-timeframe volatility analysis */
    enableMultiTimeframe?: boolean;
    /** Phase 2: Enable volume anomaly detection */
    enableVolumeAnomaly?: boolean;
}

export interface HotSymbol {
    symbol: string;
    volume24h: number;
    change24h: number;
    lastUpdate: number;
    baseToken?: string;
    
    // Phase 2: Multi-timeframe volatility
    change1h?: number;
    change4h?: number;
    volatilityScore?: number;
    trendDirection?: 'up' | 'down' | 'neutral';
    
    // Phase 2: Volume anomaly flag
    isVolumeAnomaly?: boolean;
}

export class TopMoversFilter {
    private hotSymbols: Map<string, HotSymbol> = new Map();
    private volumeHistory: Map<string, number[]> = new Map();  // Phase 2: Track volume history
    private lastRefresh: number = 0;
    private config: Required<TopMoverConfig>;
    private static readonly DEFAULT_STABLECOINS = ['USDT', 'USDC', 'BUSD', 'DAI'];
    private static readonly DEFAULT_MIN_VOLUME = 100000; // 100k quote currency
    private static readonly DEFAULT_MIN_CHANGE = 1.0; // 1% change
    private static readonly DEFAULT_MAX_MOVERS = 100;
    private static readonly DEFAULT_REFRESH_INTERVAL = 60000; // 1 minute
    private static readonly VOLUME_HISTORY_SIZE = 10;  // Phase 2: Keep last 10 updates

    constructor(config: TopMoverConfig = {}) {
        this.config = {
            minVolume24h: config.minVolume24h ?? TopMoversFilter.DEFAULT_MIN_VOLUME,
            minPrice24hChange: config.minPrice24hChange ?? TopMoversFilter.DEFAULT_MIN_CHANGE,
            maxTopMovers: config.maxTopMovers ?? TopMoversFilter.DEFAULT_MAX_MOVERS,
            refreshIntervalMs: config.refreshIntervalMs ?? TopMoversFilter.DEFAULT_REFRESH_INTERVAL,
            stablecoins: config.stablecoins ?? TopMoversFilter.DEFAULT_STABLECOINS,
            enableLogging: config.enableLogging ?? true,
            enableMultiTimeframe: config.enableMultiTimeframe ?? false,
            enableVolumeAnomaly: config.enableVolumeAnomaly ?? false
        };
        this.validateConfig();
    }

    /**
     * Validate configuration values
     */
    private validateConfig(): void {
        if (this.config.minVolume24h < 0) {
            throw new Error('[TopMoversFilter] minVolume24h must be >= 0');
        }
        if (this.config.minPrice24hChange < 0) {
            throw new Error('[TopMoversFilter] minPrice24hChange must be >= 0');
        }
        if (this.config.maxTopMovers <= 0) {
            throw new Error('[TopMoversFilter] maxTopMovers must be > 0');
        }
        if (this.config.stablecoins.length === 0) {
            throw new Error('[TopMoversFilter] stablecoins array must not be empty');
        }
    }

    /**
     * Check if a symbol represents a stablecoin pair
     */
    private isStablecoinPair(symbol: string): boolean {
        return this.config.stablecoins.some(stable => symbol.endsWith(stable));
    }

    /**
     * Extract base token from a symbol pair
     * E.g., "BNBUSDT" -> "BNB", "ETHUSDC" -> "ETH"
     */
    private extractBaseToken(symbol: string): string | null {
        for (const stablecoin of this.config.stablecoins) {
            if (symbol.endsWith(stablecoin)) {
                return symbol.slice(0, -stablecoin.length);
            }
        }
        return null;
    }

    /**
     * Phase 2: Calculate multi-timeframe volatility score
     * Weights: 40% 1h, 30% 4h, 30% 24h
     * Returns volatility score (0-100+)
     */
    private calculateVolatilityScore(
        change1h: number = 0,
        change4h: number = 0,
        change24h: number = 0
    ): number {
        const score = Math.abs(change1h) * 0.4 +
                     Math.abs(change4h) * 0.3 +
                     Math.abs(change24h) * 0.3;
        return score;
    }

    /**
     * Phase 2: Detect volume anomalies (very high or very low)
     * Returns true if volume is > 3 std devs from mean (unusual)
     */
    private isVolumeAnomaly(symbol: string, currentVolume: number): boolean {
        const history = this.volumeHistory.get(symbol) || [];
        
        if (history.length < 3) {
            // Not enough history yet
            return false;
        }

        // Calculate mean and std dev
        const mean = history.reduce((a, b) => a + b, 0) / history.length;
        const variance = history.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / history.length;
        const stdDev = Math.sqrt(variance);

        if (stdDev === 0) return false;

        // Z-score: how many std devs from mean
        const zScore = Math.abs((currentVolume - mean) / stdDev);

        // Flag if extreme (> 3 std devs)
        return zScore > 3;
    }

    /**
     * Phase 2: Track volume for anomaly detection
     */
    private trackVolume(symbol: string, volume: number): void {
        const history = this.volumeHistory.get(symbol) || [];
        history.push(volume);

        // Keep only last N measurements
        if (history.length > TopMoversFilter.VOLUME_HISTORY_SIZE) {
            history.shift();
        }

        this.volumeHistory.set(symbol, history);
    }

    /**
     * Update hot symbols from price data
     * Call this periodically or when price data updates
     * 
     * Expected priceData format:
     * {
     *   "symbol": "BNBUSDT",
     *   "volume": 123456789,
     *   "quoteAssetVolume": 123456789.12,
     *   "priceChangePercent": "5.25"
     * }
     */
    updateFromPriceData(priceMap: Record<string, any>): void {
        if (!priceMap || typeof priceMap !== 'object') {
            this.logError('Invalid priceMap provided');
            return;
        }

        const hotCandidates: HotSymbol[] = [];

        for (const [symbol, priceData] of Object.entries(priceMap)) {
            if (!symbol || typeof symbol !== 'string') {
                this.logError(`Invalid symbol: ${symbol}`);
                continue;
            }

            // Only process stablecoin pairs
            if (!this.isStablecoinPair(symbol)) {
                continue;
            }

            try {
                // Safely parse volume and change values
                const volume24h = this.parseNumber(
                    priceData.quoteAssetVolume ?? priceData.volume ?? '0'
                );
                const change24h = this.parseNumber(priceData.priceChangePercent ?? '0');

                if (volume24h === null || change24h === null) {
                    this.logError(`Failed to parse data for ${symbol}`);
                    continue;
                }

                // Phase 2: Track volume for anomaly detection
                if (this.config.enableVolumeAnomaly) {
                    this.trackVolume(symbol, volume24h);
                    if (this.isVolumeAnomaly(symbol, volume24h)) {
                        this.logError(`Volume anomaly detected for ${symbol}: ${volume24h}`);
                        continue;  // Skip suspicious volumes
                    }
                }

                // Filter by volume and volatility (absolute change)
                if (volume24h >= this.config.minVolume24h &&
                    Math.abs(change24h) >= this.config.minPrice24hChange) {
                    
                    const baseToken = this.extractBaseToken(symbol);
                    const hotSymbol: HotSymbol = {
                        symbol,
                        volume24h,
                        change24h,
                        lastUpdate: Date.now(),
                        baseToken: baseToken ?? undefined
                    };

                    // Phase 2: Add multi-timeframe data if enabled
                    if (this.config.enableMultiTimeframe) {
                        hotSymbol.change1h = this.parseNumber(priceData.priceChangePercent1h ?? '0') ?? 0;
                        hotSymbol.change4h = this.parseNumber(priceData.priceChangePercent4h ?? '0') ?? 0;
                        hotSymbol.volatilityScore = this.calculateVolatilityScore(
                            hotSymbol.change1h,
                            hotSymbol.change4h,
                            change24h
                        );
                        hotSymbol.trendDirection = change24h > 0 ? 'up' : change24h < 0 ? 'down' : 'neutral';
                    }

                    hotCandidates.push(hotSymbol);
                }
            } catch (error) {
                this.logError(`Exception processing symbol ${symbol}:`, error);
            }
        }

        // Phase 2: Sort by volatility score if multi-timeframe enabled, else by volume
        if (this.config.enableMultiTimeframe) {
            hotCandidates.sort((a, b) => (b.volatilityScore ?? 0) - (a.volatilityScore ?? 0));
        } else {
            hotCandidates.sort((a, b) => b.volume24h - a.volume24h);
        }

        const topMovers = hotCandidates.slice(0, this.config.maxTopMovers);

        // Update hot symbols map
        this.hotSymbols.clear();
        for (const symbol of topMovers) {
            this.hotSymbols.set(symbol.symbol, symbol);
        }

        this.lastRefresh = Date.now();
        this.log(
            `✓ Updated: ${this.hotSymbols.size} hot symbols ` +
            `(${this.config.stablecoins.join('/')}) - ` +
            `Min volume: ${this.config.minVolume24h}, ` +
            `Min change: ±${this.config.minPrice24hChange}%` +
            (this.config.enableMultiTimeframe ? ' (multi-timeframe enabled)' : '') +
            (this.config.enableVolumeAnomaly ? ' (anomaly detection enabled)' : '')
        );
    }

    /**
     * Phase 2: Update from multi-timeframe price data
     * Enhanced version that supports 1h, 4h, 24h changes
     * 
     * @param priceMap Standard price data with 24h changes
     * @param timeframeMap Optional map with 1h/4h change data
     */
    updateFromPriceDataWithTimeframes(
        priceMap: Record<string, any>,
        timeframeMap?: Record<string, { change1h?: number; change4h?: number }>
    ): void {
        if (!priceMap || typeof priceMap !== 'object') {
            this.logError('Invalid priceMap provided');
            return;
        }

        const hotCandidates: HotSymbol[] = [];

        for (const [symbol, priceData] of Object.entries(priceMap)) {
            if (!symbol || typeof symbol !== 'string') {
                this.logError(`Invalid symbol: ${symbol}`);
                continue;
            }

            // Only process stablecoin pairs
            if (!this.isStablecoinPair(symbol)) {
                continue;
            }

            try {
                // Parse base data
                const volume24h = this.parseNumber(
                    priceData.quoteAssetVolume ?? priceData.volume ?? '0'
                );
                const change24h = this.parseNumber(priceData.priceChangePercent ?? '0');

                if (volume24h === null || change24h === null) {
                    this.logError(`Failed to parse data for ${symbol}`);
                    continue;
                }

                // Phase 2: Volume anomaly detection
                if (this.config.enableVolumeAnomaly) {
                    this.trackVolume(symbol, volume24h);
                    if (this.isVolumeAnomaly(symbol, volume24h)) {
                        continue;  // Skip anomalous volumes
                    }
                }

                // Filter by volume and volatility
                if (volume24h >= this.config.minVolume24h &&
                    Math.abs(change24h) >= this.config.minPrice24hChange) {
                    
                    const baseToken = this.extractBaseToken(symbol);
                    const timeframeData = timeframeMap?.[symbol];
                    const change1h = timeframeData?.change1h ?? 0;
                    const change4h = timeframeData?.change4h ?? 0;

                    // Calculate volatility score
                    const volatilityScore = this.calculateVolatilityScore(change1h, change4h, change24h);

                    const hotSymbol: HotSymbol = {
                        symbol,
                        volume24h,
                        change24h,
                        change1h,
                        change4h,
                        volatilityScore,
                        trendDirection: change24h > 0 ? 'up' : change24h < 0 ? 'down' : 'neutral',
                        lastUpdate: Date.now(),
                        baseToken: baseToken ?? undefined
                    };

                    hotCandidates.push(hotSymbol);
                }
            } catch (error) {
                this.logError(`Exception processing symbol ${symbol}:`, error);
            }
        }

        // Sort by volatility score
        hotCandidates.sort((a, b) => (b.volatilityScore ?? 0) - (a.volatilityScore ?? 0));
        const topMovers = hotCandidates.slice(0, this.config.maxTopMovers);

        // Update hot symbols map
        this.hotSymbols.clear();
        for (const symbol of topMovers) {
            this.hotSymbols.set(symbol.symbol, symbol);
        }

        this.lastRefresh = Date.now();
        this.log(
            `✓ Updated: ${this.hotSymbols.size} hot symbols (multi-timeframe analysis)`
        );
    }

    /**
     * Safely parse a number from various formats
     */
    private parseNumber(value: string | number | undefined | null): number | null {
        if (value === null || value === undefined) return null;
        
        try {
            const num = typeof value === 'string' ? parseFloat(value) : value;
            return isFinite(num) ? num : null;
        } catch {
            return null;
        }
    }

    /**
     * Check if a symbol is in the hot list
     */
    isHotSymbol(symbol: string): boolean {
        return this.hotSymbols.has(symbol);
    }

    /**
     * Get all hot symbols
     */
    getHotSymbols(): HotSymbol[] {
        return Array.from(this.hotSymbols.values());
    }

    /**
     * Get hot symbols for a specific stablecoin
     */
    getHotSymbolsForStablecoin(stablecoin: string): HotSymbol[] {
        return Array.from(this.hotSymbols.values()).filter(
            s => s.symbol.endsWith(stablecoin)
        );
    }

    /**
     * Get filtered symbol list for triangular paths
     * Focuses only on hot symbols to reduce computation
     */
    filterSymbols(allSymbols: string[]): string[] {
        if (!Array.isArray(allSymbols)) {
            this.logError('allSymbols must be an array');
            return [];
        }
        return allSymbols.filter(s => this.isHotSymbol(s));
    }

    /**
     * Should refresh based on interval
     */
    shouldRefresh(): boolean {
        return Date.now() - this.lastRefresh > this.config.refreshIntervalMs;
    }

    /**
     * Get filter statistics
     */
    getStats() {
        const stats: any = {
            hotSymbolCount: this.hotSymbols.size,
            maxTopMovers: this.config.maxTopMovers,
            minVolume24h: this.config.minVolume24h,
            minPrice24hChange: this.config.minPrice24hChange,
            stablecoinsTracked: this.config.stablecoins,
            lastRefresh: this.lastRefresh,
            timeSinceRefresh: Date.now() - this.lastRefresh,
            msSinceRefresh: this.lastRefresh > 0 ? Date.now() - this.lastRefresh : -1,
            needsRefresh: this.shouldRefresh()
        };

        // Phase 2: Add multi-timeframe stats if enabled
        if (this.config.enableMultiTimeframe) {
            const symbolsWithVolatility = Array.from(this.hotSymbols.values())
                .filter(s => s.volatilityScore !== undefined);
            const avgVolatility = symbolsWithVolatility.length > 0
                ? symbolsWithVolatility.reduce((sum, s) => sum + (s.volatilityScore ?? 0), 0) / symbolsWithVolatility.length
                : 0;

            stats.multiTimeframeEnabled = true;
            stats.averageVolatilityScore = parseFloat(avgVolatility.toFixed(2));
            stats.trendUp = Array.from(this.hotSymbols.values()).filter(s => s.trendDirection === 'up').length;
            stats.trendDown = Array.from(this.hotSymbols.values()).filter(s => s.trendDirection === 'down').length;
            stats.trendNeutral = Array.from(this.hotSymbols.values()).filter(s => s.trendDirection === 'neutral').length;
        }

        // Phase 2: Volume anomaly detection stats
        if (this.config.enableVolumeAnomaly) {
            stats.volumeAnomalyEnabled = true;
            stats.symbolsTracked = this.volumeHistory.size;
        }

        return stats;
    }

    /**
     * Get unique base tokens from hot symbols
     */
    getHotBaseTokens(): string[] {
        const tokens = new Set<string>();
        for (const symbol of this.hotSymbols.values()) {
            if (symbol.baseToken) {
                tokens.add(symbol.baseToken);
            }
        }
        return Array.from(tokens).sort();
    }

    /**
     * Update configuration
     */
    updateConfig(updates: Partial<TopMoverConfig>): void {
        const updated = { ...this.config, ...updates } as Required<TopMoverConfig>;
        // Validate before applying
        const tempFilter = new TopMoversFilter(updated);
        this.config = updated;
        this.log(`✓ Config updated: ${Object.keys(updates).join(', ')}`);
    }

    /**
     * Clear hot symbols (useful for testing)
     */
    clear(): void {
        this.hotSymbols.clear();
        this.volumeHistory.clear();
        this.lastRefresh = 0;
        this.log('✓ Hot symbols cleared');
    }

    /**
     * Log with filter prefix
     */
    private log(message: string): void {
        if (this.config.enableLogging) {
            console.log(`🔥 [TopMoversFilter] ${message}`);
        }
    }

    /**
     * Log error with filter prefix
     */
    private logError(message: string, error?: unknown): void {
        if (this.config.enableLogging) {
            console.error(`❌ [TopMoversFilter] ${message}`, error);
        }
    }
}

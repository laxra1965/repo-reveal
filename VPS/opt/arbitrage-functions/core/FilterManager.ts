/**
 * FilterManager - Apply configurable filters to arbitrage opportunities
 * 
 * Manages filters for:
 * - Profit thresholds
 * - Liquidity requirements
 * - Volume minimums
 * - Slippage limits
 * - Specific exchanges
 * - Specific symbols
 * - Strategy types
 */

import { StandardOpportunity } from '../scanner/types.ts';

export interface OpportunityFilter {
    id?: string;
    name: string;
    description?: string;
    is_active: boolean;
    
    // Profit filters
    min_profit_percent?: number;
    max_profit_percent?: number;
    
    // Liquidity filters
    min_liquidity_score?: number;
    max_liquidity_score?: number;
    
    // Volume filters
    min_volume_estimate?: number;
    max_volume_estimate?: number;
    
    // Slippage filters
    max_estimated_slippage?: number;
    
    // Exchange filters
    allowed_exchanges?: string[];
    
    // Symbol filters
    allowed_symbols?: string[];
    excluded_symbols?: string[];
    
    // Path filters
    path_length?: number;
    
    // Strategy filters
    allowed_strategies?: string[];
}

export interface FilterResult {
    passed: boolean;
    reasons: string[];  // Why it failed (if failed)
}

export class FilterManager {
    private filters: OpportunityFilter[] = [];
    private lastFetched = 0;
    private refreshInterval = 60000;  // Refresh filters every 60 seconds

    constructor(private supabaseUrl?: string, private supabaseKey?: string) {}

    /**
     * Fetch active filters from Supabase
     */
    async loadFiltersFromDatabase(): Promise<void> {
        if (!this.supabaseUrl || !this.supabaseKey) {
            console.log('⚠️  [FilterManager] Supabase credentials not provided, using default filters');
            return;
        }

        try {
            const response = await fetch(
                `${this.supabaseUrl}/rest/v1/opportunity_filters?is_active=eq.true`,
                {
                    headers: {
                        'apikey': this.supabaseKey,
                        'Authorization': `Bearer ${this.supabaseKey}`
                    }
                }
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const filters = await response.json() as OpportunityFilter[];
            this.filters = filters;
            this.lastFetched = Date.now();

            console.log(`✅ [FilterManager] Loaded ${filters.length} active filters from database`);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(`❌ [FilterManager] Failed to load filters:`, msg);
        }
    }

    /**
     * Get filters with auto-refresh
     */
    async getFilters(): Promise<OpportunityFilter[]> {
        const now = Date.now();
        if (now - this.lastFetched > this.refreshInterval) {
            await this.loadFiltersFromDatabase();
        }
        return this.filters;
    }

    /**
     * Check if opportunity passes all active filters
     */
    async checkOpportunity(opportunity: StandardOpportunity): Promise<FilterResult> {
        const filters = await this.getFilters();
        
        // If no filters, allow everything
        if (filters.length === 0) {
            return { passed: true, reasons: [] };
        }

        const reasons: string[] = [];

        // Check each filter
        for (const filter of filters) {
            const filterResult = this.applyFilter(opportunity, filter);
            if (!filterResult.passed) {
                reasons.push(`Filter "${filter.name}": ${filterResult.reasons.join(', ')}`);
            }
        }

        return {
            passed: reasons.length === 0,
            reasons
        };
    }

    /**
     * Apply a single filter to an opportunity
     */
    private applyFilter(opportunity: StandardOpportunity, filter: OpportunityFilter): FilterResult {
        const reasons: string[] = [];

        // Profit check
        if (filter.min_profit_percent !== undefined && opportunity.profit_percent < filter.min_profit_percent) {
            reasons.push(`profit ${opportunity.profit_percent.toFixed(3)}% < min ${filter.min_profit_percent}%`);
        }
        if (filter.max_profit_percent !== undefined && opportunity.profit_percent > filter.max_profit_percent) {
            reasons.push(`profit ${opportunity.profit_percent.toFixed(3)}% > max ${filter.max_profit_percent}%`);
        }

        // Liquidity check
        if (filter.min_liquidity_score !== undefined && opportunity.liquidity_score < filter.min_liquidity_score) {
            reasons.push(`liquidity ${opportunity.liquidity_score.toFixed(2)} < min ${filter.min_liquidity_score}`);
        }
        if (filter.max_liquidity_score !== undefined && opportunity.liquidity_score > filter.max_liquidity_score) {
            reasons.push(`liquidity ${opportunity.liquidity_score.toFixed(2)} > max ${filter.max_liquidity_score}`);
        }

        // Volume check
        if (filter.min_volume_estimate !== undefined && opportunity.volume_estimate < filter.min_volume_estimate) {
            reasons.push(`volume ${opportunity.volume_estimate.toFixed(0)} < min ${filter.min_volume_estimate}`);
        }
        if (filter.max_volume_estimate !== undefined && opportunity.volume_estimate > filter.max_volume_estimate) {
            reasons.push(`volume ${opportunity.volume_estimate.toFixed(0)} > max ${filter.max_volume_estimate}`);
        }

        // Slippage check
        if (filter.max_estimated_slippage !== undefined && opportunity.estimated_slippage > filter.max_estimated_slippage) {
            reasons.push(`slippage ${opportunity.estimated_slippage.toFixed(3)}% > max ${filter.max_estimated_slippage}%`);
        }

        // Exchange filter (if specified, must have at least one allowed exchange)
        if (filter.allowed_exchanges && filter.allowed_exchanges.length > 0) {
            const exchanges = [opportunity.exchange1, opportunity.exchange2, opportunity.exchange3].filter(Boolean);
            const hasAllowedExchange = exchanges.some(ex => filter.allowed_exchanges!.includes(ex!));
            if (!hasAllowedExchange) {
                reasons.push(`exchanges [${exchanges.join(', ')}] not in allowed list [${filter.allowed_exchanges.join(', ')}]`);
            }
        }

        // Symbol filter
        if (filter.allowed_symbols && filter.allowed_symbols.length > 0) {
            const symbols = opportunity.path.filter(p => p !== 'USDT'); // Exclude stablecoin
            const hasAllowedSymbol = symbols.some(sym => filter.allowed_symbols!.some(allowed => sym.includes(allowed)));
            if (!hasAllowedSymbol) {
                reasons.push(`symbols [${symbols.join(', ')}] don't match allowed [${filter.allowed_symbols.join(', ')}]`);
            }
        }

        // Excluded symbols check
        if (filter.excluded_symbols && filter.excluded_symbols.length > 0) {
            const symbols = opportunity.path;
            const hasExcludedSymbol = symbols.some(sym => filter.excluded_symbols!.includes(sym));
            if (hasExcludedSymbol) {
                reasons.push(`path contains excluded symbols`);
            }
        }

        // Path length check
        if (filter.path_length !== undefined && opportunity.path.length !== filter.path_length) {
            reasons.push(`path length ${opportunity.path.length} != required ${filter.path_length}`);
        }

        // Strategy check
        if (filter.allowed_strategies && filter.allowed_strategies.length > 0) {
            if (!filter.allowed_strategies.includes(opportunity.strategy)) {
                reasons.push(`strategy ${opportunity.strategy} not in allowed [${filter.allowed_strategies.join(', ')}]`);
            }
        }

        return {
            passed: reasons.length === 0,
            reasons
        };
    }

    /**
     * Get filter statistics
     */
    async getStats(): Promise<{
        totalFilters: number;
        activeFilters: number;
        lastFetched: Date;
    }> {
        const filters = await this.getFilters();
        return {
            totalFilters: filters.length,
            activeFilters: filters.filter(f => f.is_active).length,
            lastFetched: new Date(this.lastFetched)
        };
    }

    /**
     * Set filters manually (for testing)
     */
    setFilters(filters: OpportunityFilter[]): void {
        this.filters = filters;
        this.lastFetched = Date.now();
        console.log(`✅ [FilterManager] Set ${filters.length} filters manually`);
    }

    /**
     * Create a default filter (for initialization)
     */
    static createDefaultFilter(): OpportunityFilter {
        return {
            name: 'Default Filter',
            description: 'Default filter configuration',
            is_active: true,
            min_profit_percent: 0.3,
            min_liquidity_score: 0.5,
            min_volume_estimate: 1000,
            max_estimated_slippage: 2.0
        };
    }

    /**
     * Create a conservative filter
     */
    static createConservativeFilter(): OpportunityFilter {
        return {
            name: 'Conservative',
            description: 'Conservative filter - fewer, safer trades',
            is_active: false,
            min_profit_percent: 0.5,
            min_liquidity_score: 0.7,
            min_volume_estimate: 5000,
            max_estimated_slippage: 1.0
        };
    }

    /**
     * Create an aggressive filter
     */
    static createAggressiveFilter(): OpportunityFilter {
        return {
            name: 'Aggressive',
            description: 'Aggressive filter - more trades, higher risk',
            is_active: false,
            min_profit_percent: 0.15,
            min_liquidity_score: 0.3,
            min_volume_estimate: 500,
            max_estimated_slippage: 3.0
        };
    }
}

/**
 * Factory function to create FilterManager from environment
 */
export function createFilterManager(): FilterManager {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const fm = new FilterManager(url, key);
    
    // Load filters on initialization
    fm.loadFiltersFromDatabase().catch(console.error);
    
    return fm;
}

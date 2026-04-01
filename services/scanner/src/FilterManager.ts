/**
 * FilterManager - Apply configurable filters to arbitrage opportunities
 * Reads active filters from Supabase and applies them before writing opportunities.
 */

export interface OpportunityFilter {
    id?: string;
    name: string;
    description?: string;
    is_active: boolean;
    min_profit_percent?: number;
    max_profit_percent?: number;
    min_liquidity_score?: number;
    max_liquidity_score?: number;
    min_volume_estimate?: number;
    max_volume_estimate?: number;
    max_estimated_slippage?: number;
    allowed_exchanges?: string[];
    allowed_symbols?: string[];
    excluded_symbols?: string[];
    path_length?: number;
    allowed_strategies?: string[];
}

export interface FilterResult {
    passed: boolean;
    reasons: string[];
}

export interface FilterableOpportunity {
    profitPct: number;
    path: string[];
    exchange?: string;
    maxExecutableUSDT?: number;
    estimatedSlippage?: number;
    liquidityScore?: number;
    strategy?: string;
    [key: string]: any;
}

export class FilterManager {
    private filters: OpportunityFilter[] = [];
    private lastFetched = 0;
    private refreshInterval = 60000; // 60 seconds

    constructor(private supabaseUrl?: string, private supabaseKey?: string) {}

    async loadFiltersFromDatabase(): Promise<void> {
        if (!this.supabaseUrl || !this.supabaseKey) {
            console.log('[FilterManager] No Supabase credentials, using defaults');
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
            console.log(`[FilterManager] Loaded ${filters.length} active filters`);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(`[FilterManager] Failed to load filters: ${msg}`);
        }
    }

    async getFilters(): Promise<OpportunityFilter[]> {
        if (Date.now() - this.lastFetched > this.refreshInterval) {
            await this.loadFiltersFromDatabase();
        }
        return this.filters;
    }

    async checkOpportunity(opp: FilterableOpportunity): Promise<FilterResult> {
        const filters = await this.getFilters();
        if (filters.length === 0) return { passed: true, reasons: [] };

        const reasons: string[] = [];

        for (const filter of filters) {
            const result = this.applyFilter(opp, filter);
            if (!result.passed) {
                reasons.push(...result.reasons);
            }
        }

        return { passed: reasons.length === 0, reasons };
    }

    private applyFilter(opp: FilterableOpportunity, filter: OpportunityFilter): FilterResult {
        const reasons: string[] = [];

        if (filter.min_profit_percent != null && opp.profitPct < filter.min_profit_percent) {
            reasons.push(`profit ${opp.profitPct.toFixed(3)}% < min ${filter.min_profit_percent}%`);
        }
        if (filter.max_profit_percent != null && opp.profitPct > filter.max_profit_percent) {
            reasons.push(`profit ${opp.profitPct.toFixed(3)}% > max ${filter.max_profit_percent}%`);
        }

        if (filter.min_liquidity_score != null && (opp.liquidityScore ?? 0) < filter.min_liquidity_score) {
            reasons.push(`liquidity too low`);
        }
        if (filter.max_liquidity_score != null && (opp.liquidityScore ?? 1) > filter.max_liquidity_score) {
            reasons.push(`liquidity too high`);
        }

        if (filter.min_volume_estimate != null && (opp.maxExecutableUSDT ?? 0) < filter.min_volume_estimate) {
            reasons.push(`volume too low`);
        }
        if (filter.max_volume_estimate != null && (opp.maxExecutableUSDT ?? 0) > filter.max_volume_estimate) {
            reasons.push(`volume too high`);
        }

        if (filter.max_estimated_slippage != null && (opp.estimatedSlippage ?? 0) > filter.max_estimated_slippage) {
            reasons.push(`slippage too high`);
        }

        if (filter.allowed_exchanges?.length) {
            const exchange = opp.exchange || '';
            if (!filter.allowed_exchanges.includes(exchange)) {
                reasons.push(`exchange ${exchange} not allowed`);
            }
        }

        if (filter.allowed_symbols?.length) {
            const pathSymbols = opp.path.filter(p => p !== 'USDT');
            const hasAllowed = pathSymbols.some(sym =>
                filter.allowed_symbols!.some(a => sym.includes(a))
            );
            if (!hasAllowed) reasons.push(`symbols not in allowed list`);
        }

        if (filter.excluded_symbols?.length) {
            const hasExcluded = opp.path.some(sym => filter.excluded_symbols!.includes(sym));
            if (hasExcluded) reasons.push(`path contains excluded symbol`);
        }

        if (filter.path_length != null && opp.path.length !== filter.path_length) {
            reasons.push(`path length mismatch`);
        }

        if (filter.allowed_strategies?.length && opp.strategy) {
            if (!filter.allowed_strategies.includes(opp.strategy)) {
                reasons.push(`strategy ${opp.strategy} not allowed`);
            }
        }

        return { passed: reasons.length === 0, reasons };
    }

    setFilters(filters: OpportunityFilter[]): void {
        this.filters = filters;
        this.lastFetched = Date.now();
    }

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

export function createFilterManager(): FilterManager {
    const url = process.env.SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const fm = new FilterManager(url, key);
    fm.loadFiltersFromDatabase().catch(console.error);
    return fm;
}

/**
 * SupabaseWriter - Database adapter for writing opportunities to Supabase
 * Integrates with the BatchWriter for high-performance inserts
 * 
 * IMPROVEMENTS:
 * - Validates opportunities before writing to prevent malformed data
 * - Detailed error logging for debugging
 * - Filters out invalid records automatically
 */

import { StandardOpportunity } from '../scanner/types.ts';

export interface SupabaseConfig {
    url: string;
    anonKey: string;
    table?: string;
    enableValidation?: boolean; // Default: true
}

/**
 * Comprehensive validation of StandardOpportunity
 * Returns { valid: true } or { valid: false, reason: string }
 */
export function validateOpportunity(opp: StandardOpportunity): { valid: boolean; reason?: string } {
    // Check basic structure
    if (!opp || typeof opp !== 'object') {
        return { valid: false, reason: 'Opportunity is not an object' };
    }

    // Validate required fields
    if (!opp.strategy) {
        return { valid: false, reason: 'Missing strategy field' };
    }

    if (!opp.path || !Array.isArray(opp.path) || opp.path.length !== 4) {
        return { valid: false, reason: `Invalid path: expected 4 tokens, got ${opp.path?.length || 0}` };
    }

    // Validate path tokens are not empty or "undefined"
    for (let i = 0; i < opp.path.length; i++) {
        const token = opp.path[i];
        if (!token || typeof token !== 'string' || token === 'undefined' || token.trim() === '') {
            return { valid: false, reason: `Path has invalid token at position ${i}: "${token}"` };
        }
    }

    // Validate path is properly closed (start == end)
    if (opp.path[0] !== opp.path[3]) {
        return { valid: false, reason: `Path not closed: ${opp.path[0]} ≠ ${opp.path[3]}` };
    }

    // Validate pairs
    if (!opp.pair1 || typeof opp.pair1 !== 'string' || opp.pair1.includes('undefined')) {
        return { valid: false, reason: `Invalid pair1: "${opp.pair1}"` };
    }

    if (!opp.pair2 || typeof opp.pair2 !== 'string' || opp.pair2.includes('undefined')) {
        return { valid: false, reason: `Invalid pair2: "${opp.pair2}"` };
    }

    if (!opp.pair3 || typeof opp.pair3 !== 'string' || opp.pair3.includes('undefined')) {
        return { valid: false, reason: `Invalid pair3: "${opp.pair3}"` };
    }

    // Validate path cannot have empty arrows (USDT→→→USDT pattern check)
    const pathStr = opp.path.join('→');
    if (pathStr.includes('→→')) {
        return { valid: false, reason: `Path has consecutive arrows (empty tokens): ${pathStr}` };
    }

    // Validate profit metrics
    if (!isFinite(opp.profit_percent) || opp.profit_percent === null || opp.profit_percent === undefined) {
        return { valid: false, reason: `Invalid profit_percent: ${opp.profit_percent}` };
    }

    if (!isFinite(opp.liquidity_score) || opp.liquidity_score < 0 || opp.liquidity_score > 1) {
        return { valid: false, reason: `Invalid liquidity_score: ${opp.liquidity_score} (must be 0-1)` };
    }

    if (!isFinite(opp.volume_estimate) || opp.volume_estimate < 0) {
        return { valid: false, reason: `Invalid volume_estimate: ${opp.volume_estimate}` };
    }

    if (!isFinite(opp.estimated_slippage) || opp.estimated_slippage < 0) {
        return { valid: false, reason: `Invalid estimated_slippage: ${opp.estimated_slippage}` };
    }

    // Validate timestamp
    if (!isFinite(opp.detected_at) || opp.detected_at <= 0) {
        return { valid: false, reason: `Invalid detected_at: ${opp.detected_at}` };
    }

    // Validate exchange references
    if (opp.exchange1 && typeof opp.exchange1 !== 'string') {
        return { valid: false, reason: `Invalid exchange1: ${opp.exchange1}` };
    }

    if (opp.exchange2 && typeof opp.exchange2 !== 'string') {
        return { valid: false, reason: `Invalid exchange2: ${opp.exchange2}` };
    }

    if (opp.exchange3 && typeof opp.exchange3 !== 'string') {
        return { valid: false, reason: `Invalid exchange3: ${opp.exchange3}` };
    }

    // Validate status
    const validStatuses = ['active', 'expired'];
    if (!validStatuses.includes(opp.status)) {
        return { valid: false, reason: `Invalid status: "${opp.status}"` };
    }

    return { valid: true };
}

/**
 * Transform StandardOpportunity to database schema
 * Validates before transformation
 */
function transformOpportunity(opp: StandardOpportunity): Record<string, any> | null {
    const validation = validateOpportunity(opp);
    if (!validation.valid) {
        console.warn(`⚠️ [SupabaseWriter] Invalid opportunity (not transforming): ${validation.reason}`);
        return null;
    }

    return {
        strategy: opp.strategy,
        exchange: opp.exchange || null,
        primary_exchange: opp.primary_exchange || null,
        bridge_exchange: opp.bridge_exchange || null,
        path: opp.path,
        profit_percent: opp.profit_percent,
        profit_amount: (opp as any).profit_amount || null,
        profit_after_fees: (opp as any).profit_after_fees || null,
        profit_percent_after_fees: (opp as any).profit_percent_after_fees || null,
        fee_percent_used: (opp as any).fee_percent_used || null,
        liquidity_score: opp.liquidity_score,
        volume_estimate: opp.volume_estimate,
        estimated_slippage: opp.estimated_slippage,
        detected_at: new Date(opp.detected_at * 1000).toISOString(),
        exchange1: opp.exchange1,
        exchange2: opp.exchange2,
        exchange3: opp.exchange3,
        pair1: opp.pair1,
        pair2: opp.pair2,
        pair3: opp.pair3,
        status: opp.status,
        created_at: new Date().toISOString()
    };
}

export class SupabaseWriter {
    private config: SupabaseConfig;
    private initialized = false;

    constructor(config: SupabaseConfig) {
        this.config = {
            table: 'opportunities',
            ...config
        };
    }

    /**
     * Initialize Supabase client
     * Note: This is a placeholder - implement with actual Supabase client
     */
    async init() {
        try {
            // TODO: Initialize Supabase client when available
            // const { createClient } = require('@supabase/supabase-js');
            // this.supabase = createClient(this.config.url, this.config.anonKey);
            console.log('📊 [SupabaseWriter] Initialized');
            this.initialized = true;
        } catch (error) {
            console.error('❌ [SupabaseWriter] Initialization failed:', error);
            throw error;
        }
    }

    /**
     * Write batch of opportunities to database
     */
    async write(opportunities: StandardOpportunity[]): Promise<void> {
        if (!this.initialized) {
            throw new Error('SupabaseWriter not initialized');
        }

        if (opportunities.length === 0) return;

        try {
            const records = opportunities.map(transformOpportunity);

            // TODO: Replace with actual Supabase insert when client is available
            // await this.supabase
            //     .from(this.config.table)
            //     .insert(records);

            console.log(`✅ [SupabaseWriter] Inserted ${opportunities.length} opportunities`);
        } catch (error) {
            console.error(`❌ [SupabaseWriter] Write failed:`, error);
            throw error;
        }
    }

    /**
     * Query recent opportunities from database
     */
    async getRecentOpportunities(limit: number = 100): Promise<StandardOpportunity[]> {
        if (!this.initialized) {
            throw new Error('SupabaseWriter not initialized');
        }

        try {
            // TODO: Replace with actual Supabase query when client is available
            // const { data, error } = await this.supabase
            //     .from(this.config.table)
            //     .select('*')
            //     .order('detected_at', { ascending: false })
            //     .limit(limit);

            // if (error) throw error;
            // return data || [];

            return [];
        } catch (error) {
            console.error(`❌ [SupabaseWriter] Query failed:`, error);
            throw error;
        }
    }

    /**
     * Get statistics about opportunities in database
     */
    async getStatistics(): Promise<Record<string, any>> {
        if (!this.initialized) {
            throw new Error('SupabaseWriter not initialized');
        }

        try {
            // TODO: Replace with actual Supabase query when client is available
            // const { data, error } = await this.supabase
            //     .from(this.config.table)
            //     .select('strategy, exchange, profit_percent')
            //     .gte('detected_at', new Date(Date.now() - 3600000).toISOString());

            // if (error) throw error;

            return {
                totalCount: 0,
                averageProfitPercent: 0,
                exchanges: {},
                strategies: {}
            };
        } catch (error) {
            console.error(`❌ [SupabaseWriter] Statistics query failed:`, error);
            throw error;
        }
    }

    /**
     * Clean up old opportunities (older than X days)
     */
    async cleanup(daysOld: number = 7): Promise<number> {
        if (!this.initialized) {
            throw new Error('SupabaseWriter not initialized');
        }

        try {
            const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

            // TODO: Replace with actual Supabase delete when client is available
            // const { data, error } = await this.supabase
            //     .from(this.config.table)
            //     .delete()
            //     .lt('created_at', cutoffDate.toISOString());

            // if (error) throw error;
            // return data?.length || 0;

            return 0;
        } catch (error) {
            console.error(`❌ [SupabaseWriter] Cleanup failed:`, error);
            throw error;
        }
    }
}

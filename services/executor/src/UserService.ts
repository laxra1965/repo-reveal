
import { createClient } from '@supabase/supabase-js';
import { UserContext } from './EligibilityFilter';
import { TierLevel } from '../../../shared/src/index';

export class UserService {
    private supabase;

    constructor() {
        const url = process.env.SUPABASE_URL || '';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
        if (!url || !key) throw new Error("Missing Supabase Credentials");
        this.supabase = createClient(url, key);
    }

    async getEligibleUsers(exchange: string): Promise<UserContext[]> {
        try {
            // Fetch users who are enabled and have the specified exchange enabled
            const { data, error } = await this.supabase
                .from('users') // Assuming 'users' table
                .select(`
                    id, 
                    tier, 
                    trading_enabled, 
                    balances, 
                    enabled_exchanges,
                    daily_loss_limit,
                    current_daily_loss
                `)
                .eq('trading_enabled', true)
                .contains('enabled_exchanges', [exchange.toLowerCase()]);

            if (error || !data) return [];

            return data.map(u => ({
                userId: u.id,
                tier: u.tier as TierLevel,
                balances: u.balances || {},
                enabledExchanges: u.enabled_exchanges || [],
                tradingEnabled: u.trading_enabled,
                currentDailyLoss: u.current_daily_loss || 0,
                currentOpenPositions: 0 // Tracked in memory or another table
            }));
        } catch (e) {
            console.error('[UserService] Failed to fetch users', e);
            return [];
        }
    }
}

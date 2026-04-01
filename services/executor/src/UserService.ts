
import { createClient } from '@supabase/supabase-js';
import { UserContext } from './EligibilityFilter';
import { TierLevel } from '../../../shared/dist/index';

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
            // Fetch user settings with trading config
            const { data, error } = await this.supabase
                .from('user_settings')
                .select(`
                    user_id, 
                    trade_amount,
                    min_profit_percent,
                    slippage_buffer,
                    max_position_size,
                    auto_trade, 
                    enabled_exchanges
                `)
                .eq('auto_trade', true)
                .contains('enabled_exchanges', [exchange.toLowerCase()]);

            if (error || !data) return [];

            return data.map(u => ({
                userId: u.user_id,
                tier: 'starter' as TierLevel,
                balances: {},
                enabledExchanges: u.enabled_exchanges || [],
                tradingEnabled: u.auto_trade ?? false,
                tradeAmount: u.trade_amount ?? 10,
                minProfitPercent: u.min_profit_percent ?? 0.0005,
                slippageBuffer: u.slippage_buffer ?? 0.5,
                maxPositionSize: u.max_position_size ?? 1000,
                currentDailyLoss: 0,
                currentOpenPositions: 0
            }));
        } catch (e) {
            console.error('[UserService] Failed to fetch users', e);
            return [];
        }
    }
}

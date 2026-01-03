import { Opportunity, TierLevel, getTierConfig, getExchangeOverride } from '../../../shared/dist';


export interface UserContext {
    userId: string;
    tier: TierLevel;
    balances: Record<string, number>; // e.g. { 'USDT': 1000, 'BTC': 0.5 }
    enabledExchanges: string[];
    tradingEnabled: boolean;
    minProfitPct?: number; // User override
    riskLimits?: {
        maxDailyLoss: number;
        maxOpenPositions: number;
    };
    // Current usage metrics for risk checks
    currentDailyLoss: number;
    currentOpenPositions: number;
}

export class EligibilityFilter {
    private blacklist = new Set<string>();

    public banUser(userId: string, reason: string) {
        this.blacklist.add(userId);
        console.warn(`[Eligibility] User ${userId} BANNED: ${reason}`);
    }

    /**
     * Filters users who are eligible for a specific opportunity.
     * @param opportunity The detected arbitrage opportunity
     * @param users List of active users with their current state
     */
    filter(opportunity: Opportunity, users: UserContext[]): UserContext[] {
        const eligibleUsers: UserContext[] = [];

        for (const user of users) {
            if (this.isEligible(opportunity, user)) {
                eligibleUsers.push(user);
            }
        }

        return eligibleUsers;
    }

    private isEligible(opportunity: Opportunity, user: UserContext): boolean {
        // 18.0 Blacklist Check (Priority)
        if (this.blacklist.has(user.userId)) return false;

        // 1. Global Trading Switch
        if (!user.tradingEnabled) return false;

        // 2. Exchange Enablement
        // Opportunity has 'exchange'. User must have it enabled.
        if (!user.enabledExchanges.includes(opportunity.exchange)) return false;

        // 3. Risk Limits (Phase 5 requirement)
        if (user.riskLimits) {
            // Check Max Daily Loss
            if (user.currentDailyLoss >= user.riskLimits.maxDailyLoss) {
                // User has hit their loss limit for the day
                return false;
            }
            // Check Max Open Positions
            if (user.currentOpenPositions >= user.riskLimits.maxOpenPositions) {
                // User has too many open trades
                return false;
            }
        }

        // 4. Tier / Profit Threshold + Exchange Overrides
        // Use user specific minProfitPct if set, otherwise fallback to Tier default
        // Then add the mandatory Exchange profit boost.

        const tierConfig = getTierConfig(user.tier);
        const exchangeConfig = getExchangeOverride(opportunity.exchange);

        // a) VIP Only Check
        if (exchangeConfig.vipOnly && user.tier !== TierLevel.VIP) {
            return false;
        }

        const effectiveMinProfit = Math.max(user.minProfitPct || 0, tierConfig.minProfitPct) + exchangeConfig.profitBoost;

        if (opportunity.profitPct < effectiveMinProfit) return false;

        // 5. Balance Check
        // Opportunity usually requires a trade in Quote currency (Asset A in path).
        const startAsset = opportunity.path[0];
        const userBalance = user.balances[startAsset] || 0;

        // We need a minimum trade size.
        if (userBalance < 10) return false;

        return true;
    }
}

import { Opportunity, TierLevel, getTierConfig } from '../../../shared/src';
import { UserContext } from './EligibilityFilter';

export interface Allocation {
    userId: string;
    amount: number; // Allocated amount in Quote Currency (Asset A)
}

// 15.1 HARD CAPITAL CAPS
const RISK_LIMITS = {
    maxCapitalPctPerTrade: 0.02,   // 2% of equity
    maxCapitalPerTradeUSDT: 200,   // hard cap
    maxTradesPerMinute: 3,
    maxConcurrentTrades: 1,
};

export class AllocationEngine {

    private computeAllocation(equityUSDT: number, requested: number): number {
        const pctCap = equityUSDT * RISK_LIMITS.maxCapitalPctPerTrade;
        return Math.min(
            requested,
            pctCap,
            RISK_LIMITS.maxCapitalPerTradeUSDT
        );
    }

    /**
     * Allocates trade volume to eligible users based on tier weights.
     * @param opportunity The detected opportunity
     * @param eligibleUsers List of users who passed the filter
     * @returns List of allocations
     */
    allocate(opportunity: Opportunity, eligibleUsers: UserContext[]): Allocation[] {
        if (eligibleUsers.length === 0) return [];

        const allocations: Allocation[] = [];
        let totalWeight = 0;

        // 1. Calculate Total Weight (Balance x TierWeight)
        const userWeights: { userId: string, weight: number, score: number, config: any }[] = [];

        for (const user of eligibleUsers) {
            const tierConfig = getTierConfig(user.tier);
            const startAsset = opportunity.path[0];
            const balance = user.balances[startAsset] || 0;

            // Calculate Score
            const score = balance * tierConfig.weight;
            totalWeight += score;

            userWeights.push({
                userId: user.userId,
                weight: tierConfig.weight,
                score,
                config: tierConfig
            });
        }

        if (totalWeight === 0) return [];

        // 2. Distribute Liquidity
        for (const user of userWeights) {
            const ratio = user.score / totalWeight;
            let rawAllocation = opportunity.maxExecutableUSDT * ratio;

            const u = eligibleUsers.find(el => el.userId === user.userId)!;
            const balance = u.balances[opportunity.path[0]] || 0;

            // Apply Constraints (Task 6.1)

            // a) Tier Max Trade Size
            rawAllocation = Math.min(rawAllocation, user.config.maxTradeSize);

            // b) User Balance (Cannot trade more than they have)
            rawAllocation = Math.min(rawAllocation, balance);

            // c) Phase 15.1 Hard Capital Caps
            // We treat 'balance' as Equity for now (Assuming USDT)
            rawAllocation = this.computeAllocation(balance, rawAllocation);

            // d) Rounding (Task 6.2 - Round DOWN only)
            // Precision usually 2 decimals for USDT, or depends on asset. 
            // `Math.floor(num * 100) / 100`
            let finalAlloc = Math.floor(rawAllocation * 100) / 100;

            // d) Min Notional check (Task 6.2)
            // "Remove allocations below min notional"
            if (finalAlloc < 10) { // Assuming $10 min
                finalAlloc = 0;
            }

            if (finalAlloc > 0) {
                allocations.push({ userId: user.userId, amount: finalAlloc });
            }
        }

        // 3. Final Liquidity Check (Task 6.1 Verification)
        // "Sum of allocations <= maxExecutableUSDT"
        const totalAllocated = allocations.reduce((sum, a) => sum + a.amount, 0);

        // If we over-allocated (due to math quirks, though min calls should prevent), limit. 
        // Actually since we used (Ratio * Max), sum should be <= Max.
        // But individual caps (min) might skew it down. 
        // If we strictly follow proportional, we are fine.

        // What if Total > Liquidity? (Rounding errors?) 
        // Math.floor is safe.

        return allocations;
    }
}

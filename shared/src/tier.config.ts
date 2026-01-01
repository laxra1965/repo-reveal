
export enum TierLevel {
    BASIC = 'BASIC',
    PRO = 'PRO',
    VIP = 'VIP'
}

export interface TierConfig {
    name: TierLevel;
    weight: number;
    maxTradeSize: number;
    maxSlippage: number;
    priority: number;
    minProfitPct: number;
    rateLimit: number;
}

export const TIER_CONFIG: Record<TierLevel, TierConfig> = {
    [TierLevel.BASIC]: {
        name: TierLevel.BASIC,
        weight: 1.0,
        maxTradeSize: 100,
        maxSlippage: 0.005,
        priority: 1,
        minProfitPct: 0.5,
        rateLimit: 5
    },
    [TierLevel.PRO]: {
        name: TierLevel.PRO,
        weight: 2.5,
        maxTradeSize: 1000,
        maxSlippage: 0.01,
        priority: 10,
        minProfitPct: 0.3,
        rateLimit: 20
    },
    [TierLevel.VIP]: {
        name: TierLevel.VIP,
        weight: 10.0,
        maxTradeSize: 10000,
        maxSlippage: 0.02,
        priority: 100,
        minProfitPct: 0.1,
        rateLimit: 100
    }
};

export const getTierConfig = (tierName: string): TierConfig => {
    const normalized = tierName.toUpperCase() as TierLevel;
    return TIER_CONFIG[normalized] || TIER_CONFIG[TierLevel.BASIC];
};

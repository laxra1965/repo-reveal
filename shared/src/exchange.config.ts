
import { TierLevel } from './tier.config';

export interface ExchangeOverride {
    profitBoost: number; // Percentage to add to minProfit requirement
    vipOnly?: boolean;   // If true, only VIP users can execute on this exchange
}

export const EXCHANGE_OVERRIDES: Record<string, ExchangeOverride> = {
    'binance': { profitBoost: 0 },
    'bybit': { profitBoost: 0.05 },
    'gate': { profitBoost: 0.15 },
    'mexc': { profitBoost: 0.30, vipOnly: true }
};

export const getExchangeOverride = (exchange: string): ExchangeOverride => {
    return EXCHANGE_OVERRIDES[exchange.toLowerCase()] || { profitBoost: 0 };
};

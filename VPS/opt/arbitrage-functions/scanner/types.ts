/**
 * Scanner types for Standard Opportunity representation
 */

export type Strategy = 'triangular_arbitrage' | 'cross_exchange';
export type OpportunityStatus = 'active' | 'expired';
export type TradeDirection = 'forward' | 'reverse';

export interface StepPricing {
    step: number;
    price: number;
    description: string; // e.g., "Ask BNBUSDT"
}

export interface StandardOpportunity {
    strategy: Strategy;
    exchange?: string;
    primary_exchange?: string;
    bridge_exchange?: string;

    // Path of assets, e.g. ["USDT","BNB","SOL","USDT"]
    path: string[];

    // Profit and quality metrics
    profit_percent: number;
    profit_amount?: number;
    liquidity_score: number;
    volume_estimate: number;
    estimated_slippage: number;

    // Fee-adjusted metrics
    profit_after_fees?: number;
    profit_percent_after_fees?: number;
    fee_percent_used?: number; // e.g., 0.3 for typical maker/taker fees

    // Timestamps
    detected_at: number; // unix epoch seconds

    // Execution routing
    exchange1: string | null;
    exchange2: string | null;
    exchange3: string | null;

    pair1: string | null;
    pair2: string | null;
    pair3: string | null;

    status: OpportunityStatus;

    // Additional scanner-specific fields
    direction?: TradeDirection; // 'forward' or 'reverse'
    step_prices?: StepPricing[]; // Detailed pricing for each step
}

export type Strategy = 'triangular_arbitrage' | 'cross_exchange';

export type OpportunityStatus = 'active' | 'expired';

// Canonical in-memory / API representation
export interface StandardOpportunity {
  strategy: Strategy;

  // Single-exchange strategy
  exchange?: string;

  // Cross-exchange strategy
  primary_exchange?: string;
  bridge_exchange?: string;

  // Path of assets, e.g. ["USDT","BNB","SOL","USDT"]
  path: string[];

  // Profit and quality metrics
  profit_percent: number;
  liquidity_score: number;
  volume_estimate: number;
  estimated_slippage: number;

  // Timestamps
  detected_at: number; // unix epoch seconds

  // Execution routing (mapped to DB columns)
  exchange1: string | null;
  exchange2: string | null;
  exchange3: string | null;

  pair1: string | null;
  pair2: string | null;
  pair3: string | null;

  // Execution steps (optional, for detailed routing)
  base_symbol?: string;
  intermediate_symbol?: string;
  quote_symbol?: string;
  
  step1_action?: string;
  step1_price?: number;
  step1_amount?: number;
  
  step2_action?: string;
  step2_price?: number;
  step2_amount?: number;
  
  step3_action?: string;
  step3_price?: number;
  step3_amount?: number;

  status: OpportunityStatus;
}

export const formatPath = (path: string[]): string => path.join('→');


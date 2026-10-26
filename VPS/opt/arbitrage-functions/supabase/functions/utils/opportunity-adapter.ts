import { StandardOpportunity, Strategy } from './opportunity-types.ts';

// Unified interface for all legacy triangular opportunities
interface LegacyOpportunity {
  type: string;
  base_symbol: string;
  intermediate_symbol?: string;
  intermediate_symbol_1?: string;
  intermediate_symbol_2?: string;
  quote_symbol?: string;
  exchange1: string;
  exchange2: string;
  exchange3: string;
  step1_price: number;
  step2_price: number;
  step3_price: number;
  step1_action?: string;
  step2_action?: string;
  step3_action?: string;
  step1_amount?: number;
  step2_amount?: number;
  step3_amount?: number;
  start_amount: number;
  end_amount: number;
  profit_amount: number;
  profit_percent: number;
}

const buildPairsForTriangular = (
  base: string,
  intermediate: string,
  quote: string
): { pair1: string; pair2: string; pair3: string; path: string[] } => {
  // Ensure we don't have 'undefined' strings
  const b = base || 'USDT';
  const i1 = intermediate || '';
  const i2 = quote || '';

  const path = [b, i1, i2, b].filter(p => p !== '');

  const pair1 = i1 && b ? `${i1}${b}` : '';
  const pair2 = i2 && i1 ? `${i2}${i1}` : '';
  const pair3 = i2 && b ? `${i2}${b}` : '';

  return { pair1, pair2, pair3, path };
};

export const adaptLegacyTriangular = (
  legacy: LegacyOpportunity[],
  strategy: Strategy = 'triangular_arbitrage'
): StandardOpportunity[] => {
  const nowSec = Math.floor(Date.now() / 1000);

  return legacy
    .filter(o => o.profit_percent < 100 && o.profit_percent > -50) // Sanity check for unrealistic profits
    .map((o) => {
      const base = o.base_symbol;
      const int1 = o.intermediate_symbol || o.intermediate_symbol_1;
      const int2 = o.quote_symbol || o.intermediate_symbol_2;

      const { pair1, pair2, pair3, path } = buildPairsForTriangular(
        base,
        int1 || '',
        int2 || ''
      );

      return {
        strategy,
        exchange: o.exchange1,
        primary_exchange: o.exchange1,
        bridge_exchange: undefined,
        path,
        profit_percent: o.profit_percent,
        liquidity_score: 1,
        volume_estimate: o.start_amount,
        estimated_slippage: 0,
        detected_at: nowSec,
        exchange1: o.exchange1,
        exchange2: o.exchange2,
        exchange3: o.exchange3,
        pair1,
        pair2,
        pair3,
        
        // Preservation of execution steps for the engine
        base_symbol: base,
        intermediate_symbol: int1,
        quote_symbol: int2,
        step1_action: o.step1_action,
        step1_price: o.step1_price,
        step1_amount: o.step1_amount,
        step2_action: o.step2_action,
        step2_price: o.step2_price,
        step2_amount: o.step2_amount,
        step3_action: o.step3_action,
        step3_price: o.step3_price,
        step3_amount: o.step3_amount,

        status: 'active',
      };
    });
};

export const adaptLegacyCrossExchange = (
  legacy: LegacyOpportunity[]
): StandardOpportunity[] => {
  const nowSec = Math.floor(Date.now() / 1000);

  return legacy
    .filter(o => o.profit_percent < 100 && o.profit_percent > -50)
    .map((o) => {
      const base = o.base_symbol;
      const int1 = o.intermediate_symbol || o.intermediate_symbol_1;
      const int2 = o.quote_symbol || o.intermediate_symbol_2;

      const { pair1, pair2, pair3, path } = buildPairsForTriangular(
        base,
        int1 || '',
        int2 || ''
      );

      return {
        strategy: 'cross_exchange' as Strategy,
        exchange: undefined,
        primary_exchange: o.exchange1,
        bridge_exchange: o.exchange2,
        path,
        profit_percent: o.profit_percent,
        liquidity_score: 1,
        volume_estimate: o.start_amount,
        estimated_slippage: 0,
        detected_at: nowSec,
        exchange1: o.exchange1,
        exchange2: o.exchange2,
        exchange3: o.exchange3,
        pair1,
        pair2,
        pair3,
        status: 'active',
      };
    });
};


import { describe, it, expect } from 'vitest';
import {
  partitionOpportunities,
  evaluateOpportunity,
  normalizeStrategy,
  type EligibilityOpportunity,
} from '@/lib/opportunityEligibility';

/**
 * End-to-end style test for the auto trader's strategy gate: a mixed dataset of
 * triangular and non-triangular opportunities must reduce to triangular only
 * when the user selects triangular arbitrage in their configuration.
 */

const NOW = Date.now();
const fresh = () => new Date(NOW - 5_000).toISOString();

const opp = (
  id: string,
  strategy: string,
  overrides: Partial<EligibilityOpportunity> = {}
): EligibilityOpportunity => ({
  id,
  strategy,
  status: 'active',
  detected_at: fresh(),
  profit_percent: 1.2,
  estimated_slippage: 0.001,
  exchange1: 'binance',
  exchange2: 'bybit',
  exchange3: 'okx',
  ...overrides,
});

const dataset: EligibilityOpportunity[] = [
  opp('t1', 'triangular'),
  opp('t2', 'triangular_arbitrage'),
  opp('t3', 'triangular-arbitrage'),
  opp('c1', 'cross_exchange'),
  opp('c2', 'cross-exchange-arbitrage'),
  opp('s1', 'statistical'),
  opp('f1', 'futures_arbitrage'),
];

const settings = (types: string[]) => ({
  arbitrage_types: types,
  min_profit_percent: null,
  max_profit_percent: null,
  enabled_exchanges: ['binance', 'bybit', 'okx'],
  slippage_buffer: null,
  trade_amount: 250,
  max_position_size: 1000,
});

describe('auto trader strategy selection', () => {
  it('queues only triangular opportunities when triangular is selected', () => {
    const { eligible, skipped } = partitionOpportunities(dataset, settings(['triangular']), NOW);

    expect(eligible.map(o => o.id).sort()).toEqual(['t1', 't2', 't3']);
    expect(skipped.map(s => s.opportunity.id).sort()).toEqual(['c1', 'c2', 'f1', 's1']);
    for (const s of skipped) {
      expect(s.reason.field).toBe('arbitrage_types');
      expect(s.reason.source).toBe('configuration');
      expect(s.reason.message).toMatch(/not in your selected types/i);
    }
  });

  it('normalizes suffixed and hyphenated strategy names', () => {
    expect(normalizeStrategy('triangular-arbitrage')).toBe('triangular');
    expect(normalizeStrategy('triangular_arbitrage')).toBe('triangular');
    expect(normalizeStrategy('Cross-Exchange')).toBe('cross_exchange');
  });

  it('queues multiple selected strategy types', () => {
    const { eligible } = partitionOpportunities(dataset, settings(['triangular', 'cross_exchange']), NOW);
    expect(eligible.map(o => o.id).sort()).toEqual(['c1', 'c2', 't1', 't2', 't3']);
  });

  it('skips non-triangular trades even when they are more profitable', () => {
    const mixed = [
      opp('t-low', 'triangular', { profit_percent: 0.9 }),
      opp('x-high', 'cross_exchange', { profit_percent: 9.5 }),
    ];
    const { eligible, skipped } = partitionOpportunities(mixed, settings(['triangular']), NOW);
    expect(eligible.map(o => o.id)).toEqual(['t-low']);
    expect(skipped[0].reason.rule).toMatch(/selected arbitrage types/);
  });

  it('reports the precise field and rule for non-strategy skips', () => {
    const stale = evaluateOpportunity(
      opp('stale', 'triangular', { detected_at: new Date(NOW - 10 * 60_000).toISOString() }),
      settings(['triangular']),
      NOW
    );
    expect(stale?.field).toBe('detected_at');

    const negative = evaluateOpportunity(
      opp('neg', 'triangular', { profit_percent: 0.2, estimated_slippage: 0.001 }),
      settings(['triangular']),
      NOW
    );
    expect(negative?.field).toBe('net_profit');

    const wrongExchange = evaluateOpportunity(
      opp('ex', 'triangular', { exchange1: 'kraken', exchange2: 'kraken', exchange3: 'kraken' }),
      settings(['triangular']),
      NOW
    );
    expect(wrongExchange?.field).toBe('enabled_exchanges');
  });
});

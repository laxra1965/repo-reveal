import { describe, it, expect } from 'vitest';
import {
  validateTradeConfig,
  resolveValidatedAmount,
  TRADE_AMOUNT_MAX,
  MAX_POSITION_MAX,
} from '@/lib/tradeConfigValidation';

/**
 * End-to-end guard tests: these mirror the exact code path used by the auto
 * trader (paper mode = no liquidity cap, live mode = capped by the
 * opportunity's volume_estimate). A blocked config must prevent any trade in
 * BOTH modes, matching the server-side `public.validate_trade_config` RPC guard.
 */

const LIQUIDITY = 5_000; // opportunity.volume_estimate for live mode

const runAutoTrade = (
  settings: { trade_amount: unknown; max_position_size: unknown },
  mode: 'paper' | 'live'
) =>
  resolveValidatedAmount(
    {
      tradeAmount: settings.trade_amount as number,
      maxPositionSize: settings.max_position_size as number,
    },
    mode === 'live' ? LIQUIDITY : undefined
  );

const invalidConfigs: Array<[string, { trade_amount: unknown; max_position_size: unknown }]> = [
  ['negative trade amount', { trade_amount: -50, max_position_size: 1000 }],
  ['zero trade amount', { trade_amount: 0, max_position_size: 1000 }],
  ['missing trade amount', { trade_amount: null, max_position_size: 1000 }],
  ['non-numeric trade amount', { trade_amount: 'abc', max_position_size: 1000 }],
  ['below minimum trade amount', { trade_amount: 0.5, max_position_size: 1000 }],
  ['above maximum trade amount', { trade_amount: TRADE_AMOUNT_MAX + 1, max_position_size: null }],
  ['negative max position size', { trade_amount: 100, max_position_size: -1000 }],
  ['zero max position size', { trade_amount: 100, max_position_size: 0 }],
  ['below minimum max position size', { trade_amount: 100, max_position_size: 5 }],
  ['above maximum max position size', { trade_amount: 100, max_position_size: MAX_POSITION_MAX + 1 }],
  ['trade amount above max position size', { trade_amount: 2000, max_position_size: 1000 }],
];

describe('auto trading blocked on invalid trade_amount / max_position_size', () => {
  for (const mode of ['paper', 'live'] as const) {
    describe(`${mode} mode`, () => {
      for (const [label, settings] of invalidConfigs) {
        it(`blocks auto trading with ${label}`, () => {
          const result = runAutoTrade(settings, mode);
          expect('error' in result).toBe(true);
          if ('error' in result) {
            expect(result.error).toBeTruthy();
            expect(result.error.length).toBeGreaterThan(10);
          }
        });
      }
    });
  }

  it('allows a valid config and caps at max_position_size in paper mode', () => {
    const result = runAutoTrade({ trade_amount: 250, max_position_size: 1000 }, 'paper');
    expect(result).toEqual({ amount: 250 });
  });

  it('allows a valid config and caps at liquidity in live mode', () => {
    const result = runAutoTrade({ trade_amount: 9_000, max_position_size: 10_000 }, 'live');
    expect(result).toEqual({ amount: LIQUIDITY });
  });

  it('caps at max_position_size when it is the tighter bound', () => {
    const result = runAutoTrade({ trade_amount: 400, max_position_size: 400 }, 'paper');
    expect(result).toEqual({ amount: 400 });
  });
});

describe('validateTradeConfig messaging', () => {
  it('reports a missing trade amount clearly', () => {
    const r = validateTradeConfig({ tradeAmount: null });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/missing/i);
  });

  it('reports out-of-range trade amount clearly', () => {
    const r = validateTradeConfig({ tradeAmount: TRADE_AMOUNT_MAX + 5 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/cannot exceed/i);
  });

  it('reports trade amount exceeding max position size', () => {
    const r = validateTradeConfig({ tradeAmount: 5000, maxPositionSize: 1000 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/max position size/i);
  });

  it('accepts a config with no max position size set', () => {
    const r = validateTradeConfig({ tradeAmount: 100, maxPositionSize: null });
    expect(r.valid).toBe(true);
  });
});

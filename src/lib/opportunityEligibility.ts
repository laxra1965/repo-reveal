/**
 * Shared eligibility rules deciding whether an opportunity may be traded
 * (auto or manual, paper or live). Extracted so the scanner UI, the
 * skip-reason summary and the tests all use exactly the same logic.
 */

import { resolveValidatedAmount } from '@/lib/tradeConfigValidation';

export interface EligibilityOpportunity {
  id: string;
  strategy?: string | null;
  status?: string | null;
  detected_at?: string | null;
  profit_percent: number;
  estimated_slippage: number;
  exchange1?: string | null;
  exchange2?: string | null;
  exchange3?: string | null;
}

export interface EligibilitySettings {
  arbitrage_types?: string[] | null;
  min_profit_percent?: number | null;
  max_profit_percent?: number | null;
  enabled_exchanges?: string[] | null;
  slippage_buffer?: number | null;
  trade_amount?: number | string | null;
  max_position_size?: number | string | null;
}

export type SkipField =
  | 'status'
  | 'detected_at'
  | 'net_profit'
  | 'arbitrage_types'
  | 'min_profit_percent'
  | 'max_profit_percent'
  | 'enabled_exchanges'
  | 'slippage_buffer'
  | 'trade_amount'
  | 'max_position_size';

export interface SkipReason {
  /** Which setting/field caused the skip. */
  field: SkipField;
  /** Machine-readable rule identifier. */
  rule: string;
  /** Human-readable explanation shown in the UI. */
  message: string;
  /** Whether the opportunity itself or the user's configuration is at fault. */
  source: 'opportunity' | 'configuration';
}

export const STALE_THRESHOLD_MS = 5 * 60_000;
export const TRADING_FEES_PCT = 0.3; // 3 legs x 0.1%

/** triangular / triangular_arbitrage / triangular-arbitrage all match. */
export const normalizeStrategy = (s: string) =>
  s.replace(/[-_]arbitrage$/i, '').replace(/[-_]/g, '_').toLowerCase();

/**
 * Returns null when the opportunity passes every filter, otherwise the first
 * failing rule.
 */
export function evaluateOpportunity(
  opp: EligibilityOpportunity,
  settings: EligibilitySettings,
  now = Date.now()
): SkipReason | null {
  if (opp.status && opp.status !== 'active') {
    return {
      field: 'status',
      rule: 'status === "active"',
      message: `Opportunity status is "${opp.status}" (only active opportunities are traded).`,
      source: 'opportunity',
    };
  }

  if (opp.detected_at) {
    const ageMs = now - new Date(opp.detected_at).getTime();
    if (ageMs > STALE_THRESHOLD_MS) {
      return {
        field: 'detected_at',
        rule: `age <= ${STALE_THRESHOLD_MS / 1000}s`,
        message: `Opportunity is stale (${Math.round(ageMs / 1000)}s old, limit ${STALE_THRESHOLD_MS / 1000}s).`,
        source: 'opportunity',
      };
    }
  }

  const slippagePct = (opp.estimated_slippage ?? 0) * 100;
  const netProfitPct = opp.profit_percent - TRADING_FEES_PCT - slippagePct;
  if (netProfitPct <= 0) {
    return {
      field: 'net_profit',
      rule: 'gross profit - 0.3% fees - slippage > 0',
      message: `Net profit is ${netProfitPct.toFixed(3)}% after ${TRADING_FEES_PCT}% fees and ${slippagePct.toFixed(3)}% slippage.`,
      source: 'opportunity',
    };
  }

  if (settings.arbitrage_types?.length && opp.strategy) {
    const allowed = new Set(settings.arbitrage_types.map(normalizeStrategy));
    if (!allowed.has(normalizeStrategy(opp.strategy))) {
      return {
        field: 'arbitrage_types',
        rule: 'strategy must be in selected arbitrage types',
        message: `Strategy "${opp.strategy}" is not in your selected types (${settings.arbitrage_types.join(', ')}).`,
        source: 'configuration',
      };
    }
  }

  if (settings.min_profit_percent != null && opp.profit_percent < settings.min_profit_percent) {
    return {
      field: 'min_profit_percent',
      rule: `profit_percent >= ${settings.min_profit_percent}`,
      message: `Profit ${opp.profit_percent}% is below your minimum of ${settings.min_profit_percent}%.`,
      source: 'configuration',
    };
  }

  if (settings.max_profit_percent != null && opp.profit_percent > settings.max_profit_percent) {
    return {
      field: 'max_profit_percent',
      rule: `profit_percent <= ${settings.max_profit_percent}`,
      message: `Profit ${opp.profit_percent}% is above your maximum of ${settings.max_profit_percent}%.`,
      source: 'configuration',
    };
  }

  if (settings.enabled_exchanges?.length) {
    const oppExchanges = [opp.exchange1, opp.exchange2, opp.exchange3].filter(Boolean) as string[];
    const enabled = settings.enabled_exchanges.map(e => e.toLowerCase());
    if (!oppExchanges.some(ex => enabled.includes(ex.toLowerCase()))) {
      return {
        field: 'enabled_exchanges',
        rule: 'at least one leg on an enabled exchange',
        message: `None of ${oppExchanges.join(', ') || 'the legs'} are in your enabled exchanges (${settings.enabled_exchanges.join(', ')}).`,
        source: 'configuration',
      };
    }
  }

  if (settings.slippage_buffer != null && opp.estimated_slippage > settings.slippage_buffer) {
    return {
      field: 'slippage_buffer',
      rule: `estimated_slippage <= ${settings.slippage_buffer}`,
      message: `Estimated slippage ${opp.estimated_slippage} exceeds your buffer of ${settings.slippage_buffer}.`,
      source: 'configuration',
    };
  }

  return null;
}

/**
 * Config-level check applied before any trade is submitted (paper or live).
 * Live mode additionally caps by the opportunity's liquidity.
 */
export function evaluateTradeConfig(
  settings: EligibilitySettings,
  mode: 'paper' | 'live',
  liquidityCap?: number
): { amount: number } | { reason: SkipReason } {
  const resolved = resolveValidatedAmount(
    { tradeAmount: settings.trade_amount ?? null, maxPositionSize: settings.max_position_size ?? null },
    mode === 'live' ? liquidityCap : undefined
  );
  if ('error' in resolved) {
    const field: SkipField = /max position/i.test(resolved.error) && !/Trade amount cannot exceed max/i.test(resolved.error)
      ? 'max_position_size'
      : 'trade_amount';
    return {
      reason: {
        field,
        rule: 'validate_trade_config(trade_amount, max_position_size)',
        message: resolved.error,
        source: 'configuration',
      },
    };
  }
  return resolved;
}

/** Split opportunities into eligible ones and skipped ones with their reasons. */
export function partitionOpportunities<T extends EligibilityOpportunity>(
  opportunities: T[],
  settings: EligibilitySettings,
  now = Date.now()
): { eligible: T[]; skipped: Array<{ opportunity: T; reason: SkipReason }> } {
  const eligible: T[] = [];
  const skipped: Array<{ opportunity: T; reason: SkipReason }> = [];
  for (const opp of opportunities) {
    const reason = evaluateOpportunity(opp, settings, now);
    if (reason) skipped.push({ opportunity: opp, reason });
    else eligible.push(opp);
  }
  return { eligible, skipped };
}

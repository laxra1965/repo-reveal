/**
 * Shared client-side validation for a user's trading configuration.
 * Mirrors the server-side `public.validate_trade_config(numeric, numeric)`
 * used by the auto-trader RPCs, so the UI and the database agree on limits.
 */

export const TRADE_AMOUNT_MIN = 1;
export const TRADE_AMOUNT_MAX = 1_000_000;
export const MAX_POSITION_MIN = 10;
export const MAX_POSITION_MAX = 1_000_000;

export interface TradeConfigInput {
  tradeAmount?: number | string | null;
  maxPositionSize?: number | string | null;
}

export interface TradeConfigValidation {
  valid: boolean;
  /** Human-readable reason the config is invalid (undefined when valid). */
  reason?: string;
  /** Sanitized numbers (only meaningful when valid). */
  tradeAmount: number;
  maxPositionSize: number | null;
}

const toNumber = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
};

export function validateTradeConfig(input: TradeConfigInput): TradeConfigValidation {
  const amount = toNumber(input.tradeAmount);
  const maxPos = toNumber(input.maxPositionSize);

  const fail = (reason: string): TradeConfigValidation => ({
    valid: false,
    reason,
    tradeAmount: NaN,
    maxPositionSize: null,
  });

  if (amount === null) return fail('Trade amount is missing. Set it in Trading Configuration before trading.');
  if (Number.isNaN(amount)) return fail('Trade amount must be a valid number.');
  if (amount <= 0) return fail('Trade amount must be greater than zero.');
  if (amount < TRADE_AMOUNT_MIN) return fail(`Trade amount must be at least ${TRADE_AMOUNT_MIN} USDT.`);
  if (amount > TRADE_AMOUNT_MAX) return fail(`Trade amount cannot exceed ${TRADE_AMOUNT_MAX.toLocaleString()} USDT.`);

  if (maxPos !== null) {
    if (Number.isNaN(maxPos)) return fail('Max position size must be a valid number.');
    if (maxPos <= 0) return fail('Max position size must be greater than zero.');
    if (maxPos < MAX_POSITION_MIN) return fail(`Max position size must be at least ${MAX_POSITION_MIN} USDT.`);
    if (maxPos > MAX_POSITION_MAX) return fail(`Max position size cannot exceed ${MAX_POSITION_MAX.toLocaleString()} USDT.`);
    if (amount > maxPos) return fail('Trade amount cannot exceed max position size.');
  }

  return { valid: true, tradeAmount: amount, maxPositionSize: maxPos };
}

/**
 * Resolve the notional to trade, or throw a descriptive error when the saved
 * configuration is invalid. `liquidityCap` applies to live trades only.
 */
export function resolveValidatedAmount(
  input: TradeConfigInput,
  liquidityCap?: number
): { amount: number } | { error: string } {
  const result = validateTradeConfig(input);
  if (!result.valid) return { error: result.reason! };

  let amount = result.tradeAmount;
  if (result.maxPositionSize && result.maxPositionSize > 0) {
    amount = Math.min(amount, result.maxPositionSize);
  }
  if (liquidityCap && liquidityCap > 0) {
    amount = Math.min(amount, liquidityCap);
  }
  if (!(amount > 0)) return { error: 'Resolved trade size is zero — check your trading configuration.' };
  return { amount };
}

/**
 * Central execution-mode configuration for the executor service.
 *
 * Live orders are only ever sent when BOTH of these are true:
 *   TRADING_ENABLED=true      (global safety switch)
 *   EXECUTION_MODE=live       (explicit opt-in to real market orders)
 *
 * Any other combination keeps the executors in dry-run (simulated fill) mode.
 */
export const TRADING_ENABLED = process.env.TRADING_ENABLED === 'true';
export const EXECUTION_MODE = (process.env.EXECUTION_MODE || 'dry_run').toLowerCase();

export function isLiveTrading(): boolean {
    return TRADING_ENABLED && EXECUTION_MODE === 'live';
}

export function isDryRun(): boolean {
    return !isLiveTrading();
}

/** Throws when live trading is globally disabled. */
export function assertTradingEnabled(context: string): void {
    if (!TRADING_ENABLED) {
        throw new Error(`Trading is disabled (${context}). Set TRADING_ENABLED=true to enable live trading.`);
    }
}

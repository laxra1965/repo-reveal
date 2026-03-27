/**
 * Per-exchange taker fee rates and slippage estimation utilities.
 * Used by Scanner to produce more accurate profit figures.
 */

export const EXCHANGE_TAKER_FEES: Record<string, number> = {
    binance: 0.001,   // 0.10%
    bybit:   0.001,   // 0.10%
    okx:     0.001,   // 0.10%
    kucoin:  0.001,   // 0.10%
    gate:    0.002,   // 0.20%  — higher than average
    mexc:    0.001,   // 0.10%
    htx:     0.002,   // 0.20%
    bitget:  0.001,   // 0.10%
};

/**
 * Returns the taker fee for a given exchange.
 * Falls back to 0.1% if unknown.
 */
export function getTakerFee(exchange: string): number {
    return EXCHANGE_TAKER_FEES[exchange.toLowerCase()] ?? 0.001;
}

/**
 * Estimate slippage as a fraction (0-1) based on trade size vs available depth.
 * Called per-leg if order book depth info is available.
 */
export function estimateSlippage(tradeSizeUSDT: number, depthUSDT: number): number {
    if (depthUSDT <= 0) return 0.005; // 0.5% worst case
    const ratio = tradeSizeUSDT / depthUSDT;
    if (ratio > 0.10) return 0.005;
    if (ratio > 0.05) return 0.003;
    if (ratio > 0.01) return 0.001;
    return 0.0005;
}

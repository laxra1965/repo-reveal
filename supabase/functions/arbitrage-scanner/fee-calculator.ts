// Fee and slippage calculation utilities

// Per-exchange fee structure (taker/maker fees)
export const EXCHANGE_FEES: Record<string, { taker: number; maker: number }> = {
  'binance': { taker: 0.001, maker: 0.001 },   // 0.1% both (or 0.075% with BNB)
  'bybit': { taker: 0.001, maker: 0.001 },     // 0.1% both
  'okx': { taker: 0.001, maker: 0.0008 },      // 0.1% taker, 0.08% maker
  'kucoin': { taker: 0.001, maker: 0.001 },    // 0.1% both
  'gate': { taker: 0.002, maker: 0.002 },      // 0.2% both (higher!)
  'mexc': { taker: 0.002, maker: 0.002 }       // 0.2% both
};

// Withdrawal fees by exchange and asset (in asset units)
export const WITHDRAWAL_FEES: Record<string, Record<string, number>> = {
  'binance': {
    'BTC': 0.0005,   // ~$15 @ $30k
    'ETH': 0.003,    // ~$6 @ $2k
    'BNB': 0.002,    // ~$0.60 @ $300
    'USDT': 1,       // TRC20 - cheapest option
    'SOL': 0.01,     // ~$1.50
    'XRP': 0.25      // ~$0.15
  },
  'bybit': {
    'BTC': 0.0005,
    'ETH': 0.005,
    'USDT': 1,
    'SOL': 0.01
  },
  'okx': {
    'BTC': 0.0004,
    'ETH': 0.004,
    'USDT': 1,
    'SOL': 0.01
  },
  'kucoin': {
    'BTC': 0.0005,
    'ETH': 0.005,
    'USDT': 1
  },
  'gate': {
    'BTC': 0.0005,
    'ETH': 0.004,
    'USDT': 1
  },
  'mexc': {
    'BTC': 0.0005,
    'ETH': 0.004,
    'USDT': 1
  }
};

/**
 * Estimate slippage based on order size vs market liquidity
 * @param orderSizeUSDT - Order size in USDT
 * @param volumeUSDT - 24h volume in USDT
 * @returns Slippage percentage (0.0005 = 0.05%)
 */
export function estimateSlippage(orderSizeUSDT: number, volumeUSDT: number): number {
  if (volumeUSDT === 0) return 0.01; // 1% if no volume data

  const volumeRatio = orderSizeUSDT / volumeUSDT;

  // Conservative slippage estimates
  if (volumeRatio > 0.1) return 0.005;   // 0.5% for orders >10% of volume
  if (volumeRatio > 0.05) return 0.003;  // 0.3% for orders >5% of volume
  if (volumeRatio > 0.01) return 0.001;  // 0.1% for orders >1% of volume
  return 0.0005;                          // 0.05% minimum slippage
}

/**
 * Get withdrawal fee in USDT value
 * @param asset - Asset symbol (BTC, ETH, etc.)
 * @param exchange - Exchange name
 * @param assetPriceUSDT - Current asset price in USDT
 * @returns Withdrawal fee in USDT
 */
export function getWithdrawalFeeUSDT(asset: string, exchange: string, assetPriceUSDT: number): number {
  const feeInAsset = WITHDRAWAL_FEES[exchange]?.[asset] || 0;

  // Special case: if asset is already USDT/stablecoin, use fee directly
  if (asset === 'USDT' || asset === 'USDC' || asset === 'DAI') {
    return feeInAsset;
  }

  // Otherwise convert to USDT value
  return feeInAsset * assetPriceUSDT;
}

/**
 * Get taker fee for an exchange (arbitrage always uses market orders = taker)
 * @param exchange - Exchange name
 * @returns Taker fee percentage (0.001 = 0.1%)
 */
export function getTakerFee(exchange: string): number {
  return EXCHANGE_FEES[exchange]?.taker || 0.001;
}


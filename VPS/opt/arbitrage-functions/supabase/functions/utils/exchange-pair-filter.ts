/**
 * Exchange Pair Filter
 * Filters trading pairs from each exchange based on:
 * - Availability of filtered CMC symbols
 * - Valid quote currencies (USDT, BTC, ETH)
 * - Liquidity requirements
 * 
 * Output: Set of tradable pairs per exchange
 */

export type ExchangeType = 'binance' | 'bybit' | 'gate' | 'mexc' | 'kucoin';

export interface ExchangePairFilterConfig {
  minNotional?: number;      // Minimum notional size (default: 10 USDT)
  excludedSymbols?: string[];
}

export interface FilteredPairs {
  exchange: ExchangeType;
  pairs: string[];
  fetchedAt: number;
}

const VALID_QUOTES = new Set(['USDT', 'BTC', 'ETH']);
const DEFAULT_EXCLUDE = new Set(['UP', 'DOWN', 'BULL', 'BEAR']);

/**
 * Get available pairs from price map (works with live orderbook data)
 * Filters to keep only pairs where base OR quote is in filteredSymbols
 * and quote is in {USDT, BTC, ETH}
 */
export function filterPairsFromPriceMap(
  priceMap: Record<string, any>,
  filteredSymbols: Set<string>,
  config: ExchangePairFilterConfig = {}
): string[] {
  const validPairs: string[] = [];
  const minNotional = config.minNotional ?? 10;

  for (const pairKey of Object.keys(priceMap)) {
    const priceData = priceMap[pairKey];
    
    // Skip invalid price data
    if (!priceData || !priceData.askPrice || !priceData.bidPrice) continue;

    // Extract base and quote from pair key
    // Pair keys are like "ARBUSDT", "BTCETH", etc.
    let base = '';
    let quote = '';

    // Try standard quote extraction (USDT, BTC, ETH)
    for (const q of ['USDT', 'BTC', 'ETH', 'BUSD']) {
      if (pairKey.endsWith(q)) {
        quote = q;
        base = pairKey.slice(0, -q.length);
        break;
      }
    }

    // Skip if we couldn't parse the pair
    if (!base || !quote) continue;

    // Skip if quote is not in valid quotes
    if (!VALID_QUOTES.has(quote)) continue;

    // Skip excluded/problematic symbols
    if (DEFAULT_EXCLUDE.has(base) || DEFAULT_EXCLUDE.has(quote)) continue;

    // Filter: Keep only if base OR quote is in CMC filtered symbols
    const baseInFiltered = filteredSymbols.has(base);
    const quoteInFiltered = filteredSymbols.has(quote);

    if (!baseInFiltered && !quoteInFiltered) continue;

    // Skip low liquidity (rough check: if bid-ask spread is huge relative to price)
    const midPrice = (priceData.askPrice + priceData.bidPrice) / 2;
    const spread = ((priceData.askPrice - priceData.bidPrice) / midPrice) * 100;
    
    if (spread > 5) {
      // Spread > 5% is likely low liquidity or stale data
      continue;
    }

    // Notional value check (rough estimate for minimum order)
    // For simplicity, we check if order for 100 units would be > minNotional
    const estimatedNotional = 100 * midPrice;
    if (estimatedNotional < minNotional && quote !== 'BTC' && quote !== 'ETH') {
      // Very small pairs, likely low liquidity
      continue;
    }

    validPairs.push(pairKey);
  }

  return validPairs;
}

/**
 * Extract base and quote from a pair string
 */
export function parsePair(pair: string): { base: string; quote: string } | null {
  // Try standard quote extraction
  for (const q of ['USDT', 'BTC', 'ETH', 'BUSD']) {
    if (pair.endsWith(q)) {
      const base = pair.slice(0, -q.length);
      return { base, quote: q };
    }
  }
  return null;
}

/**
 * Check if a pair should be included based on filtered symbols and quotes
 */
export function shouldIncludePair(
  pair: string,
  filteredSymbols: Set<string>
): boolean {
  const parsed = parsePair(pair);
  if (!parsed) return false;

  const { base, quote } = parsed;

  // Quote must be in valid quotes
  if (!VALID_QUOTES.has(quote)) return false;

  // Skip excluded symbols
  if (DEFAULT_EXCLUDE.has(base) || DEFAULT_EXCLUDE.has(quote)) return false;

  // Base OR quote must be in filtered symbols
  return filteredSymbols.has(base) || filteredSymbols.has(quote);
}

/**
 * Get valid quotes for building triangles
 */
export function getValidQuotes(): string[] {
  return Array.from(VALID_QUOTES);
}

/**
 * Get all valid base currencies from filtered pairs
 */
export function getValidBases(
  filteredPairs: string[]
): Set<string> {
  const bases = new Set<string>();

  for (const pair of filteredPairs) {
    const parsed = parsePair(pair);
    if (parsed) {
      bases.add(parsed.base);
    }
  }

  return bases;
}

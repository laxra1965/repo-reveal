/**
 * CoinMarketCap Filter Layer
 * Fetches and caches filtered assets based on market cap and volume criteria
 * 
 * Output: Set of symbols that meet trading criteria (400M-3B market cap, 50M-300M volume)
 */

interface CMCQuote {
  USD: {
    market_cap: number;
    volume_24h: number;
  };
}

interface CMCCoin {
  symbol: string;
  quote: CMCQuote;
}

interface CMCResponse {
  data: CMCCoin[];
}

export interface FilterConfig {
  minMarketCap?: number;      // default: 400M
  maxMarketCap?: number;      // default: 3B
  minVolume24h?: number;      // default: 50M
  maxVolume24h?: number;      // default: 300M
  limit?: number;             // default: 100
  cacheDurationMs?: number;   // default: 5 minutes
}

export interface FilteredCoinsCache {
  symbols: Set<string>;
  fetchedAt: number;
  config: Required<FilterConfig>;
}

// Global cache
let cmcCache: FilteredCoinsCache | null = null;

/**
 * Fetch filtered coins from CoinMarketCap
 * Caches results for 5-10 minutes to respect rate limits
 */
export async function getCMCFilteredCoins(
  apiKey: string,
  config: FilterConfig = {}
): Promise<Set<string>> {
  const now = Date.now();
  
  // Return cached result if still valid
  if (cmcCache && (now - cmcCache.fetchedAt) < cmcCache.config.cacheDurationMs) {
    console.log(`[CMC] Using cached symbols: ${cmcCache.symbols.size} coins`);
    return new Set(cmcCache.symbols);
  }

  // Merge with defaults
  const finalConfig: Required<FilterConfig> = {
    minMarketCap: config.minMarketCap ?? 400_000_000,      // 400M
    maxMarketCap: config.maxMarketCap ?? 3_000_000_000,    // 3B
    minVolume24h: config.minVolume24h ?? 50_000_000,       // 50M
    maxVolume24h: config.maxVolume24h ?? 300_000_000,      // 300M
    limit: config.limit ?? 100,
    cacheDurationMs: config.cacheDurationMs ?? 5 * 60 * 1000, // 5 minutes
  };

  try {
    console.log(`[CMC] Fetching filtered coins from CoinMarketCap...`);
    
    const response = await fetch(
      'https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest',
      {
        headers: {
          'X-CMC_PRO_API_KEY': apiKey,
        },
        signal: AbortSignal.timeout(10000), // 10s timeout
      }
    );

    if (!response.ok) {
      throw new Error(`CMC API error: ${response.status} ${response.statusText}`);
    }

    const data: CMCResponse = await response.json();

    // Filter coins based on criteria
    const filtered = data.data
      .filter(coin => {
        const mc = coin.quote?.USD?.market_cap || 0;
        const vol = coin.quote?.USD?.volume_24h || 0;

        return mc >= finalConfig.minMarketCap &&
               mc <= finalConfig.maxMarketCap &&
               vol >= finalConfig.minVolume24h &&
               vol <= finalConfig.maxVolume24h;
      })
      .slice(0, finalConfig.limit)
      .map(coin => coin.symbol.toUpperCase());

    const symbols = new Set(filtered);

    // Update cache
    cmcCache = {
      symbols,
      fetchedAt: now,
      config: finalConfig,
    };

    console.log(`[CMC] Fetched and filtered ${symbols.size} coins from CMC`);
    return symbols;
  } catch (error) {
    console.error('[CMC] Error fetching coins:', error);
    
    // Return cached symbols if available, even if stale
    if (cmcCache) {
      console.log(`[CMC] Returning stale cache: ${cmcCache.symbols.size} coins`);
      return new Set(cmcCache.symbols);
    }
    
    throw new Error(`Failed to fetch CMC filtered coins: ${error}`);
  }
}

/**
 * Clear the cache (useful for testing or forcing refresh)
 */
export function clearCMCCache(): void {
  cmcCache = null;
  console.log('[CMC] Cache cleared');
}

/**
 * Get cache status for debugging
 */
export function getCMCCacheStatus(): { cached: boolean; symbols: number; age_ms: number } | null {
  if (!cmcCache) return null;
  return {
    cached: true,
    symbols: cmcCache.symbols.size,
    age_ms: Date.now() - cmcCache.fetchedAt,
  };
}

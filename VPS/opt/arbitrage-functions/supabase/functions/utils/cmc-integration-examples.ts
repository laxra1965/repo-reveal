/**
 * CMC Integration Examples & Usage Patterns
 * 
 * Shows how to integrate the CMC filter layer into your existing scanner
 * without modifying the core execution engine.
 */

import { buildCMCFilteredTriangles, validateCMCIntegration } from './cmc-integration.ts';
import { type StandardOpportunity } from './opportunity-types.ts';

/**
 * EXAMPLE 1: Minimal integration - add to your scanner
 * 
 * Call this once every 5-10 minutes to get filtered triangles
 * Then feed them into your existing evaluation engine
 */
export async function scanWithCMCFilter(
  priceMap: Record<string, any>,
  exchange: string,
  cmcApiKey: string
): Promise<string[]> {
  try {
    const result = await buildCMCFilteredTriangles(priceMap, exchange, {
      cmcApiKey,
      cmcFilterConfig: {
        minMarketCap: 400_000_000,      // 400M
        maxMarketCap: 3_000_000_000,    // 3B
        minVolume24h: 50_000_000,       // 50M
        maxVolume24h: 300_000_000,      // 300M
        limit: 100,
        cacheDurationMs: 5 * 60 * 1000, // 5 min cache
      },
    });

    console.log(`[Scanner] CMC Filter Results:`);
    console.log(`  - Filtered symbols: ${result.stats.cmc_symbols}`);
    console.log(`  - Available pairs: ${result.stats.available_pairs}`);
    console.log(`  - Triangles built: ${result.stats.triangles_built}`);
    console.log(`  - Search space reduction: ${result.stats.reduction_percent}%`);

    // Return triangles in format your engine expects
    return result.triangles.map(t => t.pairs.join(','));
  } catch (error) {
    console.error('[Scanner] CMC Filter error:', error);
    throw error;
  }
}

/**
 * EXAMPLE 2: Hybrid approach - run CMC filter in background, fall back to old method
 * 
 * Useful while testing the CMC integration
 */
export async function scanHybridMode(
  priceMap: Record<string, any>,
  exchange: string,
  cmcApiKey: string,
  fallbackScanFunction: (priceMap: Record<string, any>, exchange: string) => Promise<StandardOpportunity[]>
): Promise<StandardOpportunity[]> {
  try {
    // Try CMC-filtered scan first
    const cmcResult = await buildCMCFilteredTriangles(priceMap, exchange, {
      cmcApiKey,
    });

    // Convert CMC triangles to your StandardOpportunity format
    // (or feed directly into your engine's evaluate function)
    console.log(`[Hybrid] Using CMC filter: ${cmcResult.stats.triangles_built} triangles`);
    
    // TODO: Your engine integration here
    // return evaluateTriangles(cmcResult.triangles, priceMap);

    return [];
  } catch (error) {
    // Fall back to old method
    console.warn('[Hybrid] CMC filter failed, falling back to full scan:', error);
    return fallbackScanFunction(priceMap, exchange);
  }
}

/**
 * EXAMPLE 3: Setup and validation
 * 
 * Run this once to verify CMC API key works
 */
export async function setupCMCIntegration(
  cmcApiKey: string
): Promise<boolean> {
  console.log('[Setup] Validating CMC API key...');
  
  const validation = await validateCMCIntegration(cmcApiKey);
  
  if (validation.valid) {
    console.log(`✓ CMC Integration Ready`);
    console.log(`  ${validation.message}`);
    if (validation.details?.sample_symbols) {
      console.log(`  Sample symbols: ${validation.details.sample_symbols.join(', ')}`);
    }
    return true;
  } else {
    console.error(`✗ CMC Integration Failed`);
    console.error(`  ${validation.message}`);
    return false;
  }
}

/**
 * EXAMPLE 4: Refresh strategy
 * 
 * How to integrate refresh into your existing scanner loop
 */
interface ScannerState {
  lastCMCRefresh: number;
  lastTriangles: string[];
  cmc_refresh_interval_ms: number; // 5-10 minutes
}

export async function scanWithRefreshStrategy(
  priceMap: Record<string, any>,
  exchange: string,
  cmcApiKey: string,
  state: ScannerState
): Promise<string[]> {
  const now = Date.now();
  const timeSinceRefresh = now - state.lastCMCRefresh;

  // Refresh CMC triangles every N minutes
  if (timeSinceRefresh > state.cmc_refresh_interval_ms) {
    console.log(`[Refresh] CMC triangles (${timeSinceRefresh}ms since last refresh)`);
    
    state.lastTriangles = await scanWithCMCFilter(priceMap, exchange, cmcApiKey);
    state.lastCMCRefresh = now;
  } else {
    console.log(`[Refresh] Reusing cached triangles (${timeSinceRefresh}ms since refresh)`);
  }

  return state.lastTriangles;
}

/**
 * EXAMPLE 5: Integration with existing arbitrage scanner function
 * 
 * This shows how to integrate into your findBNBTriangularArbitrage pattern
 */
export function buildTrianglePathsWithCMCFilter(
  priceMap: Record<string, any>,
  filteredSymbols: Set<string>,
  exchange: string
): Array<{ base: string; intermediate: string; quote: string; pairs: string[] }> {
  const paths: Array<{ base: string; intermediate: string; quote: string; pairs: string[] }> = [];
  const validBases = ['USDT', 'BTC', 'ETH'];

  // For each filtered symbol (these become our intermediates)
  for (const alt of filteredSymbols) {
    if (validBases.includes(alt)) continue; // Skip base currencies

    // Look for pairs with this ALT
    for (const base1 of validBases) {
      for (const base2 of validBases) {
        if (base1 >= base2) continue; // Avoid duplicates

        // Check if all three pairs exist
        const pair1Key = `${alt}${base1}`;
        const pair2Key = `${alt}${base2}`;
        const pair3Key = `${base1}${base2}`;

        const p1 = priceMap[pair1Key];
        const p2 = priceMap[pair2Key];
        const p3 = priceMap[pair3Key];

        if (p1 && p2 && p3) {
          paths.push({
            base: base1,
            intermediate: alt,
            quote: base2,
            pairs: [pair1Key, pair2Key, pair3Key],
          });
        }
      }
    }
  }

  return paths;
}

/**
 * EXAMPLE 6: Minimal drop-in replacement for EXPANDED_ALTCOINS
 * 
 * Instead of using EXPANDED_ALTCOINS = [...hardcoded list...]
 * Use this to dynamically get coins
 */
export async function getDynamicAltcoins(
  cmcApiKey: string
): Promise<string[]> {
  try {
    // Use your CMC filter to get top 100 coins by market cap in the 400M-3B range
    const { getCMCFilteredCoins } = await import('./cmc-filter.ts');
    const symbols = await getCMCFilteredCoins(cmcApiKey);
    return Array.from(symbols);
  } catch (error) {
    console.error('[Dynamic Altcoins] Error:', error);
    return []; // Fall back to empty, caller should handle gracefully
  }
}

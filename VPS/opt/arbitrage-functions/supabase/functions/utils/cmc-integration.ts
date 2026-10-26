/**
 * CMC Integration Orchestrator
 * Ties together: CMC Filter → Exchange Pair Filter → Triangle Builder → Engine
 * 
 * This is the main entry point for integrating the CMC-based filtering layer
 */

import { getCMCFilteredCoins, FilterConfig as CMCFilterConfig } from './cmc-filter.ts';
import { 
  filterPairsFromPriceMap, 
  ExchangePairFilterConfig 
} from './exchange-pair-filter.ts';
import { 
  buildTriangles, 
  formatTrianglesForEngine,
  TriangleCandidate,
  TriangleBuildConfig,
  TriangleInput 
} from './triangle-builder.ts';

export interface CMCIntegrationConfig {
  cmcApiKey: string;
  cmcFilterConfig?: CMCFilterConfig;
  exchangePairConfig?: ExchangePairFilterConfig;
  triangleBuilderConfig?: TriangleBuildConfig;
}

export interface FilteredTrianglesOutput {
  filteredSymbols: Set<string>;
  filteredPairs: string[];
  triangles: TriangleInput[];
  stats: {
    cmc_symbols: number;
    available_pairs: number;
    triangles_built: number;
    reduction_percent: number; // vs unfiltered count
  };
}

/**
 * Main orchestrator: CMC → Filter → Build Triangles
 * 
 * Call this once every 5-10 minutes to refresh the search space
 */
export async function buildCMCFilteredTriangles(
  priceMap: Record<string, any>,
  exchange: string,
  config: CMCIntegrationConfig
): Promise<FilteredTrianglesOutput> {
  const startTime = Date.now();

  try {
    // Step 1: Fetch filtered coins from CMC
    console.log(`[INTEGRATION] Step 1: Fetching filtered coins from CMC...`);
    const filteredSymbols = await getCMCFilteredCoins(
      config.cmcApiKey,
      config.cmcFilterConfig
    );
    console.log(`[INTEGRATION] Step 1 complete: ${filteredSymbols.size} coins filtered`);

    // Step 2: Filter pairs from price map
    console.log(`[INTEGRATION] Step 2: Filtering pairs from ${exchange}...`);
    const filteredPairs = filterPairsFromPriceMap(
      priceMap,
      filteredSymbols,
      config.exchangePairConfig
    );
    console.log(`[INTEGRATION] Step 2 complete: ${filteredPairs.length} pairs available`);

    // Step 3: Build triangles
    console.log(`[INTEGRATION] Step 3: Building triangles...`);
    const triangleCandidates = buildTriangles(
      filteredPairs,
      filteredSymbols,
      exchange,
      config.triangleBuilderConfig
    );
    console.log(`[INTEGRATION] Step 3 complete: ${triangleCandidates.length} triangles built`);

    // Step 4: Format for engine
    const triangles = formatTrianglesForEngine(triangleCandidates);

    // Estimate reduction (rough: if we had ALL pairs, how many triangles would we have?)
    const allPairsCount = Object.keys(priceMap).length;
    const reductionPercent = filteredPairs.length > 0
      ? Math.round(((allPairsCount - filteredPairs.length) / allPairsCount) * 100)
      : 0;

    const result: FilteredTrianglesOutput = {
      filteredSymbols,
      filteredPairs,
      triangles,
      stats: {
        cmc_symbols: filteredSymbols.size,
        available_pairs: filteredPairs.length,
        triangles_built: triangles.length,
        reduction_percent: Math.min(reductionPercent, 100),
      },
    };

    const elapsed = Date.now() - startTime;
    console.log(`[INTEGRATION] Complete in ${elapsed}ms. Stats:`, result.stats);

    return result;
  } catch (error) {
    console.error('[INTEGRATION] Error building CMC filtered triangles:', error);
    throw error;
  }
}

/**
 * Validate CMC integration is working
 * Returns diagnostics
 */
export async function validateCMCIntegration(
  apiKey: string
): Promise<{ valid: boolean; message: string; details?: Record<string, any> }> {
  try {
    const coins = await getCMCFilteredCoins(apiKey, { limit: 10 });

    if (!coins || coins.size === 0) {
      return {
        valid: false,
        message: 'CMC filter returned no coins',
      };
    }

    return {
      valid: true,
      message: `CMC integration working. Fetched ${coins.size} coins.`,
      details: {
        sample_symbols: Array.from(coins).slice(0, 5),
      },
    };
  } catch (error) {
    return {
      valid: false,
      message: `CMC integration error: ${error}`,
    };
  }
}

/**
 * Estimate how many triangles we'd scan without CMC filtering
 * vs with CMC filtering (for reporting improvement)
 */
export function estimateSearchSpaceReduction(
  unfiltered_pairs: number,
  filtered_pairs: number,
  available_bases: number = 3
): { unfiltered_triangles: number; filtered_triangles: number; reduction_percent: number } {
  // Very rough estimation:
  // Unfiltered: O(n^3) where n = number of pairs (all permutations)
  // Filtered: Much smaller due to BASE->ALT->BASE structure
  
  const unfiltered_triangles = Math.round(unfiltered_pairs * unfiltered_pairs * available_bases * 0.01); // rough
  const filtered_triangles = Math.round(filtered_pairs * (filtered_pairs / 3) * 0.1); // conservative

  const reduction = Math.round(
    ((unfiltered_triangles - filtered_triangles) / unfiltered_triangles) * 100
  );

  return {
    unfiltered_triangles: Math.max(1, unfiltered_triangles),
    filtered_triangles: Math.max(1, filtered_triangles),
    reduction_percent: Math.max(0, reduction),
  };
}

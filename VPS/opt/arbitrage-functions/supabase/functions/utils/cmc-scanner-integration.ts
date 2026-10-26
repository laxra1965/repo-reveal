/**
 * Arbitrage Scanner - CMC Integration Pattern
 * 
 * This file demonstrates the EXACT pattern to integrate CMC filtering
 * into your existing arbitrage-scanner/index.ts
 * 
 * Key Points:
 * - No changes to execution engine
 * - CMC refresh happens once every 5-10 minutes
 * - Fallback to cached results if CMC API fails
 * - Logging tracks reduction metrics
 */

import { buildCMCFilteredTriangles, type FilteredTrianglesOutput } from './cmc-integration.ts';

// ============================================================================
// STATE MANAGEMENT (add to your scanner)
// ============================================================================

interface CMCFilterState {
  // Last time we refreshed CMC triangles
  lastRefresh: number;
  
  // Cached filtered triangles (used between refreshes)
  cachedTriangles: any[];
  
  // Cached filtered symbols
  cachedFilteredSymbols: Set<string> | null;
  
  // Statistics from last refresh
  lastStats: {
    cmcSymbols: number;
    availablePairs: number;
    trianglesBuilt: number;
    reductionPercent: number;
  } | null;
  
  // Configuration
  refreshIntervalMs: number; // 5-10 minutes
  enabled: boolean;
}

const cmcFilterState: CMCFilterState = {
  lastRefresh: 0,
  cachedTriangles: [],
  cachedFilteredSymbols: null,
  lastStats: null,
  refreshIntervalMs: 5 * 60 * 1000, // 5 minutes
  enabled: !!Deno.env.get('CMC_API_KEY'),
};

// ============================================================================
// MAIN INTEGRATION FUNCTION
// ============================================================================

/**
 * Refresh CMC filtered triangles if needed
 * 
 * Call this ONCE per scan cycle (before evaluating opportunities)
 * Returns triangles ready to feed into your engine
 */
export async function refreshCMCFilter(
  priceMap: Record<string, any>,
  exchange: string
): Promise<{ filteredSymbols: Set<string> | null; triangles: any[]; stats: any; error?: string }> {
  const now = Date.now();
  const timeSinceRefresh = now - cmcFilterState.lastRefresh;

  // Check if refresh is needed
  if (timeSinceRefresh < cmcFilterState.refreshIntervalMs) {
    // Use cached results
    console.log(
      `[CMC Filter] Using cached triangles (${Math.round(timeSinceRefresh / 1000)}s old)`
    );
    return {
      filteredSymbols: cmcFilterState.cachedFilteredSymbols,
      triangles: cmcFilterState.cachedTriangles,
      stats: cmcFilterState.lastStats,
    };
  }

  // Refresh needed
  const cmcApiKey = Deno.env.get('CMC_API_KEY');
  if (!cmcApiKey) {
    console.warn(
      '[CMC Filter] API key not set. Skipping CMC filter. Set CMC_API_KEY environment variable.'
    );
    return {
      filteredSymbols: cmcFilterState.cachedFilteredSymbols,
      triangles: cmcFilterState.cachedTriangles,
      stats: cmcFilterState.lastStats,
      error: 'API_KEY_NOT_SET',
    };
  }

  try {
    console.log('[CMC Filter] Refreshing...');
    const result = await buildCMCFilteredTriangles(priceMap, exchange, {
      cmcApiKey,
      cmcFilterConfig: {
        minMarketCap: 400_000_000,
        maxMarketCap: 3_000_000_000,
        minVolume24h: 50_000_000,
        maxVolume24h: 300_000_000,
        limit: 100,
        cacheDurationMs: 5 * 60 * 1000,
      },
    });

    // Update state
    cmcFilterState.lastRefresh = now;
    cmcFilterState.cachedTriangles = result.triangles;
    cmcFilterState.cachedFilteredSymbols = result.filteredSymbols;
    cmcFilterState.lastStats = result.stats;

    // Log results
    console.log(`[CMC Filter] ✓ Refresh complete`);
    console.log(`  - Filtered symbols: ${result.stats.cmc_symbols}`);
    console.log(`  - Available pairs: ${result.stats.available_pairs}`);
    console.log(`  - Triangles built: ${result.stats.triangles_built}`);
    console.log(`  - Search space reduction: ${result.stats.reduction_percent}%`);

    return {
      filteredSymbols: result.filteredSymbols,
      triangles: result.triangles,
      stats: result.stats,
    };
  } catch (error) {
    console.error('[CMC Filter] Error during refresh:', error);
    
    // Return cached triangles if available
    if (cmcFilterState.cachedTriangles.length > 0) {
      console.warn('[CMC Filter] Returning stale cached triangles');
      return {
        filteredSymbols: cmcFilterState.cachedFilteredSymbols,
        triangles: cmcFilterState.cachedTriangles,
        stats: cmcFilterState.lastStats,
        error: `REFRESH_FAILED: ${error}`,
      };
    }

    // No fallback available
    return {
      filteredSymbols: null,
      triangles: [],
      stats: null,
      error: `CMC_FILTER_FAILED: ${error}`,
    };
  }
}

// ============================================================================
// HOW TO USE IN YOUR SCANNER
// ============================================================================

/**
 * Example integration into arbitrage-scanner/index.ts
 * 
 * Replace your existing opportunity finding with this pattern:
 */

export async function findOpportunitiesWithCMCFilter(
  priceMap: Record<string, any>,
  exchange: string,
  tradeAmount: number,
  evaluateFunction: (
    triangles: any[],
    priceMap: Record<string, any>,
    tradeAmount: number
  ) => Promise<any[]>
): Promise<any[]> {
  // Step 1: Refresh CMC filter (happens only every 5 minutes)
  const { triangles, stats, error } = await refreshCMCFilter(priceMap, exchange);

  if (error) {
    console.warn(`[Scanner] CMC filter warning: ${error}`);
  }

  if (triangles.length === 0) {
    console.warn('[Scanner] No triangles from CMC filter');
    return [];
  }

  console.log(`[Scanner] Evaluating ${triangles.length} CMC-filtered triangles`);

  // Step 2: Feed filtered triangles into your existing evaluation engine
  // This is where your existing profit calculation happens
  const opportunities = await evaluateFunction(triangles, priceMap, tradeAmount);

  console.log(`[Scanner] Found ${opportunities.length} profitable opportunities`);
  if (stats) {
    console.log(`[Scanner] Search space reduction: ${stats.reduction_percent}%`);
  }

  return opportunities;
}

// ============================================================================
// ALTERNATIVE: HYBRID MODE (For gradual rollout)
// ============================================================================

/**
 * Run both CMC-filtered and traditional scan, compare results
 * Useful for validation before full migration
 */
export async function findOpportunitiesHybridMode(
  priceMap: Record<string, any>,
  exchange: string,
  tradeAmount: number,
  traditionalScanFunction: (priceMap: any, exchange: string) => Promise<any[]>,
  evaluateFunction: (triangles: any[], priceMap: any, tradeAmount: number) => Promise<any[]>
): Promise<{ cmcFiltered: any[]; traditional: any[]; comparison: Record<string, any> }> {
  // Approach 1: CMC filtered
  const { triangles: cmcTriangles, stats } = await refreshCMCFilter(priceMap, exchange);
  const cmcOpportunities =
    cmcTriangles.length > 0
      ? await evaluateFunction(cmcTriangles, priceMap, tradeAmount)
      : [];

  // Approach 2: Traditional (existing method)
  const traditionalTriangles = await traditionalScanFunction(priceMap, exchange);
  const traditionalOpportunities = await evaluateFunction(
    traditionalTriangles,
    priceMap,
    tradeAmount
  );

  // Comparison
  const comparison = {
    cmc_triangles_scanned: cmcTriangles.length,
    traditional_triangles_scanned: traditionalTriangles.length,
    cmc_opportunities_found: cmcOpportunities.length,
    traditional_opportunities_found: traditionalOpportunities.length,
    search_space_reduction: stats?.reduction_percent ?? 0,
    cmc_hit_rate:
      cmcTriangles.length > 0
        ? ((cmcOpportunities.length / cmcTriangles.length) * 100).toFixed(2)
        : 'N/A',
    traditional_hit_rate:
      traditionalTriangles.length > 0
        ? ((traditionalOpportunities.length / traditionalTriangles.length) * 100).toFixed(2)
        : 'N/A',
  };

  console.log('[Hybrid] Comparison:', comparison);

  return {
    cmcFiltered: cmcOpportunities,
    traditional: traditionalOpportunities,
    comparison,
  };
}

// ============================================================================
// CONFIGURATION & CONTROL
// ============================================================================

/**
 * Enable/disable CMC filtering
 */
export function setCMCFilterEnabled(enabled: boolean): void {
  cmcFilterState.enabled = enabled;
  console.log(`[CMC Filter] ${enabled ? 'Enabled' : 'Disabled'}`);
}

/**
 * Change refresh interval
 */
export function setCMCRefreshInterval(intervalMs: number): void {
  cmcFilterState.refreshIntervalMs = intervalMs;
  console.log(`[CMC Filter] Refresh interval set to ${intervalMs}ms`);
}

/**
 * Force refresh
 */
export function forceCMCRefresh(): void {
  cmcFilterState.lastRefresh = 0;
  console.log('[CMC Filter] Forced refresh on next cycle');
}

/**
 * Get current state (for monitoring/debugging)
 */
export function getCMCFilterStatus(): Record<string, any> {
  const now = Date.now();
  const timeSinceRefresh = now - cmcFilterState.lastRefresh;

  return {
    enabled: cmcFilterState.enabled,
    apiKeySet: !!Deno.env.get('CMC_API_KEY'),
    lastRefreshMs: timeSinceRefresh,
    cachedTriangles: cmcFilterState.cachedTriangles.length,
    lastStats: cmcFilterState.lastStats,
    nextRefreshInMs: Math.max(0, cmcFilterState.refreshIntervalMs - timeSinceRefresh),
  };
}

// ============================================================================
// LOGGING & METRICS
// ============================================================================

/**
 * Log performance metrics after each scan
 */
export function logCMCMetrics(): void {
  const status = getCMCFilterStatus();

  console.log('═════════════════════════════════════════');
  console.log('   CMC FILTER PERFORMANCE METRICS');
  console.log('═════════════════════════════════════════');
  console.log(`Enabled: ${status.enabled}`);
  console.log(`API Key Set: ${status.apiKeySet}`);
  console.log(`Cached Triangles: ${status.cachedTriangles}`);
  console.log(
    `Last Refresh: ${status.lastRefreshMs}ms ago (refresh in ${status.nextRefreshInMs}ms)`
  );

  if (status.lastStats) {
    console.log(`CMC Symbols: ${status.lastStats.cmcSymbols}`);
    console.log(`Available Pairs: ${status.lastStats.availablePairs}`);
    console.log(`Triangles Built: ${status.lastStats.trianglesBuilt}`);
    console.log(`Search Reduction: ${status.lastStats.reductionPercent}%`);
  }

  console.log('═════════════════════════════════════════');
}

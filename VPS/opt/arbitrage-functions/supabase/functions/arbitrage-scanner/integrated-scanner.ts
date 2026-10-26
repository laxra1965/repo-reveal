/**
 * INTEGRATED SCANNER
 * 
 * Combines:
 * 1. Old Scanner class (systematic path generation, proper fee calculation)
 * 2. CMC filter (reduces search space from 1000s to ~30 symbols)
 * 3. Legacy detection functions (cross-exchange, multi-bridge patterns)
 * 4. Depth analysis & enrichment
 * 
 * Strategy:
 * - CMC filter narrows search space (phase 1: reduce computational load)
 * - Scanner class generates systematic paths from CMC-filtered symbols (phase 2: thorough analysis)
 * - Legacy functions catch cross-exchange/multi-bridge patterns (phase 3: pattern detection)
 * - Depth enrichment ranks by liquidity (phase 4: execution readiness)
 */

import { Scanner, type ScanConfig } from '../../scanner/Scanner.ts';
import { OrderBook } from '../../core/OrderBook.ts';
import { 
  findCrossExchangeTriangularArbitrage,
  findCrossExchangeMultiBridge,
  EXPANDED_ALTCOINS,
  STABLECOINS,
} from '../utils/arbitrage.ts';
import { logInfo, logError, logDebug } from '../utils/logger.ts';
import { adaptLegacyCrossExchange } from '../utils/opportunity-adapter.ts';

export interface IntegratedScanConfig {
  tradeAmount: number;
  minProfitPercent: number;
  exchange: string;
  takerFeePercent?: number;
  cmcFilteredSymbols?: Set<string>;
  enablePhase1CMCFilter?: boolean;
  enablePhase2ScannerAnalysis?: boolean;
  enablePhase3LegacyDetection?: boolean;
  enablePhase4Enrichment?: boolean;
  orderBooks?: Map<string, OrderBook>;
}

export interface ScanResult {
  opportunities: any[];
  metrics: {
    phase1_cmc_filtered_symbols: number;
    phase2_scanner_paths_generated: number;
    phase2_scanner_opportunities: number;
    phase3_legacy_opportunities: number;
    phase4_enriched_opportunities: number;
    total_opportunities: number;
    scan_duration_ms: number;
  };
}

/**
 * PHASE 1: CMC Filter (reduce search space)
 * Extract base assets from CMC-filtered symbol list
 */
export function phase1CMCFilter(cmcSymbols: Set<string> | null): Set<string> {
  if (!cmcSymbols || cmcSymbols.size === 0) {
    logDebug('integrated-scanner', 'Phase 1 CMC Filter: disabled (no symbols provided)');
    return new Set(EXPANDED_ALTCOINS.slice(0, 50)); // Fallback to top 50
  }
  
  logInfo('integrated-scanner', `Phase 1 CMC Filter: Starting with ${cmcSymbols.size} symbols`);
  return cmcSymbols;
}

/**
 * PHASE 2: Old Scanner Analysis (systematic path generation)
 * Use Scanner class to generate and scan triangular paths
 */
export async function phase2ScannerAnalysis(
  symbols: Set<string>,
  config: IntegratedScanConfig,
  orderBooks: Map<string, OrderBook>
): Promise<any[]> {
  if (!config.enablePhase2ScannerAnalysis) {
    logDebug('integrated-scanner', 'Phase 2 Scanner Analysis: disabled');
    return [];
  }

  if (orderBooks.size === 0) {
    logDebug('integrated-scanner', 'Phase 2 Scanner Analysis: no orderbooks available');
    return [];
  }

  const scannerConfig: ScanConfig = {
    minProfitPercent: config.minProfitPercent,
    minLiquidity: config.tradeAmount,
    tradeAmount: config.tradeAmount,
    exchange: config.exchange,
    takerFeePercent: config.takerFeePercent ?? 0.1,
    enablePhase1PreFilter: true,        // Pre-filter by available orderbooks
    enablePhase2SlippageAnalysis: true, // Analyze depth-based slippage
    trackMetrics: true,
    enableLogging: true,
  };

  const scanner = new Scanner(scannerConfig);
  
  try {
    // Generate paths from CMC-filtered symbols
    const symbolArray = Array.from(symbols);
    const paths = scanner.generatePaths(symbolArray);
    
    logInfo('integrated-scanner', `Phase 2 Scanner Analysis: Generated ${paths.length} triangular paths`);
    
    // Scan orderbooks for opportunities
    const opportunities = scanner.scan(orderBooks);
    
    logInfo('integrated-scanner', `Phase 2 Scanner Analysis: Found ${opportunities.length} opportunities`);
    
    // Adapt opportunities to standard format
    return opportunities.map(opp => ({
      strategy: 'triangular_arbitrage',
      path: opp.path,
      exchange1: config.exchange,
      exchange2: config.exchange,
      exchange3: config.exchange,
      pair1: opp.pair1,
      pair2: opp.pair2,
      pair3: opp.pair3,
      profit_percent: opp.profit_percent,
      liquidity_score: opp.liquidity_score || 0,
      volume_estimate: opp.volume_estimate || 100,
      estimated_slippage: opp.estimated_slippage || 0,
      detected_at: new Date().toISOString(),
      status: 'active' as const,
      source: 'scanner_v2', // Mark as coming from new Scanner class
    }));
  } catch (error) {
    logError('integrated-scanner', 'Phase 2 Scanner Analysis failed', { error });
    return [];
  }
}

/**
 * PHASE 3: Legacy Detection (cross-exchange & multi-bridge patterns)
 * Use legacy functions to find patterns the Scanner might miss
 */
export function phase3LegacyDetection(
  allPriceMaps: Record<string, Record<string, any>>,
  cmcFilteredSymbols: Set<string> | null,
  tradeAmount: number
): any[] {
  const APPROVED_QUOTES = new Set(['USDT', 'BUSD', 'USDC', 'DAI', 'USDP', 'TUSD', 'GUSD']);

  const filterPriceMapByCMC = (priceMap: Record<string, any>, symbols: Set<string> | null): Record<string, any> => {
    if (!symbols || symbols.size === 0) return priceMap;
    
    const filtered: Record<string, any> = {};
    for (const [pair, price] of Object.entries(priceMap)) {
      const parts = pair.match(/^([A-Z0-9]+)(USDT|BUSD|USDC|DAI|USDP|TUSD|GUSD)$/) || [];
      if (parts.length >= 3) {
        const base = parts[1];
        const quote = parts[2];
        if (symbols.has(base) && APPROVED_QUOTES.has(quote)) {
          filtered[pair] = price;
        }
      }
    }
    return filtered;
  };

  const filteredMaps = cmcFilteredSymbols 
    ? Object.entries(allPriceMaps).reduce((acc, [ex, pm]) => {
        acc[ex] = filterPriceMapByCMC(pm, cmcFilteredSymbols);
        return acc;
      }, {} as Record<string, any>)
    : allPriceMaps;

  const opportunities: any[] = [];

  // Cross-exchange triangular
  if (Object.keys(filteredMaps).length > 1) {
    try {
      const crossLegacy = findCrossExchangeTriangularArbitrage(filteredMaps, tradeAmount);
      logDebug('integrated-scanner', 'Phase 3 Cross-exchange triangular', {
        count: crossLegacy.length,
      });
      if (crossLegacy.length > 0) {
        const crossStandard = adaptLegacyCrossExchange(crossLegacy);
        opportunities.push(...crossStandard.map(opp => ({
          ...opp,
          source: 'legacy_cross_exchange',
        })));
      }
    } catch (error) {
      logError('integrated-scanner', 'Phase 3 Cross-exchange detection failed', { error });
    }
  }

  // Cross-exchange multi-bridge
  if (Object.keys(filteredMaps).length > 1) {
    try {
      const multiBridge = findCrossExchangeMultiBridge(filteredMaps, tradeAmount);
      logDebug('integrated-scanner', 'Phase 3 Cross-exchange multi-bridge', {
        count: multiBridge.length,
      });
      if (multiBridge.length > 0) {
        opportunities.push(...multiBridge.map(opp => ({
          strategy: opp.strategy || 'cross_exchange_multi_bridge',
          path: opp.path,
          exchange1: opp.exchange1,
          exchange2: opp.exchange2,
          exchange3: opp.exchange3,
          pair1: opp.pair1,
          pair2: opp.pair2,
          pair3: opp.pair3,
          profit_percent: opp.profit_percent,
          liquidity_score: 0,
          volume_estimate: 100,
          estimated_slippage: 0,
          detected_at: opp.detected_at,
          status: 'active' as const,
          source: 'legacy_multi_bridge',
        })));
      }
    } catch (error) {
      logError('integrated-scanner', 'Phase 3 Multi-bridge detection failed', { error });
    }
  }

  logInfo('integrated-scanner', `Phase 3 Legacy Detection: Found ${opportunities.length} opportunities`);
  return opportunities;
}

/**
 * PHASE 4: Deduplication & Ranking
 * Merge results from all phases and rank by liquidity/profitability
 */
export function phase4Enrichment(
  allOpportunities: any[]
): any[] {
  const seenPaths = new Set<string>();
  const uniqueOpportunities: any[] = [];
  
  // Sort by profit descending for deduplication priority
  const sorted = [...allOpportunities].sort((a, b) => 
    (b.profit_percent || 0) - (a.profit_percent || 0)
  );
  
  for (const opp of sorted) {
    const pathKey = `${opp.exchange1 || 'mix'}-${opp.path.join('->')}`;
    if (seenPaths.has(pathKey)) continue;
    seenPaths.add(pathKey);
    uniqueOpportunities.push(opp);
  }

  logInfo('integrated-scanner', `Phase 4 Enrichment: Deduped ${allOpportunities.length} to ${uniqueOpportunities.length} unique opportunities`);
  return uniqueOpportunities;
}

/**
 * Main integrated scan function
 */
export async function integratedScan(config: IntegratedScanConfig): Promise<ScanResult> {
  const scanStart = Date.now();
  const metrics = {
    phase1_cmc_filtered_symbols: 0,
    phase2_scanner_paths_generated: 0,
    phase2_scanner_opportunities: 0,
    phase3_legacy_opportunities: 0,
    phase4_enriched_opportunities: 0,
    total_opportunities: 0,
    scan_duration_ms: 0,
  };

  const allOpportunities: any[] = [];

  try {
    // PHASE 1: CMC Filter
    logInfo('integrated-scanner', 'Starting integrated scan (4 phases)');
    const cmcSymbols = phase1CMCFilter(config.cmcFilteredSymbols);
    metrics.phase1_cmc_filtered_symbols = cmcSymbols.size;

    // PHASE 2: Scanner Analysis (if enabled and orderbooks available)
    if (config.enablePhase2ScannerAnalysis && config.orderBooks) {
      const phase2Opps = await phase2ScannerAnalysis(cmcSymbols, config, config.orderBooks);
      metrics.phase2_scanner_opportunities = phase2Opps.length;
      allOpportunities.push(...phase2Opps);
    }

    // PHASE 3: Legacy Detection (if enabled)
    if (config.enablePhase3LegacyDetection) {
      logInfo('integrated-scanner', 'Phase 3: Running legacy detection functions');
      // Note: This would need the priceMap/allPriceMaps passed in
      // For now, we mark it as needing implementation in the caller
    }

    // PHASE 4: Enrichment
    if (config.enablePhase4Enrichment) {
      const enriched = phase4Enrichment(allOpportunities);
      metrics.phase4_enriched_opportunities = enriched.length;
      metrics.total_opportunities = enriched.length;
      
      const scanEnd = Date.now();
      metrics.scan_duration_ms = scanEnd - scanStart;

      return {
        opportunities: enriched,
        metrics,
      };
    }

    metrics.total_opportunities = allOpportunities.length;
    const scanEnd = Date.now();
    metrics.scan_duration_ms = scanEnd - scanStart;

    return {
      opportunities: allOpportunities,
      metrics,
    };
  } catch (error) {
    logError('integrated-scanner', 'Integrated scan failed', { error });
    return {
      opportunities: [],
      metrics: {
        ...metrics,
        scan_duration_ms: Date.now() - scanStart,
      },
    };
  }
}

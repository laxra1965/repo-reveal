import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { 
  standardizeSymbol, 
  findBNBTriangularArbitrage, 
  findCrossExchangeTriangularArbitrage,
  findSingleExchangeTriangularArbitrage,
  findStablecoinArbitrage,
  findMultiBridgeOpportunities,
  findCrossExchangeMultiBridge,
  EXPANDED_ALTCOINS,
  STABLECOINS
} from '../utils/arbitrage.ts';
import { logInfo, logError, logDebug } from '../utils/logger.ts';
import { adaptLegacyTriangular, adaptLegacyCrossExchange } from '../utils/opportunity-adapter.ts';
import { enqueueStandardOpportunities } from '../utils/opportunity-buffer.ts';
import { orderBookEngine, type DepthAnalysis } from '../utils/order-book-engine.ts';
import { slippagePredictor, type SlippagePrediction } from '../utils/slippage-predictor.ts';
import { enqueueExecution } from '../vps-execution-engine/index.ts';
import { refreshCMCFilter, getCMCFilterStatus, logCMCMetrics } from '../utils/cmc-scanner-integration.ts';
// import { enrichOpportunitiesWithDepth } from '../utils/depth-metrics.ts';

// optional in-memory price cache from websocket service (available when running on a single VPS process)
let priceCache: Map<string, any> | null = null;
let priceCacheTimestamp = 0;
const PRICE_CACHE_TTL = 5000; // 5 seconds

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const wsModule = await import('./../binance-websocket/index.ts');
  priceCache = wsModule.priceData || null;
  console.log('[scanner] WebSocket price cache enabled:', priceCache ? `${priceCache.size} symbols` : 'null');
} catch {
  // not available in serverless environment
  priceCache = null;
  console.log('[scanner] WebSocket price cache not available (serverless environment)');
}

// Get allowed origins from environment or use secure defaults
const getAllowedOrigins = (): string[] => {
  const env = Deno.env.get('ALLOWED_ORIGINS') || '';
  return env.split(',').filter(o => o.trim()) || ['http://localhost:3000', 'http://localhost:5173'];
};

const corsHeaders = {
  'Access-Control-Allow-Origin': getAllowedOrigins()[0], // Use first allowed origin
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
};

const TOP_MOVER_LIMIT = parseInt(Deno.env.get('TOP_MOVER_LIMIT') || '50', 10);

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // VPS Check - Warning only
  if (Deno.env.get('RUNTIME') !== 'vps') {
    console.warn("Running outside VPS (dev mode)");
  }

  try {
    console.log('Running arbitrage scan (one-off REST check)...');
    logInfo('arbitrage-scanner', 'Starting scan');

    // Wait for price cache if it's enabled but empty (warming up)
    if (priceCache && priceCache.size === 0) {
      logInfo('arbitrage-scanner', 'Waiting for price cache to warm up...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    const tradeAmount = parseFloat(Deno.env.get('TRADE_AMOUNT') || '100');
    const TOP_MOVER_LIMIT_OVERRIDE = {
      'bybit': 150, // Increase Bybit limit to find more opportunities
      'gate': 100,
      'mexc': 100,
      'binance': 100
    };

    // Helper: fetch tickers for an exchange and return standardized priceMap,
    // filtered down to top movers (by absolute 24h change %) where available.
    const fetchExchangeTickers = async (name: string): Promise<Record<string, any>> => {
      try {
        const limit = TOP_MOVER_LIMIT_OVERRIDE[name as keyof typeof TOP_MOVER_LIMIT_OVERRIDE] || TOP_MOVER_LIMIT;

        if (name === 'binance') {
          // if an in-memory price cache exists, convert it rather than doing REST
          if (priceCache && priceCache.size > 0) {
            const pm: Record<string, any> = {};
            for (const [symbol, ticker] of priceCache.entries()) {
                const s = standardizeSymbol(symbol);
                if (!s) continue;
                pm[s] = {
                  bidPrice: parseFloat(ticker.b),
                  askPrice: parseFloat(ticker.a)
                };
            }
            return pm;
          }

          // Use 24h ticker so we can compute top movers
          const r = await fetch('https://api.binance.com/api/v3/ticker/24hr');
          if (!r.ok) throw new Error(`Binance fetch failed: ${r.status}`);
          const tickers = await r.json();
          const candidates: { symbol: string; bid: number; ask: number; change: number }[] = [];
          for (const t of tickers) {
            const s = standardizeSymbol(t.symbol);
            if (!s) continue;
            const bid = parseFloat(t.bidPrice || t.lastPrice || '0');
            const ask = parseFloat(t.askPrice || t.lastPrice || '0');
            if (!isFinite(bid) || !isFinite(ask) || bid <= 0 || ask <= 0) continue;
            const change = Math.abs(parseFloat(t.priceChangePercent || '0'));
            candidates.push({ symbol: s, bid, ask, change });
          }
          candidates.sort((a, b) => b.change - a.change);
          const top = limit > 0 ? candidates.slice(0, limit) : candidates;
          const pm: Record<string, any> = {};
          for (const c of top) {
            pm[c.symbol] = { bidPrice: c.bid, askPrice: c.ask };
          }
          return pm;
        }

        if (name === 'bybit') {
          const r = await fetch('https://api.bybit.com/v5/market/tickers?category=spot');
          if (!r.ok) throw new Error(`Bybit fetch failed: ${r.status}`);
          const data = await r.json();
          const candidates: { symbol: string; bid: number; ask: number; change: number }[] = [];
          for (const t of data.result?.list || []) {
            const s = standardizeSymbol(t.symbol);
            if (!s) continue;
            const last = parseFloat(t.lastPrice || t.lastPrice24h || t.last || '0');
            const bid = parseFloat(t.bid1Price || last);
            const ask = parseFloat(t.ask1Price || last);
            if (!isFinite(bid) || !isFinite(ask) || bid <= 0 || ask <= 0) continue;
            const change = Math.abs(parseFloat(t.price24hPcnt || '0'));
            candidates.push({ symbol: s, bid, ask, change });
          }
          candidates.sort((a, b) => b.change - a.change);
          const top = limit > 0 ? candidates.slice(0, limit) : candidates;
          const pm: Record<string, any> = {};
          for (const c of top) {
            pm[c.symbol] = { bidPrice: c.bid, askPrice: c.ask };
          }
          return pm;
        }

        if (name === 'gate') {
          const r = await fetch('https://api.gateio.ws/api/v4/spot/tickers');
          if (!r.ok) throw new Error(`Gate fetch failed: ${r.status}`);
          const tickers = await r.json();
          const candidates: { symbol: string; bid: number; ask: number; change: number }[] = [];
          for (const t of tickers) {
            if (!t.currency_pair) continue;
            let sym = t.currency_pair.replace('_', '').toUpperCase();
            const s = standardizeSymbol(sym);
            if (!s) continue;
            const last = parseFloat(t.last || '0');
            const bid = parseFloat(t.lowest_ask || last); // Gate uses lowest_ask/highest_bid in some payloads
            const ask = parseFloat(t.highest_bid || last);
            const validBid = isFinite(bid) && bid > 0 ? bid : last;
            const validAsk = isFinite(ask) && ask > 0 ? ask : last;
            if (!isFinite(validBid) || !isFinite(validAsk) || validBid <= 0 || validAsk <= 0) continue;
            const change = Math.abs(parseFloat(t.change_percentage || t.change_percent || '0'));
            candidates.push({ symbol: s, bid: validBid, ask: validAsk, change });
          }
          candidates.sort((a, b) => b.change - a.change);
          const top = limit > 0 ? candidates.slice(0, limit) : candidates;
          const pm: Record<string, any> = {};
          for (const c of top) {
            pm[c.symbol] = { bidPrice: c.bid, askPrice: c.ask };
          }
          return pm;
        }

        if (name === 'mexc') {
          const r = await fetch('https://api.mexc.com/api/v3/ticker/24hr');
          if (!r.ok) throw new Error(`MEXC fetch failed: ${r.status}`);
          const tickers = await r.json();
          const candidates: { symbol: string; bid: number; ask: number; change: number }[] = [];
          for (const t of tickers) {
            const s = standardizeSymbol(t.symbol);
            if (!s) continue;
            const bid = parseFloat(t.bidPrice || '0');
            const ask = parseFloat(t.askPrice || '0');
            if (!isFinite(bid) || !isFinite(ask) || bid <= 0 || ask <= 0) continue;
            const change = Math.abs(parseFloat(t.priceChangePercent || '0'));
            candidates.push({ symbol: s, bid, ask, change });
          }
          candidates.sort((a, b) => b.change - a.change);
          const top = limit > 0 ? candidates.slice(0, limit) : candidates;
          const pm: Record<string, any> = {};
          for (const c of top) {
            pm[c.symbol] = { bidPrice: c.bid, askPrice: c.ask };
          }
          return pm;
        }

        if (name === 'kucoin') {
          const r = await fetch('https://api.kucoin.com/api/v1/market/allTickers');
          if (!r.ok) throw new Error(`KuCoin fetch failed: ${r.status}`);
          const data = await r.json();
          const candidates: { symbol: string; bid: number; ask: number; change: number }[] = [];
          for (const t of data.data.ticker || []) {
            const sym = t.symbol?.replace('-', '')?.toUpperCase();
            const s = standardizeSymbol(sym);
            if (!s) continue;
            const last = parseFloat(t.last || '0');
            const bid = parseFloat(t.buy || last);
            const ask = parseFloat(t.sell || last);
            if (!isFinite(bid) || !isFinite(ask) || bid <= 0 || ask <= 0) continue;
            const change = Math.abs(parseFloat(t.changeRate || '0'));
            candidates.push({ symbol: s, bid, ask, change });
          }
          candidates.sort((a, b) => b.change - a.change);
          const top = limit > 0 ? candidates.slice(0, limit) : candidates;
          const pm: Record<string, any> = {};
          for (const c of top) {
            pm[c.symbol] = { bidPrice: c.bid, askPrice: c.ask };
          }
          return pm;
        }

        if (name === 'okx') {
          const r = await fetch('https://www.okx.com/api/v5/market/tickers?instType=SPOT');
          if (!r.ok) throw new Error(`OKX fetch failed: ${r.status}`);
          const data = await r.json();
          const candidates: { symbol: string; bid: number; ask: number; change: number }[] = [];
          for (const t of data.data || []) {
            const sym = t.instId?.replace('-', '')?.toUpperCase();
            const s = standardizeSymbol(sym);
            if (!s) continue;
            const last = parseFloat(t.last || '0');
            const bid = parseFloat(t.bidPx || last);
            const ask = parseFloat(t.askPx || last);
            if (!isFinite(bid) || !isFinite(ask) || bid <= 0 || ask <= 0) continue;
            const change = Math.abs(parseFloat(t.chgPct || t.chgPx || '0'));
            candidates.push({ symbol: s, bid, ask, change });
          }
          candidates.sort((a, b) => b.change - a.change);
          const top = limit > 0 ? candidates.slice(0, limit) : candidates;
          const pm: Record<string, any> = {};
          for (const c of top) {
            pm[c.symbol] = { bidPrice: c.bid, askPrice: c.ask };
          }
          return pm;
        }

        return {};
      } catch (err) {
        console.error(`Error fetching tickers for ${name}:`, err);
        return {};
      }
    };

    const exchanges = ['binance', 'bybit', 'gate', 'mexc', 'kucoin', 'okx'];
    const allOpportunities: any[] = [];
    const allPriceMaps: Record<string, Record<string, any>> = {};

    // Parallelize ticker fetches for all exchanges
    const fetchPromises = exchanges.map(async (ex) => {
      try {
        const pm = await fetchExchangeTickers(ex);
        if (pm && Object.keys(pm).length > 0) {
          return { exchange: ex, priceMap: pm };
        }
      } catch (err) {
        logError('arbitrage-scanner', `Failed to fetch tickers for ${ex}`, { error: err });
      }
      return null;
    });

    const results = await Promise.all(fetchPromises);

    // ============================================================================
    // CMC FILTER INTEGRATION
    // ============================================================================
    const cmcApiKey = Deno.env.get('CMC_API_KEY');
    let cmcFilterEnabled = false;
    let cmcStats: any = null;

    if (cmcApiKey) {
      try {
        logInfo('arbitrage-scanner', 'CMC Filter: Applying CMC-based filtering...');
        // Only filter first exchange for now (can expand to all later)
        const firstResult = results.find(r => r !== null);
        if (firstResult) {
          const { exchange: primaryExchange, priceMap: primaryPriceMap } = firstResult;
          const cmcResult = await refreshCMCFilter(primaryPriceMap, primaryExchange);
          
          if (cmcResult && cmcResult.stats) {
            cmcStats = cmcResult.stats;
            cmcFilterEnabled = true;
            logInfo('arbitrage-scanner', 'CMC Filter Applied', {
              cmc_symbols: cmcStats.cmc_symbols,
              available_pairs: cmcStats.available_pairs,
              triangles_built: cmcStats.triangles_built,
              reduction_percent: cmcStats.reduction_percent,
            });
          }
        }
      } catch (error) {
        logError('arbitrage-scanner', 'CMC Filter initialization failed (non-blocking)', { error });
      }
    } else {
      logDebug('arbitrage-scanner', 'CMC Filter disabled (CMC_API_KEY not set)');
    }
    
    // Process results and sort by exchange priority (Bybit first to maximize its opportunities)
    const sortedResults = results
      .filter(r => r !== null)
      .sort((a, b) => {
        if (a!.exchange === 'bybit') return -1;
        if (b!.exchange === 'bybit') return 1;
        return 0;
      });
    
    for (const result of sortedResults) {
      const { exchange: ex, priceMap: pm } = result!;
      allPriceMaps[ex] = pm;

      // 1. Exchange-token triangular (original detection)
      const legacyOpps = findBNBTriangularArbitrage(pm, tradeAmount, ex);
      logDebug('arbitrage-scanner', 'Exchange token triangular opportunities', {
        exchange: ex,
        raw_count: legacyOpps.length,
      });
      if (legacyOpps.length > 0) {
        const standardOpps = adaptLegacyTriangular(legacyOpps, 'triangular_arbitrage');
        logInfo('arbitrage-scanner', `Found ${standardOpps.length} raw exchange-token triangular on ${ex}`);
        allOpportunities.push(...standardOpps);
      }

      // 2. Single-exchange triangular (NEW - no withdrawal delays)
      const singleExchOpps = findSingleExchangeTriangularArbitrage(pm, tradeAmount, ex);
      logDebug('arbitrage-scanner', 'Single-exchange triangular', {
        exchange: ex,
        count: singleExchOpps.length,
      });
      if (singleExchOpps.length > 0) {
        const singleStandard = adaptLegacyTriangular(singleExchOpps, 'triangular_arbitrage');
        logInfo('arbitrage-scanner', `Found ${singleStandard.length} raw triangular arbitrage on ${ex}`);
        allOpportunities.push(...singleStandard);
      }

      // 3. Stablecoin arbitrage (NEW)
      const stableOpps = findStablecoinArbitrage(pm, tradeAmount, ex);
      logDebug('arbitrage-scanner', 'Stablecoin triangular arbitrage', {
        exchange: ex,
        count: stableOpps.length,
      });
      if (stableOpps.length > 0) {
        const stableStandard = adaptLegacyTriangular(stableOpps, 'triangular_arbitrage');
        logInfo('arbitrage-scanner', `Found ${stableStandard.length} raw stablecoin opportunities on ${ex}`);
        allOpportunities.push(...stableStandard);
      }

      // 4. Multi-bridge discovery (NEW)
      const multiBridgeOpps = findMultiBridgeOpportunities(pm, tradeAmount, ex);
      logDebug('arbitrage-scanner', 'Multi-bridge triangular', {
        exchange: ex,
        count: multiBridgeOpps.length,
      });
      if (multiBridgeOpps.length > 0) {
        const multiBridgeStandard = multiBridgeOpps.map(opp => ({
          strategy: opp.strategy || 'triangular_arbitrage',
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
        }));
        logInfo('arbitrage-scanner', `Found ${multiBridgeStandard.length} raw multi-bridge opportunities on ${ex}`);
        allOpportunities.push(...multiBridgeStandard);
      }
    }

    // cross-exchange triangular opportunities (original multi-exchange detection)
    const crossLegacy = findCrossExchangeTriangularArbitrage(allPriceMaps, tradeAmount);
    logDebug('arbitrage-scanner', 'Cross-exchange opportunities', {
      raw_count: crossLegacy.length,
    });
    if (crossLegacy.length > 0) {
      const crossStandard = adaptLegacyCrossExchange(crossLegacy);
      logInfo('arbitrage-scanner', `Found ${crossStandard.length} raw cross-exchange opportunities`);
      allOpportunities.push(...crossStandard);
    }

    // cross-exchange multi-bridge discovery (NEW - finds more diverse cross-exchange paths)
    if (Object.keys(allPriceMaps).length > 1) {
      const crossMultiBridge = findCrossExchangeMultiBridge(allPriceMaps, tradeAmount);
      logDebug('arbitrage-scanner', 'Cross-exchange multi-bridge', {
        count: crossMultiBridge.length,
      });
      if (crossMultiBridge.length > 0) {
        // Convert to standard format (liquidity_score will be enriched with real data later)
        const crossMultiBridgeStandard = crossMultiBridge.map(opp => ({
          strategy: opp.strategy || 'cross_exchange',
          path: opp.path,
          exchange1: opp.exchange1,
          exchange2: opp.exchange2,
          exchange3: opp.exchange3,
          pair1: opp.pair1,
          pair2: opp.pair2,
          pair3: opp.pair3,
          profit_percent: opp.profit_percent,
          liquidity_score: 0,  // Will be enriched with real order book data
          volume_estimate: 100,
          estimated_slippage: 0,
          detected_at: opp.detected_at,
          status: 'active' as const,
        }));
        logInfo('arbitrage-scanner', `Found ${crossMultiBridgeStandard.length} raw cross-exchange multi-bridge opportunities`);
        allOpportunities.push(...crossMultiBridgeStandard);
      }
    }

    // Deduplicate opportunities by path within this scan tick
    const seenPaths = new Set<string>();
    const uniqueOpportunities: any[] = [];
    
    for (const opp of allOpportunities) {
      const pathKey = `${opp.exchange1 || 'mix'}-${opp.path.join('->')}`;
      if (seenPaths.has(pathKey)) continue;
      seenPaths.add(pathKey);
      
      // Pre-filter: Check if all 3 pairs are in the priceMap for their exchange
      // This prevents enrichment attempts on pairs with zero liquidity
      const exchange = opp.exchange1 || 'binance';
      const pm = allPriceMaps[exchange] || {};
      
      // If any pair is missing from priceMap, skip it (likely illiquid)
      if (!pm[opp.pair1] || !pm[opp.pair2] || !pm[opp.pair3]) {
        logDebug('arbitrage-scanner', 'Skipping opportunity with missing pairs in priceMap', {
          path: opp.path,
          exchange,
          pair1_exists: !!pm[opp.pair1],
          pair2_exists: !!pm[opp.pair2],
          pair3_exists: !!pm[opp.pair3],
        });
        continue;
      }
      
      uniqueOpportunities.push(opp);
    }

    // Sort all opportunities by profit percent before enrichment
    uniqueOpportunities.sort((a, b) => b.profit_percent - a.profit_percent);

    // Enrich top opportunities with real order book depth analysis and slippage predictions
    // Limit to 100 for broader initial check, then we'll filter
    const enrichedOpportunities = await enrichOpportunitiesWithOrderBook(
      uniqueOpportunities.slice(0, 100)
    );

    // Debug: Log which opportunities couldn't be enriched
    const unenrichedCount = uniqueOpportunities.slice(0, 100).length - enrichedOpportunities.length;
    if (unenrichedCount > 0) {
      logDebug('arbitrage-scanner', `${unenrichedCount} opportunities failed enrichment`, {
        reason: 'Likely due to zero-depth pairs',
        suggestion: 'Pairs like ERGBTC, DASHBTC, ETHBTC have zero liquidity on that exchange',
      });
    }

    // Save ONLY the enriched, high-quality opportunities to the database
    if (enrichedOpportunities.length > 0) {
      const highQualityOpps = enrichedOpportunities.filter(opp => 
        opp.depth_available && 
        opp.net_profit > -0.05 &&  // Accept marginal opportunities now
        (opp.slippage_prediction?.recommendation === 'EXECUTE' || 
         opp.slippage_prediction?.recommendation === 'WARN')  // Accept both EXECUTE and WARN
      );
      
      // Debug: log why opportunities are being filtered out
      const filtered = enrichedOpportunities.filter(opp => !(
        opp.depth_available && 
        opp.net_profit > -0.05 && 
        (opp.slippage_prediction?.recommendation === 'EXECUTE' || 
         opp.slippage_prediction?.recommendation === 'WARN')
      ));
      
      if (filtered.length > 0) {
        logDebug('arbitrage-scanner', `Filtered out ${filtered.length} opportunities`, {
          reasons: filtered.map(opp => ({
            path: opp.path,
            depth_available: opp.depth_available,
            net_profit: opp.net_profit,
            recommendation: opp.slippage_prediction?.recommendation,
          })).slice(0, 5), // Show first 5 examples
        });
      }
      
      if (highQualityOpps.length > 0) {
        enqueueStandardOpportunities(highQualityOpps);
        logInfo('arbitrage-scanner', `Buffered ${highQualityOpps.length} high-quality enriched opportunities`);
      }
    }

    // Log CMC metrics if filter was applied
    if (cmcFilterEnabled && cmcStats) {
      logInfo('arbitrage-scanner', 'CMC FILTER METRICS', {
        enabled: cmcFilterEnabled,
        cmc_symbols: cmcStats.cmc_symbols,
        available_pairs: cmcStats.available_pairs,
        triangles_built: cmcStats.triangles_built,
        search_space_reduction: `${cmcStats.reduction_percent}%`,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        opportunities: allOpportunities.length,
        enriched: enrichedOpportunities.length,
        cmc_filter: cmcFilterEnabled ? cmcStats : null,
        data: enrichedOpportunities.filter(opp => 
          opp.depth_available && 
          opp.net_profit > -0.05 && 
          (opp.slippage_prediction?.recommendation === 'EXECUTE' || 
           opp.slippage_prediction?.recommendation === 'WARN')
        ),
        all_enriched: enrichedOpportunities, // Debug: show all enriched (filtered and non-filtered)
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    logError('arbitrage-scanner', 'Error in arbitrage scan', { error });
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
};

/**
 * Enrich opportunities with real order book depth analysis and slippage predictions
 */
async function enrichOpportunitiesWithOrderBook(opportunities: any[]) {
  const enriched: any[] = [];

  for (const opp of opportunities) {
    try {
      // Fetch order books for all 3 legs
      const book1 = await orderBookEngine.fetchOrderBook(
        opp.exchange1 || 'binance',
        opp.pair1 || '',
        true
      );
      const book2 = await orderBookEngine.fetchOrderBook(
        opp.exchange2 || 'binance',
        opp.pair2 || '',
        true
      );
      const book3 = await orderBookEngine.fetchOrderBook(
        opp.exchange3 || 'binance',
        opp.pair3 || '',
        true
      );

      if (!book1 || !book2 || !book3 || 
          book1.bids.length === 0 || book1.asks.length === 0 ||
          book2.bids.length === 0 || book2.asks.length === 0 ||
          book3.bids.length === 0 || book3.asks.length === 0) {
        // Missing or empty order book data, log and skip
        logDebug('arbitrage-scanner', 'Skipping opportunity due to missing order book depth', {
          path: opp.path,
          pair1: { pair: opp.pair1, available: !!book1, bids: book1?.bids.length || 0, asks: book1?.asks.length || 0 },
          pair2: { pair: opp.pair2, available: !!book2, bids: book2?.bids.length || 0, asks: book2?.asks.length || 0 },
          pair3: { pair: opp.pair3, available: !!book3, bids: book3?.bids.length || 0, asks: book3?.asks.length || 0 },
        });
        continue;
      }

      // Analyze depth for each leg
      const depth1 = orderBookEngine.analyzeDepth(book1);
      const depth2 = orderBookEngine.analyzeDepth(book2);
      const depth3 = orderBookEngine.analyzeDepth(book3);

      // Predict slippage for triangular path
      const tradeSize = 100; // Standard trade size

      // REAL DEPTH WALK - Recalculate actual profit based on order book depth
      let currentAmount = tradeSize;
      let depthWalkSuccess = true;

      // Leg 1
      const action1 = opp.pair1.startsWith(opp.path[1]) ? 'BUY' : 'SELL';
      const step1 = orderBookEngine.consumeOrderBook(book1, action1, currentAmount);
      if (!step1) {
        depthWalkSuccess = false;
      } else {
        currentAmount = step1;
        // Leg 2
        const action2 = opp.pair2.startsWith(opp.path[2]) ? 'BUY' : 'SELL';
        const step2 = orderBookEngine.consumeOrderBook(book2, action2, currentAmount);
        if (!step2) {
          depthWalkSuccess = false;
        } else {
          currentAmount = step2;
          // Leg 3
          const action3 = opp.pair3.startsWith(opp.path[3]) ? 'BUY' : 'SELL';
          const step3 = orderBookEngine.consumeOrderBook(book3, action3, currentAmount);
          if (!step3) {
            depthWalkSuccess = false;
          } else {
            currentAmount = step3;
          }
        }
      }

      const realProfitPercent = depthWalkSuccess 
        ? ((currentAmount - tradeSize) / tradeSize) * 100 
        : -1;

      // Noise Filtering: Skip if depth walk failed or profit is invalidly low/negative
      if (!depthWalkSuccess || realProfitPercent < -10) {
        continue;
      }

      const slippagePrediction = slippagePredictor.predictTriangularSlippage(
        [book1, book2, book3],
        tradeSize,
        [depth1, depth2, depth3],
        `${opp.pair1}_${opp.pair2}_${opp.pair3}`
      );

      // FEE CALCULATION: 0.1% per leg = 0.3% total
      const feePct = 0.3;
      const netProfit = realProfitPercent - slippagePrediction.total_slippage_pct - feePct;

      // IMPROVED RECOMMENDATION LOGIC
      let recommendation: 'EXECUTE' | 'WARN' | 'AVOID' = 'AVOID';
      if (netProfit > 0.15) {  // Lowered from 0.2% to 0.15%
        recommendation = 'EXECUTE';
      } else if (netProfit > -0.05) {  // Changed from 0% to -0.05% to catch marginal ones
        recommendation = 'WARN';
      } else {
        recommendation = 'AVOID';
      }

      // Record trades for volatility tracking
      slippagePredictor.recordTrade(
        `${opp.pair1}_${opp.pair2}_${opp.pair3}`,
        book1.asks[0]?.price || 0
      );

      // Calculate composite liquidity score from all 3 legs
      const avgLiquidityIndex = (depth1.liquidityIndex + depth2.liquidityIndex + depth3.liquidityIndex) / 3;
      const minLiquidityIndex = Math.min(depth1.liquidityIndex, depth2.liquidityIndex, depth3.liquidityIndex);
      // Use minimum as the actual bottleneck, but weight average for overall quality
      const compositeLiquidityScore = (minLiquidityIndex * 0.6 + avgLiquidityIndex * 0.4);

      // Calculate average spread across legs
      const avgSpreadBps = (depth1.spread_bps + depth2.spread_bps + depth3.spread_bps) / 3;
      const maxSpreadBps = Math.max(depth1.spread_bps, depth2.spread_bps, depth3.spread_bps);

      // Add enrichment data
      const enrichedOpp = {
        ...opp,
        profit_percent: realProfitPercent, // Use real depth-walk profit!
        net_profit: netProfit,
        execution_safe: depthWalkSuccess && netProfit > 0 && recommendation !== 'AVOID',
        liquidity_score: compositeLiquidityScore,  // Now using real order book data!
        estimated_slippage: avgSpreadBps / 10000,  // Convert bps to percentage
        depth_available: true,
        depth_metrics: {
          leg1: {
            mid_price: depth1.mid_price,
            spread_bps: depth1.spread_bps,
            liquidity_index: depth1.liquidityIndex,
            bid_ask_imbalance: depth1.bid_askImbalance,
          },
          leg2: {
            mid_price: depth2.mid_price,
            spread_bps: depth2.spread_bps,
            liquidity_index: depth2.liquidityIndex,
            bid_ask_imbalance: depth2.bid_askImbalance,
          },
          leg3: {
            mid_price: depth3.mid_price,
            spread_bps: depth3.spread_bps,
            liquidity_index: depth3.liquidityIndex,
            bid_ask_imbalance: depth3.bid_askImbalance,
          },
          average_spread_bps: avgSpreadBps,
          max_spread_bps: maxSpreadBps,
          composite_liquidity_score: compositeLiquidityScore,
        },
        slippage_prediction: {
          total_slippage_bps: slippagePrediction.total_slippage_bps,
          total_slippage_pct: slippagePrediction.total_slippage_pct,
          recommendation: recommendation, // Use our updated recommendation
          confidence: slippagePrediction.leg1.confidence_score, // Use leg1 as proxy
          leg1: {
            slippage_bps: slippagePrediction.leg1.estimated_slippage_bps,
            slippage_pct: slippagePrediction.leg1.estimated_slippage_pct,
            confidence: slippagePrediction.leg1.confidence_score,
          },
          leg2: {
            slippage_bps: slippagePrediction.leg2.estimated_slippage_bps,
            slippage_pct: slippagePrediction.leg2.estimated_slippage_pct,
            confidence: slippagePrediction.leg2.confidence_score,
          },
          leg3: {
            slippage_bps: slippagePrediction.leg3.estimated_slippage_bps,
            slippage_pct: slippagePrediction.leg3.estimated_slippage_pct,
            confidence: slippagePrediction.leg3.confidence_score,
          },
        },
      };

      enriched.push(enrichedOpp);

      // --- EXECUTION ENGINE INTEGRATION ---
      // Automatically enqueue high-quality opportunities for execution
      if (enrichedOpp.execution_safe && enrichedOpp.net_profit >= 0.2 && recommendation === 'EXECUTE') {
        enqueueExecution(enrichedOpp);
      }

      logDebug('arbitrage-scanner', 'Enriched opportunity with depth', {
        pair: opp.pair1,
        net_profit: netProfit,
        recommendation: recommendation,
      });
    } catch (error) {
      logError('arbitrage-scanner', 'Error enriching opportunity', {
        error: error instanceof Error ? error.message : String(error),
        pair1: opp.pair1,
      });
      enriched.push({
        ...opp,
        depth_available: false,
        slippage_prediction: null,
      });
    }
  }

  return enriched;
}

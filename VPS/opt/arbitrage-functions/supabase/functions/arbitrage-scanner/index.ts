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
// Scanner V3: Production-optimized with volatility-weighting, depth-aware, decay-scoring
import ScannerV3, { 
  stratifyPairs, 
  rankOpportunities, 
  enrichOpportunity,
  validateTriangle,
  type PairTier,
  type OpportunityScan
} from './ScannerV3.ts';
// Old Scanner class (V2 integration) - systematic path generation with proper fee calculation
import { Scanner, type ScanConfig } from './Scanner.ts';
import { OrderBook } from './OrderBook.ts';
// import { enrichOpportunitiesWithDepth } from '../utils/depth-metrics.ts';

// optional in-memory price cache from websocket service (available when running on a single VPS process)
let priceCache: Map<string, any> | null = null;
let priceCacheTimestamp = 0;
const PRICE_CACHE_TTL = 5000; // 5 seconds

(async () => {
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
})();

// Scanner version selection
const ENABLE_SCANNER_V3 = Deno.env.get('ENABLE_SCANNER_V3') === 'true';

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
          'bybit': 500, // Increased to get BTC/ETH pairs
          'gate': 500,  // Increased from 150 to get BTC/ETH pairs (not just USDT)
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
          const majorPairData: Record<string, { bid: number; ask: number }> = {};
          let totalPairs = 0;
          let filteredByStandardize = 0;
          let filteredByPrice = 0;
          
          for (const t of data.result?.list || []) {
            totalPairs++;
            
            // Always capture major pairs directly
            if (t.symbol === 'BTCUSDT' || t.symbol === 'ETHUSDT' || t.symbol === 'BNBUSDT') {
              const last = parseFloat(t.lastPrice || t.lastPrice24h || t.last || '0');
              const bid = parseFloat(t.bid1Price || last);
              const ask = parseFloat(t.ask1Price || last);
              if (isFinite(bid) && isFinite(ask) && bid > 0 && ask > 0) {
                majorPairData[t.symbol] = { bid, ask };
              }
            }
            
            const s = standardizeSymbol(t.symbol);
            if (!s) {
              filteredByStandardize++;
              continue;
            }
            const last = parseFloat(t.lastPrice || t.lastPrice24h || t.last || '0');
            const bid = parseFloat(t.bid1Price || last);
            const ask = parseFloat(t.ask1Price || last);
            if (!isFinite(bid) || !isFinite(ask) || bid <= 0 || ask <= 0) {
              filteredByPrice++;
              continue;
            }
            const change = Math.abs(parseFloat(t.price24hPcnt || '0'));
            candidates.push({ symbol: s, bid, ask, change });
          }
          
          logDebug('arbitrage-scanner', 'Bybit pair filtering stats', {
            total_pairs: totalPairs,
            filtered_by_standardize: filteredByStandardize,
            filtered_by_price: filteredByPrice,
            accepted_pairs: candidates.length,
            major_pairs_captured: Object.keys(majorPairData),
            standardize_filter_percent: totalPairs > 0 ? ((filteredByStandardize / totalPairs) * 100).toFixed(1) : 'N/A'
          });
          
          candidates.sort((a, b) => b.change - a.change);
          const top = limit > 0 ? candidates.slice(0, limit) : candidates;
          
          // Add captured major pairs
          for (const [sym, prices] of Object.entries(majorPairData)) {
            if (!top.some(c => c.symbol === sym)) {
              top.push({ symbol: sym, bid: prices.bid, ask: prices.ask, change: 0 });
              logDebug('arbitrage-scanner', `Added major pair ${sym} to Bybit`);
            }
          }
          
          logDebug('arbitrage-scanner', 'Bybit final priceMap', {
            total_pairs: top.length,
            has_btcusdt: top.some(c => c.symbol === 'BTCUSDT'),
            has_ethusdt: top.some(c => c.symbol === 'ETHUSDT')
          });
          
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
          const majorPairData: Record<string, { bid: number; ask: number }> = {};
          let totalPairs = 0;
          let filteredByStandardize = 0;
          let filteredByPrice = 0;
          
          for (const t of tickers) {
            if (!t.currency_pair) continue;
            let sym = t.currency_pair.replace('_', '').toUpperCase();
            totalPairs++;
            
            // Always capture major pairs directly
            if (sym === 'BTCUSDT' || sym === 'ETHUSDT' || sym === 'BNBUSDT') {
              const last = parseFloat(t.last || '0');
              const bid = parseFloat(t.highest_bid || last);
              const ask = parseFloat(t.lowest_ask || last);
              const validBid = isFinite(bid) && bid > 0 ? bid : last;
              const validAsk = isFinite(ask) && ask > 0 ? ask : last;
              if (isFinite(validBid) && isFinite(validAsk) && validBid > 0 && validAsk > 0) {
                majorPairData[sym] = { bid: validBid, ask: validAsk };
              }
            }
            
            const s = standardizeSymbol(sym);
            if (!s) {
              filteredByStandardize++;
              continue;
            }
            const last = parseFloat(t.last || '0');
            const bid = parseFloat(t.highest_bid || last);
            const ask = parseFloat(t.lowest_ask || last);
            const validBid = isFinite(bid) && bid > 0 ? bid : last;
            const validAsk = isFinite(ask) && ask > 0 ? ask : last;
            if (!isFinite(validBid) || !isFinite(validAsk) || validBid <= 0 || validAsk <= 0) {
              filteredByPrice++;
              continue;
            }
            const change = Math.abs(parseFloat(t.change_percentage || t.change_percent || '0'));
            candidates.push({ symbol: s, bid: validBid, ask: validAsk, change });
          }
          
          logDebug('arbitrage-scanner', 'Gate pair filtering stats', {
            total_pairs: totalPairs,
            filtered_by_standardize: filteredByStandardize,
            filtered_by_price: filteredByPrice,
            accepted_pairs: candidates.length,
            major_pairs_captured: Object.keys(majorPairData),
            standardize_filter_percent: totalPairs > 0 ? ((filteredByStandardize / totalPairs) * 100).toFixed(1) : 'N/A'
          });
          
          candidates.sort((a, b) => b.change - a.change);
          const top = limit > 0 ? candidates.slice(0, limit) : candidates;
          
          // Add captured major pairs
          for (const [sym, prices] of Object.entries(majorPairData)) {
            if (!top.some(c => c.symbol === sym)) {
              top.push({ symbol: sym, bid: prices.bid, ask: prices.ask, change: 0 });
              logDebug('arbitrage-scanner', `Added major pair ${sym} to Gate`);
            }
          }
          
          logDebug('arbitrage-scanner', 'Gate final priceMap', {
            total_pairs: top.length,
            has_btcusdt: top.some(c => c.symbol === 'BTCUSDT'),
            has_ethusdt: top.some(c => c.symbol === 'ETHUSDT')
          });
          
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
          logDebug('arbitrage-scanner', `Fetched tickers for ${ex}`, { 
            pair_count: Object.keys(pm).length,
            sample_pairs: Object.keys(pm).slice(0, 5)
          });
          return { exchange: ex, priceMap: pm };
        }
      } catch (err) {
        logError('arbitrage-scanner', `Failed to fetch tickers for ${ex}`, { error: err });
      }
      return null;
    });

    const results = await Promise.all(fetchPromises);
    
    // Debug: Log which exchanges succeeded and which failed
    const successExchanges = results.filter(r => r !== null).map(r => r!.exchange);
    const failedExchanges = exchanges.filter(ex => !successExchanges.includes(ex));
    logInfo('arbitrage-scanner', 'Ticker Fetch Results', {
      success: successExchanges,
      failed: failedExchanges,
      total_exchanges: exchanges.length
    });

    // ============================================================================
    // CMC FILTER INTEGRATION
    // ============================================================================
    const cmcApiKey = Deno.env.get('CMC_API_KEY');
    let cmcFilterEnabled = false;
    let cmcStats: any = null;
    let cmcFilteredSymbols: Set<string> | null = null;

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
            cmcFilteredSymbols = cmcResult.filteredSymbols || null;
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

    // Helper: Filter price map to only include CMC-approved symbols
    // Only filter BASE assets - allow all common stablecoins as quotes
    const APPROVED_QUOTES = new Set(['USDT', 'BUSD', 'USDC', 'DAI', 'USDP', 'TUSD', 'GUSD']);
    const filterPriceMapByCMC = (priceMap: Record<string, any>, symbols: Set<string> | null): Record<string, any> => {
      if (!symbols || symbols.size === 0) return priceMap;
      
      const filtered: Record<string, any> = {};
      for (const [pair, price] of Object.entries(priceMap)) {
        // Extract base and quote from pair (e.g., "BTCUSDT" -> "BTC", "USDT")
        const parts = pair.match(/^([A-Z0-9]+)(USDT|BUSD|USDC|DAI|USDP|TUSD|GUSD)$/) || [];
        if (parts.length >= 3) {
          const base = parts[1];
          const quote = parts[2];
          // Keep pair if: base is in CMC list AND quote is an approved stablecoin
          if (symbols.has(base) && APPROVED_QUOTES.has(quote)) {
            filtered[pair] = price;
          }
        }
      }
      logDebug('arbitrage-scanner', 'CMC Price Map Filter Results', {
        input_pairs: Object.keys(priceMap).length,
        output_pairs: Object.keys(filtered).length,
        filtered_out: Object.keys(priceMap).length - Object.keys(filtered).length,
      });
      return filtered;
    };

    // ============================================================================
    // SCANNER V2 INTEGRATION (Old Scanner + CMC Filter)
    // ============================================================================
    // Use Scanner class for systematic path generation with CMC-filtered symbols
    const enableScannerV2 = Deno.env.get('ENABLE_SCANNER_V2') !== 'false'; // enabled by default
    const scannerV2Opportunities: any[] = [];
    
    if (enableScannerV2 && cmcFilteredSymbols && cmcFilteredSymbols.size > 0) {
      try {
        logInfo('arbitrage-scanner', `[SCANNER V2] Starting systematic analysis with ${cmcFilteredSymbols.size} CMC symbols`);
        
        // Process each exchange with Scanner V2
        for (const result of results.filter(r => r !== null)) {
          const { exchange: ex, priceMap: pm } = result!;
          
          try {
            // Create Scanner instance for this exchange
            const scanConfig: ScanConfig = {
              minProfitPercent: 0.5,  // 0.5% minimum (stricter than legacy)
              minLiquidity: tradeAmount,
              tradeAmount,
              exchange: ex,
              takerFeePercent: 0.1,  // 0.1% per trade
              enablePhase1PreFilter: true,
              enablePhase2SlippageAnalysis: true,
              enableMinLiquidityDepthCheck: false,
              trackMetrics: true,
              enableLogging: false,  // Reduce log noise
            };
            
            const scanner = new Scanner(scanConfig);
            
            // Generate paths from CMC-filtered symbols only
            const symbolArray = Array.from(cmcFilteredSymbols);
            const paths = scanner.generatePaths(symbolArray);
            
            // Build orderbooks from price map (basic version without full depth data)
            const orderBooks = new Map<string, OrderBook>();
            const filteredPriceMap = filterPriceMapByCMC(pm, cmcFilteredSymbols);
            
            for (const [pair, price] of Object.entries(filteredPriceMap)) {
              // Create minimal orderbook for systematic path checking
              // Full depth would require separate REST calls
              const book = new OrderBook(pair);
              
              // Set reasonable bid/ask spread (1% for now)
              const midPrice = (price.bidPrice + price.askPrice) / 2;
              const spread = midPrice * 0.005; // 0.5% spread
              
              // Mock some depth (will be enriched later)
              book.setBids([[price.bidPrice - spread, tradeAmount * 10]]);
              book.setAsks([[price.askPrice + spread, tradeAmount * 10]]);
              
              orderBooks.set(pair, book);
            }
            
            // Scan with Scanner V2
            const scannerOpps = scanner.scan(orderBooks);
            
            if (scannerOpps.length > 0) {
              logInfo('arbitrage-scanner', `[SCANNER V2] Found ${scannerOpps.length} opportunities on ${ex}`);
              
              // Adapt Scanner opportunities to standard format
              const adapted = scannerOpps.map(opp => ({
                strategy: 'triangular_arbitrage_v2',
                path: opp.path || [],
                exchange1: ex,
                exchange2: ex,
                exchange3: ex,
                pair1: opp.pair1 || '',
                pair2: opp.pair2 || '',
                pair3: opp.pair3 || '',
                profit_percent: opp.profit_percent || 0,
                liquidity_score: opp.liquidity_score || 0,
                volume_estimate: opp.volume_estimate || 100,
                estimated_slippage: opp.estimated_slippage || 0,
                detected_at: new Date().toISOString(),
                status: 'active' as const,
                source: 'scanner_v2',
              }));
              
              scannerV2Opportunities.push(...adapted);
            }
          } catch (error) {
            logError('arbitrage-scanner', `[SCANNER V2] Failed for ${ex}`, { error });
          }
        }
        
        logInfo('arbitrage-scanner', `[SCANNER V2] Total: ${scannerV2Opportunities.length} opportunities found`);
      } catch (error) {
        logError('arbitrage-scanner', '[SCANNER V2] Initialization failed (non-blocking)', { error });
      }
    } else {
      if (!enableScannerV2) {
        logDebug('arbitrage-scanner', '[SCANNER V2] Disabled via ENABLE_SCANNER_V2 env var');
      } else if (!cmcFilteredSymbols || cmcFilteredSymbols.size === 0) {
        logDebug('arbitrage-scanner', '[SCANNER V2] Skipped (no CMC symbols available)');
      }
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
      
      // Apply CMC filter to price map if available
      const filteredPriceMap = cmcFilteredSymbols ? filterPriceMapByCMC(pm, cmcFilteredSymbols) : pm;
      const pmForSearch = filteredPriceMap;
      
      allPriceMaps[ex] = pm; // Keep original for cross-exchange

      // 1. Exchange-token triangular (original detection)
      const legacyOpps = findBNBTriangularArbitrage(pmForSearch, tradeAmount, ex);
      logDebug('arbitrage-scanner', 'Exchange token triangular opportunities', {
        exchange: ex,
        raw_count: legacyOpps.length,
        cmc_filtered: cmcFilteredSymbols ? true : false,
      });
      if (legacyOpps.length > 0) {
        const standardOpps = adaptLegacyTriangular(legacyOpps, 'triangular_arbitrage');
        logInfo('arbitrage-scanner', `Found ${standardOpps.length} raw exchange-token triangular on ${ex}`);
        allOpportunities.push(...standardOpps);
      }

      // 2. Single-exchange triangular (NEW - no withdrawal delays)
      const singleExchOpps = findSingleExchangeTriangularArbitrage(pmForSearch, tradeAmount, ex);
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
      const stableOpps = findStablecoinArbitrage(pmForSearch, tradeAmount, ex);
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
      const multiBridgeOpps = findMultiBridgeOpportunities(pmForSearch, tradeAmount, ex);
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

    // ============================================================================
    // INTEGRATE SCANNER V2 OPPORTUNITIES
    // ============================================================================
    if (scannerV2Opportunities.length > 0) {
      logInfo('arbitrage-scanner', `Integrating ${scannerV2Opportunities.length} Scanner V2 opportunities`);
      allOpportunities.push(...scannerV2Opportunities);
    }

    // cross-exchange triangular opportunities (original multi-exchange detection)
    // Apply CMC filter to cross-exchange search if enabled
    const filteredCrossExchangeMaps = cmcFilteredSymbols 
      ? Object.entries(allPriceMaps).reduce((acc, [ex, pm]) => {
          acc[ex] = filterPriceMapByCMC(pm, cmcFilteredSymbols);
          return acc;
        }, {} as Record<string, any>)
      : allPriceMaps;
    
    const crossLegacy = findCrossExchangeTriangularArbitrage(filteredCrossExchangeMaps, tradeAmount);
    logDebug('arbitrage-scanner', 'Cross-exchange opportunities', {
      raw_count: crossLegacy.length,
      cmc_filtered: cmcFilteredSymbols ? true : false,
    });
    if (crossLegacy.length > 0) {
      const crossStandard = adaptLegacyCrossExchange(crossLegacy);
      logInfo('arbitrage-scanner', `Found ${crossStandard.length} raw cross-exchange opportunities`);
      allOpportunities.push(...crossStandard);
    }

    // cross-exchange multi-bridge discovery (NEW - finds more diverse cross-exchange paths)
    if (Object.keys(allPriceMaps).length > 1) {
      const crossMultiBridge = findCrossExchangeMultiBridge(filteredCrossExchangeMaps, tradeAmount);
      logDebug('arbitrage-scanner', 'Cross-exchange multi-bridge', {
        count: crossMultiBridge.length,
        cmc_filtered: cmcFilteredSymbols ? true : false,
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
    
    // Debug: Log Gate and Bybit opportunities before enrichment
    const gateOppsBefore = uniqueOpportunities.filter(o => o.exchange1 === 'gate' || o.exchange2 === 'gate' || o.exchange3 === 'gate');
    const bybitOppsBefore = uniqueOpportunities.filter(o => o.exchange1 === 'bybit' || o.exchange2 === 'bybit' || o.exchange3 === 'bybit');
    
    if (gateOppsBefore.length > 0) {
      logInfo('arbitrage-scanner', `Found ${gateOppsBefore.length} Gate.io opportunities before enrichment`, {
        sample: gateOppsBefore.slice(0, 2).map(o => ({
          path: o.path,
          profit: o.profit_percent,
          pairs: [o.pair1, o.pair2, o.pair3]
        }))
      });
    }
    
    if (bybitOppsBefore.length > 0) {
      logInfo('arbitrage-scanner', `Found ${bybitOppsBefore.length} Bybit opportunities before enrichment`, {
        sample: bybitOppsBefore.slice(0, 2).map(o => ({
          path: o.path,
          profit: o.profit_percent,
          pairs: [o.pair1, o.pair2, o.pair3]
        }))
      });
    }

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
    
    // Debug: Log Gate and Bybit after enrichment
    const gateOppsAfter = enrichedOpportunities.filter(o => o.exchange1 === 'gate' || o.exchange2 === 'gate' || o.exchange3 === 'gate');
    const bybitOppsAfter = enrichedOpportunities.filter(o => o.exchange1 === 'bybit' || o.exchange2 === 'bybit' || o.exchange3 === 'bybit');
    
    if (gateOppsAfter.length > 0) {
      logInfo('arbitrage-scanner', `Gate.io opportunities after enrichment: ${gateOppsAfter.length}`, {
        sample: gateOppsAfter.slice(0, 2).map(o => ({
          path: o.path,
          profit: o.profit_percent,
          net_profit: o.net_profit,
          depth_available: o.depth_available
        }))
      });
    }
    
    if (bybitOppsAfter.length > 0) {
      logInfo('arbitrage-scanner', `Bybit opportunities after enrichment: ${bybitOppsAfter.length}`, {
        sample: bybitOppsAfter.slice(0, 2).map(o => ({
          path: o.path,
          profit: o.profit_percent,
          net_profit: o.net_profit,
          depth_available: o.depth_available
        }))
      });
    }

    // Save ALL enriched opportunities to database, including those with partial depth
    // Filter will happen at execution time or based on execution safety flags
    if (enrichedOpportunities.length > 0) {
      // Accept opportunities with ANY detected profit
      // Slippage estimates for missing depth are VERY conservative (assume 3% per missing leg)
      // So we're lenient and accept anything detected as profitable, even if slippage looks bad
      const highQualityOpps = enrichedOpportunities.filter(opp => {
        // Accept ANY opportunity with detected profit > 0 or depth_available=true
        // The execution engine will validate the actual profitability
        const hasDetectedProfit = opp.profit_percent > 0;
        const hasFullDepth = opp.depth_available === true;
        
        return hasDetectedProfit || hasFullDepth;
      });
      
      // Debug: log why opportunities are being filtered out
      const filtered = enrichedOpportunities.filter(opp => 
        opp.profit_percent <= 0 && opp.depth_available !== true
      );
      
      if (filtered.length > 0) {
        logDebug('arbitrage-scanner', `Filtered out ${filtered.length} opportunities`, {
          note: 'Likely zero profit or no depth data',
          examples: filtered.map(opp => ({
            path: opp.path,
            detected_profit: opp.profit_percent,
            net_profit: opp.net_profit,
            depth_available: opp.depth_available,
          })).slice(0, 3),
        });
      }
      
      if (highQualityOpps.length > 0) {
        // Apply V3 processing if enabled
        let finalOpps = highQualityOpps;
        if (ENABLE_SCANNER_V3) {
          try {
            // Enrich with V3 scoring
            const enrichedV3 = highQualityOpps.map(opp => 
              enrichOpportunity(opp, priceMap || {}, {})
            );
            
            // Rank by composite score (profit + fill probability + freshness + depth)
            const rankedV3 = rankOpportunities(enrichedV3);
            
            logDebug('arbitrage-scanner', 'V3 Scanner Ranking', {
              total: rankedV3.length,
              top_3_scores: rankedV3.slice(0, 3).map((opp: OpportunityScan) => ({
                profit: `${(opp.profitPercent).toFixed(3)}%`,
                fillProbability: (opp.fillProbability).toFixed(3),
                decayScore: (opp.decayScore).toFixed(3),
                depthScore: (opp.depthScore).toFixed(3)
              }))
            });
            
            // Keep V3 enriched data in opportunities
            finalOpps = highQualityOpps.map((opp, idx) => ({
              ...opp,
              _v3_fill_probability: enrichedV3[idx].fillProbability,
              _v3_decay_score: enrichedV3[idx].decayScore,
              _v3_depth_score: enrichedV3[idx].depthScore,
              _v3_spread_stability: enrichedV3[idx].spreadStability,
              _v3_rank: rankedV3.findIndex(r => r.pairs?.join('-') === opp.pairs?.join('-')) || idx
            }));
          } catch (e) {
            logError('arbitrage-scanner', 'V3 enrichment failed', { error: String(e) });
            // Fall back to V2
          }
        }
        
        enqueueStandardOpportunities(finalOpps);
        logInfo('arbitrage-scanner', `Buffered ${finalOpps.length} enriched opportunities (${finalOpps.filter(o => o.depth_available).length} with full depth)${ENABLE_SCANNER_V3 ? ' [V3]' : ''}`);
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
        enriched_with_full_depth: enrichedOpportunities.filter(o => o.depth_available).length,
        cmc_filter: cmcFilterEnabled ? cmcStats : null,
        data: enrichedOpportunities.filter(opp => 
          opp.profit_percent > 0 || opp.depth_available === true
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

      // Check if we have at least SOME depth data (partial depth is OK)
      const hasAnyDepth = (book1 && book1.bids.length > 0 && book1.asks.length > 0) ||
                          (book2 && book2.bids.length > 0 && book2.asks.length > 0) ||
                          (book3 && book3.bids.length > 0 && book3.asks.length > 0);
      
      if (!hasAnyDepth) {
        // NO depth available at all - skip this opportunity
        logDebug('arbitrage-scanner', 'Skipping opportunity due to no order book depth available', {
          path: opp.path,
          pair1: { pair: opp.pair1, available: !!book1, bids: book1?.bids.length || 0, asks: book1?.asks.length || 0 },
          pair2: { pair: opp.pair2, available: !!book2, bids: book2?.bids.length || 0, asks: book2?.asks.length || 0 },
          pair3: { pair: opp.pair3, available: !!book3, bids: book3?.bids.length || 0, asks: book3?.asks.length || 0 },
        });
        continue;
      }

      // Analyze depth for available books, use defaults for empty ones
      const depth1 = book1 && book1.bids.length > 0 && book1.asks.length > 0 
        ? orderBookEngine.analyzeDepth(book1)
        : null;
      const depth2 = book2 && book2.bids.length > 0 && book2.asks.length > 0 
        ? orderBookEngine.analyzeDepth(book2)
        : null;
      const depth3 = book3 && book3.bids.length > 0 && book3.asks.length > 0 
        ? orderBookEngine.analyzeDepth(book3)
        : null;

      // Predict slippage for triangular path (with partial depth tolerance)
      const tradeSize = 100; // Standard trade size

      // REAL DEPTH WALK - Recalculate actual profit based on order book depth
      let currentAmount = tradeSize;
      let depthWalkSuccess = true;
      let depthComplete = depth1 && depth2 && depth3; // Track if we have full depth

      // Leg 1 - try depth walk if depth available
      if (depth1 && book1) {
        const action1 = opp.pair1.startsWith(opp.path[1]) ? 'BUY' : 'SELL';
        const step1 = orderBookEngine.consumeOrderBook(book1, action1, currentAmount);
        if (!step1) {
          depthWalkSuccess = false;
          depthComplete = false;
        } else {
          currentAmount = step1;
        }
      } else {
        // No depth for leg 1, use price-based estimate (no slippage assumed)
        depthComplete = false;
      }

      // Leg 2
      if (depthWalkSuccess && depth2 && book2) {
        const action2 = opp.pair2.startsWith(opp.path[2]) ? 'BUY' : 'SELL';
        const step2 = orderBookEngine.consumeOrderBook(book2, action2, currentAmount);
        if (!step2) {
          depthWalkSuccess = false;
          depthComplete = false;
        } else {
          currentAmount = step2;
        }
      } else if (depthWalkSuccess) {
        depthComplete = false;
      }

      // Leg 3
      if (depthWalkSuccess && depth3 && book3) {
        const action3 = opp.pair3.startsWith(opp.path[3]) ? 'BUY' : 'SELL';
        const step3 = orderBookEngine.consumeOrderBook(book3, action3, currentAmount);
        if (!step3) {
          depthWalkSuccess = false;
          depthComplete = false;
        } else {
          currentAmount = step3;
        }
      } else if (depthWalkSuccess) {
        depthComplete = false;
      }

      // Use depth walk profit ONLY if we have complete depth for all 3 legs
      // Otherwise fall back to original price-based profit to avoid nonsensical values
      let realProfitPercent = opp.profit_percent || 0.01; // Use original as baseline
      if (depthWalkSuccess && depthComplete) {
        // All 3 legs had depth data and walk succeeded - use calculated profit
        realProfitPercent = ((currentAmount - tradeSize) / tradeSize) * 100;
      }
      // If any leg lacked depth, keep using the original price-based profit estimate

      // Predict slippage with fallback for partial depth
      let slippagePrediction;
      try {
        const booksForSlippage = [
          book1 || { bids: [], asks: [], symbol: opp.pair1, exchange: opp.exchange1 },
          book2 || { bids: [], asks: [], symbol: opp.pair2, exchange: opp.exchange2 },
          book3 || { bids: [], asks: [], symbol: opp.pair3, exchange: opp.exchange3 }
        ];
        const depthsForSlippage = [
          depth1 || { liquidityIndex: 0, spread_bps: 50 }, // Assume 50bps spread if no depth
          depth2 || { liquidityIndex: 0, spread_bps: 50 },
          depth3 || { liquidityIndex: 0, spread_bps: 50 }
        ];
        slippagePrediction = slippagePredictor.predictTriangularSlippage(
          booksForSlippage,
          tradeSize,
          depthsForSlippage,
          `${opp.pair1}_${opp.pair2}_${opp.pair3}`
        );
      } catch (e) {
        // Fallback slippage estimation if prediction fails
        slippagePrediction = {
          total_slippage_bps: 100, // Assume 1% slippage if no data
          total_slippage_pct: 1.0,
          leg1: { estimated_slippage_bps: 50, estimated_slippage_pct: 0.5, confidence_score: 0.2 },
          leg2: { estimated_slippage_bps: 50, estimated_slippage_pct: 0.5, confidence_score: 0.2 },
          leg3: { estimated_slippage_bps: 50, estimated_slippage_pct: 0.5, confidence_score: 0.2 },
        };
      }

      // CAP SLIPPAGE for incomplete depth scenarios
      // When a leg is missing depth, slippagePredictor assigns 100% which kills the opportunity
      // Cap it to 3% max per leg as a reasonable conservative estimate for missing data
      if (!depthComplete) {
        const maxSlippagePerLeg = 300; // 3% in basis points
        const cappedLegs = {
          leg1: {
            ...slippagePrediction.leg1,
            estimated_slippage_bps: Math.min(slippagePrediction.leg1?.estimated_slippage_bps || 0, maxSlippagePerLeg),
            estimated_slippage_pct: Math.min(slippagePrediction.leg1?.estimated_slippage_pct || 0, 3.0),
          },
          leg2: {
            ...slippagePrediction.leg2,
            estimated_slippage_bps: Math.min(slippagePrediction.leg2?.estimated_slippage_bps || 0, maxSlippagePerLeg),
            estimated_slippage_pct: Math.min(slippagePrediction.leg2?.estimated_slippage_pct || 0, 3.0),
          },
          leg3: {
            ...slippagePrediction.leg3,
            estimated_slippage_bps: Math.min(slippagePrediction.leg3?.estimated_slippage_bps || 0, maxSlippagePerLeg),
            estimated_slippage_pct: Math.min(slippagePrediction.leg3?.estimated_slippage_pct || 0, 3.0),
          },
        };
        const totalCappedBps = cappedLegs.leg1.estimated_slippage_bps + cappedLegs.leg2.estimated_slippage_bps + cappedLegs.leg3.estimated_slippage_bps;
        const totalCappedPct = totalCappedBps / 10000;
        slippagePrediction = {
          ...slippagePrediction,
          total_slippage_bps: totalCappedBps,
          total_slippage_pct: totalCappedPct,
          leg1: cappedLegs.leg1,
          leg2: cappedLegs.leg2,
          leg3: cappedLegs.leg3,
        };
      }

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

      // Record trades for volatility tracking (with fallback)
      slippagePredictor.recordTrade(
        `${opp.pair1}_${opp.pair2}_${opp.pair3}`,
        book1?.asks[0]?.price || 0
      );

      // Calculate composite liquidity score from available depth data
      const liquidityIndices = [depth1?.liquidityIndex || 0.1, depth2?.liquidityIndex || 0.1, depth3?.liquidityIndex || 0.1];
      const avgLiquidityIndex = liquidityIndices.reduce((a, b) => a + b, 0) / 3;
      const minLiquidityIndex = Math.min(...liquidityIndices);
      // Use minimum as the actual bottleneck, but weight average for overall quality
      const compositeLiquidityScore = (minLiquidityIndex * 0.6 + avgLiquidityIndex * 0.4);

      // Calculate average spread across legs (with fallback)
      const spreads = [
        depth1?.spread_bps || 50, 
        depth2?.spread_bps || 50, 
        depth3?.spread_bps || 50
      ];
      const avgSpreadBps = spreads.reduce((a, b) => a + b, 0) / 3;
      const maxSpreadBps = Math.max(...spreads);

      // Add enrichment data
      const enrichedOpp = {
        ...opp,
        profit_percent: realProfitPercent, // Use real depth-walk profit or price-based fallback
        net_profit: netProfit,
        execution_safe: netProfit > 0 && recommendation !== 'AVOID',
        liquidity_score: compositeLiquidityScore,  // Based on available order book data
        estimated_slippage: avgSpreadBps / 10000,  // Convert bps to percentage
        depth_available: depthComplete, // Flag indicating if all 3 legs have depth data
        depth_metrics: {
          leg1: depth1 ? {
            mid_price: depth1.mid_price,
            spread_bps: depth1.spread_bps,
            liquidity_index: depth1.liquidityIndex,
            bid_ask_imbalance: depth1.bid_askImbalance,
          } : {
            mid_price: 0,
            spread_bps: 50,
            liquidity_index: 0.1,
            bid_ask_imbalance: 0,
            note: 'No depth data available',
          },
          leg2: depth2 ? {
            mid_price: depth2.mid_price,
            spread_bps: depth2.spread_bps,
            liquidity_index: depth2.liquidityIndex,
            bid_ask_imbalance: depth2.bid_askImbalance,
          } : {
            mid_price: 0,
            spread_bps: 50,
            liquidity_index: 0.1,
            bid_ask_imbalance: 0,
            note: 'No depth data available',
          },
          leg3: depth3 ? {
            mid_price: depth3.mid_price,
            spread_bps: depth3.spread_bps,
            liquidity_index: depth3.liquidityIndex,
            bid_ask_imbalance: depth3.bid_askImbalance,
          } : {
            mid_price: 0,
            spread_bps: 50,
            liquidity_index: 0.1,
            bid_ask_imbalance: 0,
            note: 'No depth data available',
          },
          average_spread_bps: avgSpreadBps,
          max_spread_bps: maxSpreadBps,
          composite_liquidity_score: compositeLiquidityScore,
        },
        slippage_prediction: {
          total_slippage_bps: slippagePrediction.total_slippage_bps,
          total_slippage_pct: slippagePrediction.total_slippage_pct,
          recommendation: recommendation,
          confidence: slippagePrediction.leg1?.confidence_score || 0.2,
          leg1: {
            slippage_bps: slippagePrediction.leg1?.estimated_slippage_bps || 50,
            slippage_pct: slippagePrediction.leg1?.estimated_slippage_pct || 0.5,
            confidence: slippagePrediction.leg1?.confidence_score || 0.2,
          },
          leg2: {
            slippage_bps: slippagePrediction.leg2?.estimated_slippage_bps || 50,
            slippage_pct: slippagePrediction.leg2?.estimated_slippage_pct || 0.5,
            confidence: slippagePrediction.leg2?.confidence_score || 0.2,
          },
          leg3: {
            slippage_bps: slippagePrediction.leg3?.estimated_slippage_bps || 50,
            slippage_pct: slippagePrediction.leg3?.estimated_slippage_pct || 0.5,
            confidence: slippagePrediction.leg3?.confidence_score || 0.2,
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

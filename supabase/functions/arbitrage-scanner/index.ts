import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rate limiting configuration
const API_RATE_LIMITS = new Map<string, { requests: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_MINUTE = 30;

// Enhanced API configurations with failover and rate limiting
const API_CONFIG: Record<string, any> = {
  Binance: { 
    type: 'single', 
    url: "https://api.binance.com/api/v3/ticker/bookTicker",
    fallbackUrl: "https://api1.binance.com/api/v3/ticker/bookTicker",
    rateLimit: 1200 // requests per minute
  },
  Bybit: { 
    type: 'single', 
    url: "https://api.bybit.com/v5/market/tickers?category=spot",
    rateLimit: 600
  },
  OKX: { 
    type: 'single', 
    url: "https://www.okx.com/api/v5/market/tickers?instType=SPOT",
    rateLimit: 300
  },
  KuCoin: { 
    type: 'single', 
    url: "https://api.kucoin.com/api/v1/market/allTickers",
    rateLimit: 300
  },
  Gate: { 
    type: 'single', 
    url: "https://api.gateio.ws/api/v4/spot/tickers",
    rateLimit: 300
  },
  MEXC: { 
    type: 'single', 
    url: "https://api.mexc.com/api/v3/ticker/bookTicker",
    rateLimit: 300
  }
};

// Enhanced retry logic with exponential backoff
async function fetchWithRetry(url: string, options: any = {}, maxRetries: number = 3): Promise<any> {
  let lastError: Error;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'User-Agent': 'ArbitrageScanner/2.0',
          'Accept': 'application/json',
          ...options.headers
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < maxRetries - 1) {
        const backoffTime = Math.min(1000 * Math.pow(2, attempt), 5000);
        console.log(`Attempt ${attempt + 1} failed for ${url}, retrying in ${backoffTime}ms:`, error.message);
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }
    }
  }
  
  throw lastError!;
}

// Rate limiting check
function checkRateLimit(exchangeName: string): boolean {
  const now = Date.now();
  const key = exchangeName;
  const limit = API_RATE_LIMITS.get(key);
  
  if (!limit || now > limit.resetTime) {
    API_RATE_LIMITS.set(key, { requests: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (limit.requests >= MAX_REQUESTS_PER_MINUTE) {
    return false;
  }
  
  limit.requests++;
  return true;
}

// Enhanced symbol standardization
function standardizeSymbol(symbol: string, exchangeName: string): string | null {
  if (!symbol) return null;
  
  let s = symbol.toUpperCase().replace(/[-_:\/\s]/g, '');
  
  // Exchange-specific normalization
  switch (exchangeName) {
    case 'Binance':
      // Binance symbols are already in correct format
      break;
    case 'Bybit':
      // Remove PERP suffix for futures
      s = s.replace(/PERP$/, '');
      break;
    case 'OKX':
      // OKX uses - separator
      s = s.replace(/-/g, '');
      break;
    case 'KuCoin':
      // KuCoin uses - separator
      s = s.replace(/-/g, '');
      break;
    case 'Gate':
      // Gate.io uses _ separator
      s = s.replace(/_/g, '');
      break;
  }
  
  // Standardize quote currencies
  if (s.endsWith('USD') && !s.endsWith('USDT') && !s.endsWith('USDC')) {
    s = s.replace('USD', 'USDT');
  }
  
  // Remove duplicate suffixes
  if (s.endsWith('USDTUSDT')) {
    s = s.replace('USDTUSDT', 'USDT');
  }
  
  return s;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(token);

    if (!user) {
      throw new Error('Unauthorized');
    }

    const { action } = await req.json();

    if (action === 'scan') {
      console.log(`Starting enhanced arbitrage scan for user ${user.id}`);
      
      // Get user settings
      const { data: settings } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();

      const enabledExchanges = settings?.enabled_exchanges || ['binance', 'bybit', 'okx'];
      const tradeAmount = settings?.trade_amount || 10;
      const minProfitPercent = settings?.min_profit_percent || 0.0005;
      const maxProfitPercent = settings?.max_profit_percent || 50;

      // Clear expired opportunities first
      await supabase.rpc('cleanup_expired_opportunities');

      // Fetch price data concurrently from all enabled exchanges
      const fetchPromises = enabledExchanges
        .filter(exchange => API_CONFIG[exchange.charAt(0).toUpperCase() + exchange.slice(1)])
        .map(async (exchangeName) => {
          const exchangeKey = exchangeName.charAt(0).toUpperCase() + exchangeName.slice(1);
          const config = API_CONFIG[exchangeKey];
          
          // Check rate limiting
          if (!checkRateLimit(exchangeName)) {
            console.log(`Rate limit exceeded for ${exchangeName}, skipping`);
            return { exchangeName, error: 'Rate limit exceeded' };
          }
          
          try {
            console.log(`Fetching data from ${exchangeName}`);
            const data = await fetchWithRetry(config.url);
            return { exchangeName, data };
          } catch (error) {
            console.error(`Error fetching ${exchangeName}:`, error.message);
            
            // Log error to scanner_logs
            await supabase.from('scanner_logs').insert({
              user_id: user.id,
              log_type: 'error',
              message: `Failed to fetch data from ${exchangeName}`,
              details: { error: error.message }
            });
            
            return { exchangeName, error: error.message };
          }
        });

      const results = await Promise.allSettled(fetchPromises);
      let combinedPriceData: Record<string, any> = {};

      // Process results and normalize data
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value && !result.value.error) {
          const { exchangeName, data } = result.value;
          const normalizedData = normalizeExchangeData(exchangeName, data);
          
          // Merge price data with volume analysis
          Object.entries(normalizedData).forEach(([symbol, priceData]: [string, any]) => {
            if (!combinedPriceData[symbol]) {
              combinedPriceData[symbol] = {};
            }
            
            // Store multiple exchange data for depth analysis
            combinedPriceData[symbol][exchangeName.toLowerCase()] = {
              ...priceData,
              volume: priceData.volume || 0,
              depth: priceData.depth || 1
            };
          });
          
          console.log(`${exchangeName}: Processed ${Object.keys(normalizedData).length} symbols`);
        }
      }

      console.log(`Combined price data for ${Object.keys(combinedPriceData).length} symbols`);

      // Enhanced arbitrage detection with volume and slippage analysis
      const opportunities = findTriangularArbitrageEnhanced(
        combinedPriceData, 
        'USDT', 
        tradeAmount,
        minProfitPercent,
        maxProfitPercent
      );

      console.log(`Found ${opportunities.length} enhanced opportunities`);

      // Save opportunities to database with enhanced data
      let savedCount = 0;
      for (const opportunity of opportunities) {
        try {
          const { error } = await supabase
            .from('arbitrage_opportunities')
            .insert({
              user_id: user.id,
              base_symbol: opportunity.base_symbol,
              quote_symbol: opportunity.quote_symbol,
              intermediate_symbol: opportunity.intermediate_symbol,
              exchange1: opportunity.exchange1,
              exchange2: opportunity.exchange2,
              exchange3: opportunity.exchange3,
              step1_action: opportunity.step1_action,
              step1_price: opportunity.step1_price,
              step1_amount: opportunity.step1_amount,
              step2_action: opportunity.step2_action,
              step2_price: opportunity.step2_price,
              step2_amount: opportunity.step2_amount,
              step3_action: opportunity.step3_action,
              step3_price: opportunity.step3_price,
              step3_amount: opportunity.step3_amount,
              start_amount: opportunity.start_amount,
              end_amount: opportunity.end_amount,
              profit_amount: opportunity.profit_amount,
              profit_percent: opportunity.profit_percent,
              step1_volume: opportunity.step1_volume || 0,
              step2_volume: opportunity.step2_volume || 0,
              step3_volume: opportunity.step3_volume || 0,
              estimated_slippage: opportunity.estimated_slippage || 0,
              liquidity_score: opportunity.liquidity_score || 0
            });
          
          if (!error) {
            savedCount++;
          } else {
            console.error('Error saving opportunity:', error);
          }
        } catch (error) {
          console.error('Exception saving opportunity:', error);
        }
      }

      console.log(`Saved ${savedCount}/${opportunities.length} opportunities to database`);
      
      // Log successful scan
      await supabase.from('scanner_logs').insert({
        user_id: user.id,
        log_type: 'info',
        message: `Enhanced scan completed: ${savedCount} opportunities found and saved`,
        details: { 
          opportunitiesFound: opportunities.length,
          opportunitiesSaved: savedCount,
          exchangesScanned: enabledExchanges.length,
          timestamp: new Date().toISOString()
        }
      });

      return new Response(JSON.stringify({
        success: true,
        opportunities_found: opportunities.length,
        opportunities_saved: savedCount,
        exchanges_scanned: enabledExchanges.length,
        message: `Enhanced scan completed: ${savedCount} opportunities found and saved`
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in enhanced arbitrage scanner:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Enhanced exchange data normalization with volume analysis
function normalizeExchangeData(exchangeName: string, data: any): Record<string, any> {
  const priceMap: Record<string, any> = {};
  
  try {
    const name = exchangeName.charAt(0).toUpperCase() + exchangeName.slice(1);
    
    switch (name) {
      case 'Binance':
        if (Array.isArray(data)) {
          data.forEach((ticker: any) => {
            if (ticker.symbol && ticker.bidPrice && ticker.askPrice) {
              const symbol = standardizeSymbol(ticker.symbol, name);
              if (symbol) {
                priceMap[symbol] = {
                  bidPrice: parseFloat(ticker.bidPrice),
                  askPrice: parseFloat(ticker.askPrice),
                  volume: parseFloat(ticker.bidQty || 0) + parseFloat(ticker.askQty || 0),
                  spread: parseFloat(ticker.askPrice) - parseFloat(ticker.bidPrice)
                };
              }
            }
          });
        }
        break;
        
      case 'Bybit':
        if (data.retCode === 0 && data.result?.list) {
          data.result.list.forEach((ticker: any) => {
            if (ticker.symbol && ticker.bid1Price && ticker.ask1Price) {
              const symbol = standardizeSymbol(ticker.symbol, name);
              if (symbol) {
                priceMap[symbol] = {
                  bidPrice: parseFloat(ticker.bid1Price),
                  askPrice: parseFloat(ticker.ask1Price),
                  volume: parseFloat(ticker.volume24h || 0),
                  spread: parseFloat(ticker.ask1Price) - parseFloat(ticker.bid1Price)
                };
              }
            }
          });
        }
        break;
        
      case 'OKX':
        if (data.code === "0" && Array.isArray(data.data)) {
          data.data.forEach((ticker: any) => {
            if (ticker.instId && ticker.bidPx && ticker.askPx) {
              const symbol = standardizeSymbol(ticker.instId, name);
              if (symbol) {
                priceMap[symbol] = {
                  bidPrice: parseFloat(ticker.bidPx),
                  askPrice: parseFloat(ticker.askPx),
                  volume: parseFloat(ticker.vol24h || 0),
                  spread: parseFloat(ticker.askPx) - parseFloat(ticker.bidPx)
                };
              }
            }
          });
        }
        break;
        
      case 'KuCoin':
        if (data.code === "200000" && data.data?.ticker) {
          data.data.ticker.forEach((ticker: any) => {
            if (ticker.symbol && ticker.buy && ticker.sell) {
              const symbol = standardizeSymbol(ticker.symbol, name);
              if (symbol) {
                priceMap[symbol] = {
                  bidPrice: parseFloat(ticker.buy),
                  askPrice: parseFloat(ticker.sell),
                  volume: parseFloat(ticker.vol || 0),
                  spread: parseFloat(ticker.sell) - parseFloat(ticker.buy)
                };
              }
            }
          });
        }
        break;
        
      case 'Gate':
        if (Array.isArray(data)) {
          data.forEach((ticker: any) => {
            if (ticker.currency_pair && ticker.highest_bid && ticker.lowest_ask) {
              const symbol = standardizeSymbol(ticker.currency_pair, name);
              if (symbol) {
                priceMap[symbol] = {
                  bidPrice: parseFloat(ticker.highest_bid),
                  askPrice: parseFloat(ticker.lowest_ask),
                  volume: parseFloat(ticker.base_volume || 0),
                  spread: parseFloat(ticker.lowest_ask) - parseFloat(ticker.highest_bid)
                };
              }
            }
          });
        }
        break;
        
      case 'MEXC':
        if (Array.isArray(data)) {
          data.forEach((ticker: any) => {
            if (ticker.symbol && ticker.bidPrice && ticker.askPrice) {
              const symbol = standardizeSymbol(ticker.symbol, name);
              if (symbol) {
                priceMap[symbol] = {
                  bidPrice: parseFloat(ticker.bidPrice),
                  askPrice: parseFloat(ticker.askPrice),
                  volume: parseFloat(ticker.bidQty || 0) + parseFloat(ticker.askQty || 0),
                  spread: parseFloat(ticker.askPrice) - parseFloat(ticker.bidPrice)
                };
              }
            }
          });
        }
        break;
    }
    
    console.log(`${name}: Normalized ${Object.keys(priceMap).length} symbols`);
    return priceMap;
  } catch (error) {
    console.error(`Error normalizing ${exchangeName} data:`, error);
    return {};
  }
}

// Enhanced triangular arbitrage finder with volume analysis and slippage estimation
function findTriangularArbitrageEnhanced(
  priceData: Record<string, any>, 
  quoteCurrency: string, 
  tradeAmount: number,
  minProfitPercent: number,
  maxProfitPercent: number
): any[] {
  const opportunities: any[] = [];
  
  // Focus on high-volume, liquid pairs
  const baseCurrencies = [
    'BTC', 'ETH', 'BNB', 'ADA', 'SOL', 'MATIC', 'DOT', 'LINK', 'AVAX', 'UNI',
    'LTC', 'BCH', 'XRP', 'DOGE', 'ATOM', 'NEAR', 'FTM', 'ALGO', 'VET', 'ICP'
  ];
  
  const exchanges = ['binance', 'bybit', 'okx', 'kucoin', 'gate', 'mexc'];
  
  for (const base of baseCurrencies) {
    for (const intermediate of baseCurrencies) {
      if (base === intermediate) continue;
      
      const pair1 = `${base}${quoteCurrency}`;
      const pair2 = `${intermediate}${quoteCurrency}`;
      const pair3 = `${base}${intermediate}`;
      
      // Check if we have price data for all pairs
      if (priceData[pair1] && priceData[pair2] && priceData[pair3]) {
        
        // Find best prices across exchanges
        const best1 = findBestPrice(priceData[pair1], 'buy');  // Buy base with quote
        const best2 = findBestPrice(priceData[pair3], 'sell'); // Sell base for intermediate
        const best3 = findBestPrice(priceData[pair2], 'sell'); // Sell intermediate for quote
        
        if (best1 && best2 && best3) {
          try {
            // Calculate arbitrage path
            const step1Amount = tradeAmount / best1.price;
            const step2Amount = step1Amount * best2.price;
            const step3Amount = step2Amount * best3.price;
            
            const profit = step3Amount - tradeAmount;
            const profitPercent = (profit / tradeAmount) * 100;
            
            // Enhanced filtering with volume and slippage analysis
            if (profit > 0 && 
                profitPercent >= minProfitPercent && 
                profitPercent <= maxProfitPercent) {
              
              // Calculate liquidity score and estimated slippage
              const liquidityScore = calculateLiquidityScore(best1, best2, best3, tradeAmount);
              const estimatedSlippage = calculateSlippage(best1, best2, best3, tradeAmount);
              
              // Only include opportunities with sufficient liquidity
              if (liquidityScore >= 3 && estimatedSlippage < profitPercent * 0.5) {
                opportunities.push({
                  base_symbol: base,
                  intermediate_symbol: intermediate,
                  quote_symbol: quoteCurrency,
                  exchange1: best1.exchange,
                  exchange2: best2.exchange,
                  exchange3: best3.exchange,
                  step1_action: 'BUY',
                  step1_price: best1.price,
                  step1_amount: step1Amount,
                  step2_action: 'SELL',
                  step2_price: best2.price,
                  step2_amount: step1Amount,
                  step3_action: 'SELL',
                  step3_price: best3.price,
                  step3_amount: step2Amount,
                  start_amount: tradeAmount,
                  end_amount: step3Amount,
                  profit_amount: profit,
                  profit_percent: profitPercent,
                  step1_volume: best1.volume,
                  step2_volume: best2.volume,
                  step3_volume: best3.volume,
                  estimated_slippage: estimatedSlippage,
                  liquidity_score: liquidityScore
                });
              }
            }
          } catch (error) {
            console.log(`Error calculating arbitrage for ${base}-${intermediate}:`, error);
          }
        }
      }
    }
  }
  
  // Sort by profit percentage (descending) and return top 20
  return opportunities
    .sort((a, b) => b.profit_percent - a.profit_percent)
    .slice(0, 20);
}

// Find best price across exchanges
function findBestPrice(exchangeData: Record<string, any>, action: 'buy' | 'sell'): any {
  let bestPrice = null;
  let bestExchange = null;
  let bestVolume = 0;
  
  for (const [exchange, data] of Object.entries(exchangeData)) {
    const price = action === 'buy' ? data.askPrice : data.bidPrice;
    const volume = data.volume || 0;
    
    if (price && price > 0) {
      if (!bestPrice || 
          (action === 'buy' && price < bestPrice) || 
          (action === 'sell' && price > bestPrice)) {
        bestPrice = price;
        bestExchange = exchange;
        bestVolume = volume;
      }
    }
  }
  
  return bestPrice ? { 
    price: bestPrice, 
    exchange: bestExchange, 
    volume: bestVolume 
  } : null;
}

// Calculate liquidity score (1-10)
function calculateLiquidityScore(step1: any, step2: any, step3: any, tradeAmount: number): number {
  const volumes = [step1.volume, step2.volume, step3.volume];
  const minVolume = Math.min(...volumes);
  
  if (minVolume > tradeAmount * 100) return 10;
  if (minVolume > tradeAmount * 50) return 8;
  if (minVolume > tradeAmount * 20) return 6;
  if (minVolume > tradeAmount * 10) return 4;
  if (minVolume > tradeAmount * 5) return 3;
  return 1;
}

// Estimate slippage based on volume and trade size
function calculateSlippage(step1: any, step2: any, step3: any, tradeAmount: number): number {
  const slippages = [step1, step2, step3].map(step => {
    const ratio = tradeAmount / Math.max(step.volume, 1);
    return Math.min(ratio * 100, 5); // Cap at 5%
  });
  
  return slippages.reduce((sum, slippage) => sum + slippage, 0);
}
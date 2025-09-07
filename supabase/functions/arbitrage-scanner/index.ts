import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rate limiting configuration
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 20; // Max 20 requests per minute per user
const userRequestCounts = new Map<string, { count: number, resetTime: number }>();

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff

// Exchange API configurations with rate limiting
const API_CONFIG: Record<string, ExchangeConfig> = {
  Binance: { 
    type: 'single', 
    url: 'https://api.binance.com/api/v3/ticker/bookTicker',
    rateLimit: { requests: 10, window: 1000 } // 10 requests per second
  },
  Bybit: { 
    type: 'single', 
    url: 'https://api.bybit.com/v5/market/tickers?category=spot',
    rateLimit: { requests: 5, window: 1000 } // 5 requests per second
  },
  OKX: { 
    type: 'single', 
    url: 'https://www.okx.com/api/v5/market/tickers?instType=SPOT',
    rateLimit: { requests: 20, window: 1000 } // 20 requests per second
  },
  KuCoin: { 
    type: 'single', 
    url: 'https://api.kucoin.com/api/v1/market/allTickers',
    rateLimit: { requests: 3, window: 1000 } // 3 requests per second
  },
  Gate: { 
    type: 'single', 
    url: 'https://api.gateio.ws/api/v4/spot/tickers',
    rateLimit: { requests: 5, window: 1000 } // 5 requests per second
  },
  MEXC: { 
    type: 'single', 
    url: 'https://api.mexc.com/api/v3/ticker/bookTicker',
    rateLimit: { requests: 10, window: 1000 } // 10 requests per second
  }
};

interface ExchangeConfig {
  type: 'single';
  url: string;
  rateLimit: { requests: number; window: number };
}

// Symbol standardization function
const standardizeSymbol = (symbol: string, exchangeName: string): string | null => {
  if (!symbol) return null;
  
  let s = symbol.toUpperCase();
  s = s.replace(/[-_:\/\s]/g, '');
  
  // Exchange-specific symbol standardization
  if (exchangeName === 'Kraken') {
    if (s.startsWith('XBT')) s = s.replace('XBT', 'BTC');
    if (s.startsWith('XDG')) s = s.replace('XDG', 'DOGE');
    if (s.startsWith('XETH')) s = s.replace('XETH', 'ETH');
    if (s.startsWith('XLTC')) s = s.replace('XLTC', 'LTC');
    if (s.endsWith('ZUSD')) s = s.replace('ZUSD', 'USD');
    if (s.endsWith('ZEUR')) s = s.replace('ZEUR', 'EUR');
    if (s.includes('XXBT')) s = s.replace('XXBT', 'BTC');
  } else if (exchangeName === 'Bitfinex') {
    if (s.startsWith('T')) s = s.substring(1);
  }
  
  // Convert USD to USDT for consistency
  if (s.endsWith("USD") && !s.endsWith("USDT") && !s.endsWith("USDC")) {
    s = s.substring(0, s.length - 3) + "USDT";
  }
  
  // Fix double USDT
  if (s.endsWith("USDTUSDT")) s = s.substring(0, s.length - 4);
  
  // Fix EUR pairs
  if (s.endsWith("EURUSDT") && s.length > 7) s = s.replace("EURUSDT", "EUR");
  
  return s;
};

// Enhanced rate limiting function
function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const userLimit = userRequestCounts.get(userId);
  
  if (!userLimit || now >= userLimit.resetTime) {
    userRequestCounts.set(userId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (userLimit.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  
  userLimit.count++;
  return true;
}

// Enhanced retry logic with exponential backoff
async function fetchWithRetry(url: string, headers: Record<string, string>, maxRetries: number = MAX_RETRIES): Promise<Response> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) }); // 10 second timeout
      if (response.ok) return response;
      
      // Don't retry on client errors (4xx)
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`Client error ${response.status}: ${response.statusText}`);
      }
      
      throw new Error(`Server error ${response.status}: ${response.statusText}`);
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < maxRetries) {
        const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
        console.log(`Attempt ${attempt + 1} failed for ${url}, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError!;
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

    // Check rate limiting
    if (!checkRateLimit(user.id)) {
      return new Response(JSON.stringify({ 
        error: 'Rate limit exceeded',
        message: 'Too many requests. Please wait before trying again.'
      }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { action } = await req.json();

    if (action === 'scan') {
      console.log(`Starting arbitrage scan for user ${user.id}`);
      
      // Get user settings with error handling
      let settings;
      try {
        const { data, error } = await supabase
          .from('user_settings')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) throw error;
        settings = data;
      } catch (error) {
        console.error('Error fetching user settings:', error);
        // Use defaults if settings fetch fails
        settings = null;
      }

      const enabledExchanges = settings?.enabled_exchanges || ['binance', 'bybit', 'okx'];
      const tradeAmount = settings?.trade_amount || 10;
      const minProfitPercent = (settings?.min_profit_percent || 0.0005) * 100; // Convert to percentage
      const filterProfitable = settings?.filter_profitable !== undefined ? settings.filter_profitable : true;

      // Clear expired opportunities in background
      EdgeRuntime.waitUntil(
        supabase.rpc('cleanup_expired_opportunities').then(
          () => console.log('Background cleanup completed'),
          (error: any) => console.error('Background cleanup failed:', error)
        )
      );

      // Fetch price data with concurrency and enhanced error handling
      const enabledConfigs = enabledExchanges
        .map(name => ({ 
          name: name.charAt(0).toUpperCase() + name.slice(1), 
          config: API_CONFIG[name.charAt(0).toUpperCase() + name.slice(1)] 
        }))
        .filter(({ config }) => config);

      console.log(`Fetching data from ${enabledConfigs.length} exchanges concurrently`);

      // Enhanced concurrent fetching with better performance
      const fetchPromises = enabledConfigs.map(async ({ name, config }) => {
        const startTime = Date.now();
        try {
          const result = await fetchExchangeData(name, config);
          const fetchTime = Date.now() - startTime;
          console.log(`${name} fetch completed in ${fetchTime}ms`);
          
          if (result.error) throw new Error(result.error);
          return { name, data: result.data, fetchTime };
        } catch (error) {
          console.error(`Failed to fetch ${name}:`, error);
          throw error;
        }
      });

      // Use Promise.allSettled for better error handling with timeout
      const fetchResults = await Promise.allSettled(fetchPromises);

      let allPriceData: Record<string, any> = {};
      let successfulFetches = 0;
      let failedFetches = 0;

      fetchResults.forEach((result, index) => {
        const exchangeName = enabledConfigs[index].name;
        
        if (result.status === 'fulfilled') {
          const normalizedData = normalizeExchangeData(exchangeName, result.value.data);
          Object.assign(allPriceData, normalizedData);
          successfulFetches++;
          console.log(`${exchangeName}: Normalized ${Object.keys(normalizedData).length} symbols`);
        } else {
          failedFetches++;
          console.error(`${exchangeName} failed:`, result.reason);
          
          // Log error to database for monitoring
          EdgeRuntime.waitUntil(
            (async () => {
              try {
                const { error } = await supabase.from('scanner_logs').insert({
                  user_id: user.id,
                  log_type: 'error',
                  message: `Failed to fetch data from ${exchangeName}`,
                  details: { error: result.reason?.message || 'Unknown error' }
                });
                if (error) console.error('Failed to log error:', error);
              } catch (error) {
                console.error('Failed to log error:', error);
              }
            })()
          );
        }
      });

      console.log(`Data fetch completed: ${successfulFetches} successful, ${failedFetches} failed`);
      console.log(`Combined price data for ${Object.keys(allPriceData).length} symbols`);

      if (Object.keys(allPriceData).length === 0) {
        throw new Error('No price data available from any exchange');
      }

      // Find arbitrage opportunities with enhanced algorithm
      const opportunities = findTriangularArbitrage(allPriceData, 'USDT', tradeAmount, minProfitPercent, filterProfitable);

      console.log(`Found ${opportunities.length} opportunities for user ${user.id}`);

      // Save opportunities to database with better error handling
      if (opportunities.length > 0) {
        const opportunityInserts = opportunities.map(opp => ({
          user_id: user.id,
          base_symbol: opp.base_symbol,
          quote_symbol: opp.quote_symbol,
          intermediate_symbol: opp.intermediate_symbol,
          exchange1: opp.exchange1,
          exchange2: opp.exchange2,
          exchange3: opp.exchange3,
          step1_action: opp.step1_action,
          step1_price: opp.step1_price,
          step1_amount: opp.step1_amount,
          step2_action: opp.step2_action,
          step2_price: opp.step2_price,
          step2_amount: opp.step2_amount,
          step3_action: opp.step3_action,
          step3_price: opp.step3_price,
          step3_amount: opp.step3_amount,
          start_amount: opp.start_amount,
          end_amount: opp.end_amount,
          profit_amount: opp.profit_amount,
          profit_percent: opp.profit_percent,
          // Enhanced fields
          step1_volume: opp.step1_volume || 0,
          step2_volume: opp.step2_volume || 0,
          step3_volume: opp.step3_volume || 0,
          estimated_slippage: opp.estimated_slippage || 0,
          liquidity_score: opp.liquidity_score || 50
        }));

        try {
          const { error: insertError } = await supabase
            .from('arbitrage_opportunities')
            .insert(opportunityInserts);

          if (insertError) {
            console.error('Error saving opportunities:', insertError);
            console.error('Database insert failed:', insertError);
            // Don't fail the entire request if database insert fails
          } else {
            console.log(`Successfully saved ${opportunities.length} opportunities to database`);
          }
        } catch (error) {
          console.error('Database insert failed:', error);
          // Don't fail the entire request if database insert fails
        }
      }

      // Log scan results
      EdgeRuntime.waitUntil(
        (async () => {
          try {
            const { error } = await supabase.from('scanner_logs').insert({
              user_id: user.id,
              log_type: 'scan',
              message: `Scan completed: ${opportunities.length} opportunities found`,
              details: { 
                opportunitiesFound: opportunities.length,
                exchangesSuccessful: successfulFetches,
                exchangesFailed: failedFetches,
                totalSymbols: Object.keys(allPriceData).length,
                timestamp: new Date().toISOString()
              }
            });
            if (error) console.error('Failed to log scan result:', error);
          } catch (error) {
            console.error('Failed to log scan result:', error);
          }
        })()
      );

      return new Response(JSON.stringify({
        success: true,
        opportunities_count: opportunities.length,
        exchanges_successful: successfulFetches,
        exchanges_failed: failedFetches,
        total_symbols: Object.keys(allPriceData).length,
        message: `Scan completed: ${opportunities.length} opportunities found`
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in arbitrage scanner:', error);
    
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Enhanced fetch function with retry logic and rate limiting
async function fetchExchangeData(exchangeName: string, config: ExchangeConfig): Promise<any> {
  try {
    console.log(`Fetching data from ${exchangeName}`);
    
    const headers = {
      'User-Agent': 'ArbitrageScanner/2.0',
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    };

    if (config.type === 'single') {
      const response = await fetchWithRetry(config.url!, headers);
      
      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.statusText} (${response.status})`);
      }
      
      const data = await response.json();
      return { exchangeName, data };
    }
    
    throw new Error(`Unsupported exchange type: ${config.type} for ${exchangeName}`);
  } catch (error) {
    console.error(`Error fetching ${exchangeName}:`, error);
    return { exchangeName, error: error.message };
  }
}

function normalizeExchangeData(exchange: string, data: any): Record<string, any> {
  const priceMap: Record<string, any> = {};
  
  try {
    const exchangeName = exchange.charAt(0).toUpperCase() + exchange.slice(1);
    
    if (exchangeName === 'Binance' && Array.isArray(data)) {
      data.forEach((ticker: any) => {
        if (ticker.symbol && ticker.bidPrice && ticker.askPrice) {
          const standardSymbol = standardizeSymbol(ticker.symbol, exchangeName);
          if (standardSymbol) {
            priceMap[standardSymbol] = {
              bidPrice: parseFloat(ticker.bidPrice),
              askPrice: parseFloat(ticker.askPrice)
            };
          }
        }
      });
    } else if (exchangeName === 'Bybit' && data.retCode === 0 && data.result?.list) {
      data.result.list.forEach((ticker: any) => {
        if (ticker.symbol && ticker.bid1Price && ticker.ask1Price) {
          const standardSymbol = standardizeSymbol(ticker.symbol, exchangeName);
          if (standardSymbol) {
            priceMap[standardSymbol] = {
              bidPrice: parseFloat(ticker.bid1Price),
              askPrice: parseFloat(ticker.ask1Price)
            };
          }
        }
      });
    } else if (exchangeName === 'OKX' && data.code === "0" && Array.isArray(data.data)) {
      data.data.forEach((ticker: any) => {
        if (ticker.instId && ticker.bidPx && ticker.askPx) {
          const standardSymbol = standardizeSymbol(ticker.instId, exchangeName);
          if (standardSymbol) {
            priceMap[standardSymbol] = {
              bidPrice: parseFloat(ticker.bidPx),
              askPrice: parseFloat(ticker.askPx)
            };
          }
        }
      });
    } else if (exchangeName === 'KuCoin' && data.code === "200000" && data.data?.ticker) {
      data.data.ticker.forEach((ticker: any) => {
        if (ticker.symbol && ticker.buy && ticker.sell) {
          const standardSymbol = standardizeSymbol(ticker.symbol, exchangeName);
          if (standardSymbol) {
            priceMap[standardSymbol] = {
              bidPrice: parseFloat(ticker.buy),
              askPrice: parseFloat(ticker.sell)
            };
          }
        }
      });
    } else if (exchangeName === 'Gate' && Array.isArray(data)) {
      data.forEach((ticker: any) => {
        if (ticker.currency_pair && ticker.highest_bid && ticker.lowest_ask) {
          const standardSymbol = standardizeSymbol(ticker.currency_pair, exchangeName);
          if (standardSymbol) {
            priceMap[standardSymbol] = {
              bidPrice: parseFloat(ticker.highest_bid),
              askPrice: parseFloat(ticker.lowest_ask)
            };
          }
        }
      });
    } else if (exchangeName === 'MEXC' && Array.isArray(data)) {
      data.forEach((ticker: any) => {
        if (ticker.symbol && ticker.bidPrice && ticker.askPrice) {
          const standardSymbol = standardizeSymbol(ticker.symbol, exchangeName);
          if (standardSymbol) {
            priceMap[standardSymbol] = {
              bidPrice: parseFloat(ticker.bidPrice),
              askPrice: parseFloat(ticker.askPrice)
            };
          }
        }
      });
    }

    console.log(`${exchangeName}: Normalized ${Object.keys(priceMap).length} symbols`);
    return priceMap;
  } catch (error) {
    console.error(`Error normalizing ${exchange} data:`, error);
    return {};
  }
}

// Enhanced triangular arbitrage finder with volume analysis
function findTriangularArbitrage(priceMap: Record<string, any>, quoteCurrency: string, tradeAmount: number, minProfitPercent: number = 0.001, filterProfitable: boolean = true): any[] {
  const opportunities: any[] = [];
  const symbols = Object.keys(priceMap);
  
  // Expanded base currencies for more arbitrage opportunities
  const commonBases = [
    'BTC', 'ETH', 'BNB', 'ADA', 'SOL', 'MATIC', 'DOT', 'LINK', 'AVAX', 'UNI',
    'LTC', 'BCH', 'XRP', 'DOGE', 'SHIB', 'ATOM', 'NEAR', 'FTM', 'ALGO', 'XLM',
    'VET', 'ICP', 'THETA', 'TRX', 'EOS', 'AAVE', 'MKR', 'SNX', 'COMP', 'YFI',
    'SUSHI', 'CRV', '1INCH', 'RUNE', 'CAKE', 'ALPHA', 'BAND', 'KNC', 'ZRX', 'BAL',
    'REN', 'LRC', 'STORJ', 'ANT', 'BNT', 'MLN', 'REP', 'NMR', 'GRT', 'SKL'
  ];
  
  for (const base of commonBases) {
    for (const intermediate of commonBases) {
      if (base === intermediate) continue;
      
      const pair1 = `${base}${quoteCurrency}`; // BTC/USDT
      const pair2 = `${intermediate}${quoteCurrency}`; // ETH/USDT  
      const pair3 = `${base}${intermediate}`; // BTC/ETH
      
      if (priceMap[pair1] && priceMap[pair2] && priceMap[pair3]) {
        // Forward path: USDT -> BTC -> ETH -> USDT
        try {
          const step1Amount = tradeAmount / priceMap[pair1].askPrice; // Buy BTC with USDT
          const step2Amount = step1Amount * priceMap[pair3].bidPrice; // Sell BTC for ETH
          const step3Amount = step2Amount * priceMap[pair2].bidPrice; // Sell ETH for USDT
          
          // Validate all calculated amounts are valid numbers
          if (!isFinite(step1Amount) || !isFinite(step2Amount) || !isFinite(step3Amount) || 
              step1Amount <= 0 || step2Amount <= 0 || step3Amount <= 0) {
            continue;
          }
          
          const profit = step3Amount - tradeAmount;
          const profitPercent = (profit / tradeAmount) * 100;
          
          // Enhanced filtering based on user preference
          if (filterProfitable ? (profit > 0 && profitPercent >= minProfitPercent) : profitPercent >= minProfitPercent) {
            // Calculate liquidity score and estimated slippage
            const avgSpread1 = ((priceMap[pair1].askPrice - priceMap[pair1].bidPrice) / priceMap[pair1].askPrice) * 100;
            const avgSpread2 = ((priceMap[pair2].askPrice - priceMap[pair2].bidPrice) / priceMap[pair2].askPrice) * 100;
            const avgSpread3 = ((priceMap[pair3].askPrice - priceMap[pair3].bidPrice) / priceMap[pair3].askPrice) * 100;
            
            const avgSpread = (avgSpread1 + avgSpread2 + avgSpread3) / 3;
            const liquidityScore = Math.max(10, Math.min(100, 100 - (avgSpread * 10)));
            const estimatedSlippage = avgSpread * 0.5; // Conservative estimate
            
            opportunities.push({
              base_symbol: base,
              intermediate_symbol: intermediate,
              quote_symbol: quoteCurrency,
              exchange1: 'binance',
              exchange2: 'binance', 
              exchange3: 'binance',
              step1_action: 'BUY',
              step1_price: priceMap[pair1].askPrice,
              step1_amount: step1Amount,
              step2_action: 'SELL',
              step2_price: priceMap[pair3].bidPrice,
              step2_amount: step2Amount,
              step3_action: 'SELL',
              step3_price: priceMap[pair2].bidPrice,
              step3_amount: step2Amount,
              start_amount: tradeAmount,
              end_amount: step3Amount,
              profit_amount: profit,
              profit_percent: profitPercent,
              // Enhanced fields
              step1_volume: tradeAmount,
              step2_volume: step1Amount * priceMap[pair1].askPrice,
              step3_volume: step2Amount * priceMap[pair2].bidPrice,
              estimated_slippage: estimatedSlippage,
              liquidity_score: Math.round(liquidityScore)
            });
          }
        } catch (error) {
          console.log(`Error calculating forward path for ${base}-${intermediate}:`, error);
        }
        
        // Reverse path: USDT -> ETH -> BTC -> USDT
        try {
          const step1Amount = tradeAmount / priceMap[pair2].askPrice; // Buy ETH with USDT
          const step2Amount = step1Amount / priceMap[pair3].askPrice; // Buy BTC with ETH
          const step3Amount = step2Amount * priceMap[pair1].bidPrice; // Sell BTC for USDT
          
          // Validate all calculated amounts are valid numbers
          if (!isFinite(step1Amount) || !isFinite(step2Amount) || !isFinite(step3Amount) || 
              step1Amount <= 0 || step2Amount <= 0 || step3Amount <= 0) {
            continue;
          }
          
          const profit = step3Amount - tradeAmount;
          const profitPercent = (profit / tradeAmount) * 100;
          
          // Enhanced filtering based on user preference
          if (filterProfitable ? (profit > 0 && profitPercent >= minProfitPercent) : profitPercent >= minProfitPercent) {
            // Calculate liquidity score and estimated slippage
            const avgSpread1 = ((priceMap[pair2].askPrice - priceMap[pair2].bidPrice) / priceMap[pair2].askPrice) * 100;
            const avgSpread2 = ((priceMap[pair3].askPrice - priceMap[pair3].bidPrice) / priceMap[pair3].askPrice) * 100;
            const avgSpread3 = ((priceMap[pair1].askPrice - priceMap[pair1].bidPrice) / priceMap[pair1].askPrice) * 100;
            
            const avgSpread = (avgSpread1 + avgSpread2 + avgSpread3) / 3;
            const liquidityScore = Math.max(10, Math.min(100, 100 - (avgSpread * 10)));
            const estimatedSlippage = avgSpread * 0.5; // Conservative estimate
            
            opportunities.push({
              base_symbol: base,
              intermediate_symbol: intermediate,
              quote_symbol: quoteCurrency,
              exchange1: 'binance',
              exchange2: 'binance',
              exchange3: 'binance',
              step1_action: 'BUY',
              step1_price: priceMap[pair2].askPrice,
              step1_amount: step1Amount,
              step2_action: 'BUY',
              step2_price: priceMap[pair3].askPrice,
              step2_amount: step2Amount,
              step3_action: 'SELL',
              step3_price: priceMap[pair1].bidPrice,
              step3_amount: step3Amount,
              start_amount: tradeAmount,
              end_amount: step3Amount,
              profit_amount: profit,
              profit_percent: profitPercent,
              // Enhanced fields
              step1_volume: tradeAmount,
              step2_volume: step1Amount * priceMap[pair2].askPrice,
              step3_volume: step2Amount * priceMap[pair1].bidPrice,
              estimated_slippage: estimatedSlippage,
              liquidity_score: Math.round(liquidityScore)
            });
          }
        } catch (error) {
          console.log(`Error calculating reverse path for ${base}-${intermediate}:`, error);
        }
      }
    }
  }
  
  // Sort by profit percentage descending and limit results
  return opportunities
    .sort((a, b) => b.profit_percent - a.profit_percent)
    .slice(0, 20); // Limit to top 20 opportunities
}
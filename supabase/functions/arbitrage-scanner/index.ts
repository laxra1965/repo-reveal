import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExchangeConfig {
  type: 'single' | 'multi_step_individual' | 'multi_step_batch';
  url?: string;
  list_url?: string;
  ticker_url_template?: string;
  ticker_url_base?: string;
}

const API_CONFIG: Record<string, ExchangeConfig> = {
  Binance: { type: 'single', url: "https://api.binance.com/api/v3/ticker/bookTicker" },
  Bybit: { type: 'single', url: "https://api.bybit.com/v5/market/tickers?category=spot" },
  OKX: { type: 'single', url: "https://www.okx.com/api/v5/market/tickers?instType=SPOT" },
  Bitget: { type: 'single', url: "https://api.bitget.com/api/v2/spot/market/tickers" },
  MEXC: { type: 'single', url: "https://api.mexc.com/api/v3/ticker/bookTicker" },
  Gate: { type: 'single', url: "https://api.gateio.ws/api/v4/spot/tickers" },
  HTX: { type: 'single', url: "https://api.htx.com/market/tickers" },
  KuCoin: { type: 'single', url: "https://api.kucoin.com/api/v1/market/allTickers" },
  Bitfinex: { type: 'single', url: "https://api-pub.bitfinex.com/v2/tickers?symbols=ALL" },
  BingX: { type: 'single', url: "https://open-api.bingx.com/openApi/spot/v1/market/ticker" },
  Kraken: {
    type: 'multi_step_batch',
    list_url: "https://api.kraken.com/0/public/AssetPairs",
    ticker_url_base: "https://api.kraken.com/0/public/Ticker?pair="
  },
  Coinbase: {
    type: 'multi_step_individual',
    list_url: "https://api.exchange.coinbase.com/products",
    ticker_url_template: "https://api.exchange.coinbase.com/products/{id}/book?level=1"
  }
};

// Symbol standardization function from advanced scanner
const standardizeSymbol = (symbol: string, exchangeName: string): string | null => {
  if (!symbol) return null;
  
  let s = symbol.toUpperCase();
  s = s.replace(/[-_:\/\s]/g, '');
  
  // Exchange-specific symbol standardization
  if (exchangeName === 'Kraken') {
    if (s.startsWith('XBT')) s = s.replace('XBT', 'BTC');
    else if (s.startsWith('XDG')) s = s.replace('XDG', 'DOGE');
    else if (s.startsWith('XETH')) s = s.replace('XETH', 'ETH');
    else if (s.startsWith('XLTC')) s = s.replace('XLTC', 'LTC');
    if (s.endsWith('ZUSD')) s = s.replace('ZUSD', 'USD');
    else if (s.endsWith('ZEUR')) s = s.replace('ZEUR', 'EUR');
    if (s.includes('XXBT')) s = s.replace('XXBT', 'BTC');
  } else if (exchangeName === 'Bitfinex') {
    if (s.startsWith('T')) s = s.substring(1);
  }
  
  // Convert USD to USDT for standardization
  if (s.endsWith("USD") && !s.endsWith("USDT") && !s.endsWith("USDC")) {
    s = s.substring(0, s.length - 3) + "USDT";
  }
  
  // Fix double USDT
  if (s.endsWith("USDTUSDT")) s = s.substring(0, s.length - 4);
  
  // Fix EUR pairs
  if (s.endsWith("EURUSDT") && s.length > 7) s = s.replace("EURUSDT", "EUR");
  
  return s;
};

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

    const { action, exchanges = [] } = await req.json();

    if (action === 'scan') {
      console.log(`Starting arbitrage scan for user ${user.id}`);
      
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

      // Clear expired opportunities
      await supabase.rpc('cleanup_expired_opportunities');

      // Fetch price data from enabled exchanges using improved logic
      let allPriceData: Record<string, any> = {};
      
      for (const exchangeName of enabledExchanges) {
        const config = API_CONFIG[exchangeName.charAt(0).toUpperCase() + exchangeName.slice(1)];
        if (!config) continue;

        try {
          console.log(`Fetching data from ${exchangeName}`);
          const fetchedData = await fetchExchangeData(exchangeName, config);
          
          if (fetchedData && !fetchedData.error) {
            const normalized = normalizeExchangeData(exchangeName, fetchedData.data);
            
            // Merge price data - use best bid/ask prices across exchanges
            for (const [symbol, prices] of Object.entries(normalized)) {
              if (!allPriceData[symbol]) {
                allPriceData[symbol] = prices;
              } else {
                // Use highest bid and lowest ask across exchanges for better arbitrage
                const current = allPriceData[symbol];
                const newPrices = prices as any;
                allPriceData[symbol] = {
                  bidPrice: Math.max(current.bidPrice, newPrices.bidPrice),
                  askPrice: Math.min(current.askPrice, newPrices.askPrice)
                };
              }
            }
          }
        } catch (error) {
          console.error(`Error fetching data from ${exchangeName}:`, error);
          await supabase.from('scanner_logs').insert({
            user_id: user.id,
            log_type: 'error',
            message: `Failed to fetch data from ${exchangeName}`,
            details: { error: error.message }
          });
        }
      }

      console.log(`Combined price data for ${Object.keys(allPriceData).length} symbols`);

      // Find triangular arbitrage opportunities using enhanced algorithm
      const opportunities = findTriangularArbitrage(allPriceData, 'USDT', tradeAmount);

      // Store opportunities in database
      for (const opportunity of opportunities) {
        await supabase.from('arbitrage_opportunities').insert({
          user_id: user.id,
          ...opportunity
        });
      }

      console.log(`Found ${opportunities.length} opportunities for user ${user.id}`);
      
      await supabase.from('scanner_logs').insert({
        user_id: user.id,
        log_type: 'info',
        message: `Scan completed: ${opportunities.length} opportunities found`,
        details: { opportunities_count: opportunities.length }
      });

      return new Response(JSON.stringify({
        success: true,
        opportunities_count: opportunities.length,
        message: 'Scan completed successfully'
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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Enhanced fetch function for different exchange types
async function fetchExchangeData(exchangeName: string, config: ExchangeConfig): Promise<any> {
  try {
    if (config.type === 'single') {
      const response = await fetch(config.url!, {
        headers: {
          'User-Agent': 'ArbitrageScanner/1.0',
          'Accept': 'application/json',
        }
      });
      
      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.statusText} (${response.status})`);
      }
      
      const data = await response.json();
      return { exchangeName, data };
    }
    // Add support for multi-step exchanges if needed
    else {
      console.log(`Multi-step exchanges not yet implemented for ${exchangeName}`);
      return { exchangeName, error: 'Multi-step not implemented' };
    }
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
    } else if (exchangeName === 'HTX' && data.status === 'ok' && Array.isArray(data.data)) {
      data.data.forEach((ticker: any) => {
        if (ticker.symbol && ticker.bid && ticker.ask) {
          const standardSymbol = standardizeSymbol(ticker.symbol, exchangeName);
          if (standardSymbol) {
            priceMap[standardSymbol] = {
              bidPrice: parseFloat(ticker.bid),
              askPrice: parseFloat(ticker.ask)
            };
          }
        }
      });
    } else if (exchangeName === 'Bitget' && data.code === "00000" && Array.isArray(data.data)) {
      data.data.forEach((ticker: any) => {
        if ((ticker.symbolName || ticker.symbol) && ticker.buyOne && ticker.sellOne) {
          const standardSymbol = standardizeSymbol(ticker.symbolName || ticker.symbol, exchangeName);
          if (standardSymbol) {
            priceMap[standardSymbol] = {
              bidPrice: parseFloat(ticker.buyOne),
              askPrice: parseFloat(ticker.sellOne)
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

// Enhanced triangular arbitrage finder
function findTriangularArbitrage(priceMap: Record<string, any>, quoteCurrency: string, tradeAmount: number): any[] {
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
          
          const profit = step3Amount - tradeAmount;
          const profitPercent = (profit / tradeAmount) * 100;
          
          if (profit > 0 && profitPercent > 0.001) { // Minimum 0.001% profit
            opportunities.push({
              base_symbol: base,
              intermediate_symbol: intermediate,
              quote_symbol: quoteCurrency,
              exchange1: 'mixed',
              exchange2: 'mixed', 
              exchange3: 'mixed',
              step1_action: 'BUY',
              step1_price: priceMap[pair1].askPrice,
              step1_amount: step1Amount,
              step2_action: 'SELL',
              step2_price: priceMap[pair3].bidPrice,
              step2_amount: step1Amount,
              step3_action: 'SELL',
              step3_price: priceMap[pair2].bidPrice,
              step3_amount: step2Amount,
              start_amount: tradeAmount,
              end_amount: step3Amount,
              profit_amount: profit,
              profit_percent: profitPercent
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
          
          const profit = step3Amount - tradeAmount;
          const profitPercent = (profit / tradeAmount) * 100;
          
          if (profit > 0 && profitPercent > 0.001) { // Minimum 0.001% profit
            opportunities.push({
              base_symbol: intermediate,
              intermediate_symbol: base,
              quote_symbol: quoteCurrency,
              exchange1: 'mixed',
              exchange2: 'mixed',
              exchange3: 'mixed',
              step1_action: 'BUY',
              step1_price: priceMap[pair2].askPrice,
              step1_amount: step1Amount,
              step2_action: 'BUY',
              step2_price: priceMap[pair3].askPrice,
              step2_amount: step2Amount,
              step3_action: 'SELL',
              step3_price: priceMap[pair1].bidPrice,
              step3_amount: step2Amount,
              start_amount: tradeAmount,
              end_amount: step3Amount,
              profit_amount: profit,
              profit_percent: profitPercent
            });
          }
        } catch (error) {
          console.log(`Error calculating reverse path for ${base}-${intermediate}:`, error);
        }
      }
    }
  }
  
  // Sort by profit percentage and return top 10
  return opportunities
    .sort((a, b) => b.profit_percent - a.profit_percent)
    .slice(0, 10);
}
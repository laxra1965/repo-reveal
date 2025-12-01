import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
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
// Add helper here
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { exchangeName, error: errorMessage };
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
            const key = `${standardSymbol}_${exchangeName.toLowerCase()}`;
            priceMap[key] = {
              symbol: standardSymbol,
              exchange: exchangeName.toLowerCase(),
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
            const key = `${standardSymbol}_${exchangeName.toLowerCase()}`;
            priceMap[key] = {
              symbol: standardSymbol,
              exchange: exchangeName.toLowerCase(),
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
            const key = `${standardSymbol}_${exchangeName.toLowerCase()}`;
            priceMap[key] = {
              symbol: standardSymbol,
              exchange: exchangeName.toLowerCase(),
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
            const key = `${standardSymbol}_${exchangeName.toLowerCase()}`;
            priceMap[key] = {
              symbol: standardSymbol,
              exchange: exchangeName.toLowerCase(),
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
            const key = `${standardSymbol}_${exchangeName.toLowerCase()}`;
            priceMap[key] = {
              symbol: standardSymbol,
              exchange: exchangeName.toLowerCase(),
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
            const key = `${standardSymbol}_${exchangeName.toLowerCase()}`;
            priceMap[key] = {
              symbol: standardSymbol,
              exchange: exchangeName.toLowerCase(),
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

/**
 * Fetch data from all enabled exchanges concurrently
 */
async function fetchAllExchangeData(enabledExchanges: string[]): Promise<Record<string, any>> {
  const exchangeNameMap: Record<string, string> = {
    'binance': 'Binance',
    'bybit': 'Bybit',
    'okx': 'OKX',
    'kucoin': 'KuCoin',
    'gate': 'Gate',
    'mexc': 'MEXC'
  };

  const enabledConfigs = enabledExchanges
    .map(name => {
      const normalizedName = exchangeNameMap[name.toLowerCase()] || name.charAt(0).toUpperCase() + name.slice(1);
      return {
        name: normalizedName,
        config: API_CONFIG[normalizedName]
      };
    })
    .filter(({ config }) => config);

  console.log(`Fetching data from ${enabledConfigs.length} exchanges concurrently`);

  // Fetch all exchanges in parallel
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { name, error: errorMessage };
    }
  });

  const fetchResults = await Promise.allSettled(fetchPromises);

  let allPriceData: Record<string, any> = {};
  let successfulFetches = 0;
  let failedFetches = 0;

  fetchResults.forEach((result, index) => {
    const exchangeName = enabledConfigs[index].name;

    if (result.status === 'fulfilled' && !result.value.error) {
      const normalizedData = normalizeExchangeData(exchangeName, result.value.data);
      Object.assign(allPriceData, normalizedData);
      successfulFetches++;
      console.log(`${exchangeName}: Normalized ${Object.keys(normalizedData).length} symbols`);
    } else {
      failedFetches++;
      console.error(`${exchangeName} failed:`, result.status === 'rejected' ? result.reason : result.value.error);
    }
  });

  console.log(`Data fetch completed: ${successfulFetches} successful, ${failedFetches} failed`);

  if (Object.keys(allPriceData).length === 0) {
    throw new Error('No price data available from any exchange');
  }

  return allPriceData;
}

// Usage example in your handler:
// const exchangeData = await fetchAllExchangeData(['binance', 'bybit', 'okx']);" 

// Enhanced triangular arbitrage finder with volume analysis and short signal detection
function findTriangularArbitrage(priceMap: Record<string, any>, quoteCurrency: string, tradeAmount: number, minProfitPercent: number = 0.001, filterProfitable: boolean = true, customPairs: string[] = [], detectShortSignals: boolean = false): any[] {
  const opportunities: any[] = [];

  // Expanded base currencies for more arbitrage opportunities - focus on high-liquidity pairs
  let commonBases = [
    // Major cryptocurrencies (Tier 1 - Highest liquidity)
    'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'MATIC', 'DOT', 'AVAX',
    'SHIB', 'LTC', 'UNI', 'LINK', 'ATOM', 'TON', 'XLM', 'BCH', 'NEAR', 'TRX',

    // Tier 2 - Good liquidity
    'FTM', 'ALGO', 'ICP', 'THETA', 'EOS', 'AAVE', 'GRT', 'SAND', 'MANA', 'AXS',
    'CRV', 'RUNE', 'CAKE', 'SUSHI', 'COMP', 'YFI', 'MKR', 'SNX', 'FIL', 'VET',

    // Tier 3 - Medium liquidity with arbitrage potential
    'KAVA', 'ZIL', 'ENJ', 'BAT', 'ZRX', 'REN', 'KNC', 'BAND', 'SXP', 'RSR',
    'OGN', 'DENT', 'WIN', 'HOT', 'ANKR', 'COTI', 'CHR', 'MDT', 'STMX', 'DF',

    // Additional high-volume pairs
    'ARB', 'OP', 'IMX', 'APE', 'LDO', 'RNDR', 'INJ', 'PEPE', 'WLD', 'SEI',
    'TIA', 'ORDI', 'STX', 'PYTH', 'JUP', 'BLUR', 'WIF', 'BONK', 'FLOKI', 'GALA'
  ];

  // Add custom pairs from user settings
  if (customPairs && customPairs.length > 0) {
    const validCustomPairs = customPairs
      .map(p => p.toUpperCase().trim())
      .filter(p => p.length > 0 && !commonBases.includes(p));
    commonBases = [...commonBases, ...validCustomPairs];
    console.log(`Added ${validCustomPairs.length} custom pairs to scanning list`);
  }

  // Get list of available exchanges from price data dynamically
  const availableExchanges = Array.from(new Set(
    Object.keys(priceMap)
      .map(key => key.split('_')[1])
      .filter(exchange => exchange)
  ));

  console.log(`Scanning triangular arbitrage across ${commonBases.length} base currencies and ${availableExchanges.length} exchanges: ${availableExchanges.join(', ')}`);

  // Scan for opportunities on each exchange individually (triangular arbitrage within same exchange)
  for (const exchange of availableExchanges) {
    for (const base of commonBases) {
      for (const intermediate of commonBases) {
        if (base === intermediate) continue;

        const pair1Key = `${base}${quoteCurrency}_${exchange}`; // BTC/USDT on exchange
        const pair2Key = `${intermediate}${quoteCurrency}_${exchange}`; // ETH/USDT on exchange
        const pair3Key = `${base}${intermediate}_${exchange}`; // BTC/ETH on exchange

        // Only proceed if all required pairs exist on this exchange
        if (priceMap[pair1Key] && priceMap[pair2Key] && priceMap[pair3Key]) {
          // Forward path: USDT -> BTC -> ETH -> USDT
          try {
            const pair1 = priceMap[pair1Key];
            const pair2 = priceMap[pair2Key];
            const pair3 = priceMap[pair3Key];

            const step1Amount = tradeAmount / pair1.askPrice; // Buy BTC with USDT
            const step2Amount = step1Amount * pair3.bidPrice; // Sell BTC for ETH
            const step3Amount = step2Amount * pair2.bidPrice; // Sell ETH for USDT

            // Validate all calculated amounts are valid numbers and positive
            if (!isFinite(step1Amount) || !isFinite(step2Amount) || !isFinite(step3Amount) ||
                step1Amount <= 0 || step2Amount <= 0 || step3Amount <= 0) {
              continue;
            }

            const profit = step3Amount - tradeAmount;
            const profitPercent = (profit / tradeAmount) * 100;

            // Calculate arbitrage factor (end_amount / start_amount)
            const arbFactor = step3Amount / tradeAmount;

            // Determine signal type based on arb factor
            let signalType = 'arbitrage';
            let overpricedLeg = null;
            let priceDeviation = null;

            if (detectShortSignals) {
              if (arbFactor > 1.001) {
                signalType = 'arbitrage';
              } else if (arbFactor < 0.999) {
                signalType = 'short';
                // Calculate implied fair values and deviations for each leg
                const impliedPrice1 = tradeAmount / step1Amount; // Implied price for step 1
                const impliedPrice2 = step1Amount / step2Amount; // Implied price for step 2
                const impliedPrice3 = step2Amount / step3Amount; // Implied price for step 3

                const deviation1 = ((pair1.askPrice - impliedPrice1) / impliedPrice1) * 100;
                const deviation2 = ((pair3.bidPrice - impliedPrice2) / impliedPrice2) * 100;
                const deviation3 = ((pair2.bidPrice - impliedPrice3) / impliedPrice3) * 100;

                // Find the most overpriced leg (highest positive deviation)
                const deviations = [
                  { leg: `${base}${quoteCurrency}`, deviation: deviation1, price: pair1.askPrice },
                  { leg: `${base}${intermediate}`, deviation: deviation2, price: pair3.bidPrice },
                  { leg: `${intermediate}${quoteCurrency}`, deviation: deviation3, price: pair2.bidPrice }
                ];

                const maxDeviation = deviations.reduce((max, curr) =>
                  curr.deviation > max.deviation ? curr : max
                );

                overpricedLeg = maxDeviation.leg;
                priceDeviation = maxDeviation.deviation;
              } else {
                signalType = 'none';
              }
            }

            // Enhanced filtering based on user preference and signal type
            const shouldInclude = filterProfitable ?
              ((profitPercent > 0 && Math.abs(profitPercent) >= minProfitPercent) || (detectShortSignals && signalType === 'short' && Math.abs(profitPercent) >= minProfitPercent)) :
              (detectShortSignals ? (signalType !== 'none' && Math.abs(profitPercent) >= minProfitPercent) : Math.abs(profitPercent) >= minProfitPercent);

            if (shouldInclude) {
              // Calculate liquidity score and estimated slippage
              const avgSpread1 = ((pair1.askPrice - pair1.bidPrice) / pair1.askPrice) * 100;
              const avgSpread2 = ((pair2.askPrice - pair2.bidPrice) / pair2.askPrice) * 100;
              const avgSpread3 = ((pair3.askPrice - pair3.bidPrice) / pair3.askPrice) * 100;

              const avgSpread = (avgSpread1 + avgSpread2 + avgSpread3) / 3;
              const liquidityScore = Math.max(10, Math.min(100, 100 - (avgSpread * 10)));
              const estimatedSlippage = avgSpread * 0.5; // Conservative estimate

              // Create human-readable trading path
              const tradingPath = `[${exchange.toUpperCase()}] ${quoteCurrency} → ${base} → ${intermediate} → ${quoteCurrency}`;

              opportunities.push({
                base_symbol: base,
                intermediate_symbol: intermediate,
                quote_symbol: quoteCurrency,
                exchange1: exchange,
                exchange2: exchange,
                exchange3: exchange,
                step1_action: `BUY ${base}${quoteCurrency}`,
                step1_price: pair1.askPrice,
                step1_amount: step1Amount,
                step2_action: `SELL ${base}${intermediate}`,
                step2_price: pair3.bidPrice,
                step2_amount: step2Amount,
                step3_action: `SELL ${intermediate}${quoteCurrency}`,
                step3_price: pair2.bidPrice,
                step3_amount: step3Amount,
                start_amount: tradeAmount,
                end_amount: step3Amount,
                profit_amount: profit,
                profit_percent: profitPercent,
                // Enhanced fields
                step1_volume: tradeAmount,
                step2_volume: step1Amount * pair1.askPrice,
                step3_volume: step2Amount * pair2.bidPrice,
                estimated_slippage: estimatedSlippage,
                liquidity_score: Math.round(liquidityScore),
                // Short signal fields
                signal_type: signalType,
                arb_factor: arbFactor,
                overpriced_leg: overpricedLeg,
                price_deviation: priceDeviation
              });

              console.log(`Found opportunity: ${tradingPath} | Profit: ${profitPercent.toFixed(4)}%`);
            }
          } catch (error) {
            // Silently continue on calculation errors
          }

          // Reverse path: USDT -> ETH -> BTC -> USDT
          try {
            const pair1 = priceMap[pair1Key];
            const pair2 = priceMap[pair2Key];
            const pair3 = priceMap[pair3Key];

            const step1Amount = tradeAmount / pair2.askPrice; // Buy ETH with USDT
            const step2Amount = step1Amount / pair3.askPrice; // Buy BTC with ETH
            const step3Amount = step2Amount * pair1.bidPrice; // Sell BTC for USDT

            // Validate all calculated amounts are valid numbers
            if (!isFinite(step1Amount) || !isFinite(step2Amount) || !isFinite(step3Amount) ||
                step1Amount <= 0 || step2Amount <= 0 || step3Amount <= 0) {
              continue;
            }

            const profit = step3Amount - tradeAmount;
            const profitPercent = (profit / tradeAmount) * 100;

            // Calculate arbitrage factor
            const arbFactor = step3Amount / tradeAmount;

            // Determine signal type for reverse path
            let signalType = 'arbitrage';
            let overpricedLeg = null;
            let priceDeviation = null;

            if (detectShortSignals) {
              if (arbFactor > 1.001) {
                signalType = 'arbitrage';
              } else if (arbFactor < 0.999) {
                signalType = 'short';
                const impliedPrice1 = tradeAmount / step1Amount;
                const impliedPrice2 = step1Amount / step2Amount;
                const impliedPrice3 = step2Amount / step3Amount;

                const deviation1 = ((pair2.askPrice - impliedPrice1) / impliedPrice1) * 100;
                const deviation2 = ((pair3.askPrice - impliedPrice2) / impliedPrice2) * 100;
                const deviation3 = ((pair1.bidPrice - impliedPrice3) / impliedPrice3) * 100;

                const deviations = [
                  { leg: `${intermediate}${quoteCurrency}`, deviation: deviation1, price: pair2.askPrice },
                  { leg: `${base}${intermediate}`, deviation: deviation2, price: pair3.askPrice },
                  { leg: `${base}${quoteCurrency}`, deviation: deviation3, price: pair1.bidPrice }
                ];

                const maxDeviation = deviations.reduce((max, curr) =>
                  curr.deviation > max.deviation ? curr : max
                );

                overpricedLeg = maxDeviation.leg;
                priceDeviation = maxDeviation.deviation;
              } else {
                signalType = 'none';
              }
            }

            // Enhanced filtering
            const shouldInclude = filterProfitable ?
              (profitPercent > 0 && Math.abs(profitPercent) >= minProfitPercent) :
              (detectShortSignals ? (signalType !== 'none' && Math.abs(profitPercent) >= minProfitPercent) : Math.abs(profitPercent) >= minProfitPercent);

            if (shouldInclude) {
              // Calculate liquidity score and estimated slippage
              const avgSpread1 = ((pair2.askPrice - pair2.bidPrice) / pair2.askPrice) * 100;
              const avgSpread2 = ((pair3.askPrice - pair3.bidPrice) / pair3.askPrice) * 100;
              const avgSpread3 = ((pair1.askPrice - pair1.bidPrice) / pair1.askPrice) * 100;

              const avgSpread = (avgSpread1 + avgSpread2 + avgSpread3) / 3;
              const liquidityScore = Math.max(10, Math.min(100, 100 - (avgSpread * 10)));
              const estimatedSlippage = avgSpread * 0.5; // Conservative estimate

              // Create human-readable trading path
              const tradingPath = `[${exchange.toUpperCase()}] ${quoteCurrency} → ${intermediate} → ${base} → ${quoteCurrency}`;

              opportunities.push({
                base_symbol: base,
                intermediate_symbol: intermediate,
                quote_symbol: quoteCurrency,
                exchange1: exchange,
                exchange2: exchange,
                exchange3: exchange,
                step1_action: `BUY ${intermediate}${quoteCurrency}`,
                step1_price: pair2.askPrice,
                step1_amount: step1Amount,
                step2_action: `BUY ${base}${intermediate}`,
                step2_price: pair3.askPrice,
                step2_amount: step2Amount,
                step3_action: `SELL ${base}${quoteCurrency}`,
                step3_price: pair1.bidPrice,
                step3_amount: step3Amount,
                start_amount: tradeAmount,
                end_amount: step3Amount,
                profit_amount: profit,
                profit_percent: profitPercent,
                // Enhanced fields
                step1_volume: tradeAmount,
                step2_volume: step1Amount * pair2.askPrice,
                step3_volume: step2Amount * pair1.bidPrice,
                estimated_slippage: estimatedSlippage,
                liquidity_score: Math.round(liquidityScore),
                // Short signal fields
                signal_type: signalType,
                arb_factor: arbFactor,
                overpriced_leg: overpricedLeg,
                price_deviation: priceDeviation
               });

               console.log(`Found opportunity: ${tradingPath} | Profit: ${profitPercent.toFixed(4)}%`);
             }
           } catch (error) {
             // Silently continue on calculation errors
           }
        }
      }
    }
  }

  // Sort by absolute profit percentage descending to show best opportunities first
  return opportunities
    .sort((a, b) => Math.abs(b.profit_percent) - Math.abs(a.profit_percent))
    .slice(0, 100); // Increased limit to capture more opportunities
}

// Cross-exchange arbitrage finder with short signal detection
function findCrossExchangeArbitrage(priceMap: Record<string, any>, quoteCurrency: string, tradeAmount: number, minProfitPercent: number = 0.001, filterProfitable: boolean = true, customPairs: string[] = [], detectShortSignals: boolean = false): any[] {
  const opportunities: any[] = [];

  // Use same base currencies as triangular arbitrage
  let commonBases = [
    'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'MATIC', 'DOT', 'AVAX',
    'SHIB', 'LTC', 'UNI', 'LINK', 'ATOM', 'TON', 'XLM', 'BCH', 'NEAR', 'TRX',
    'FTM', 'ALGO', 'ICP', 'THETA', 'EOS', 'AAVE', 'GRT', 'SAND', 'MANA', 'AXS',
    'CRV', 'RUNE', 'CAKE', 'SUSHI', 'COMP', 'YFI', 'MKR', 'SNX', 'FIL', 'VET',
    'KAVA', 'ZIL', 'ENJ', 'BAT', 'ZRX', 'REN', 'KNC', 'BAND', 'SXP', 'RSR',
    'OGN', 'DENT', 'WIN', 'HOT', 'ANKR', 'COTI', 'CHR', 'MDT', 'STMX', 'DF',
    'ARB', 'OP', 'IMX', 'APE', 'LDO', 'RNDR', 'INJ', 'PEPE', 'WLD', 'SEI',
    'TIA', 'ORDI', 'STX', 'PYTH', 'JUP', 'BLUR', 'WIF', 'BONK', 'FLOKI', 'GALA'
  ];

  // Add custom pairs
  if (customPairs && customPairs.length > 0) {
    const validCustomPairs = customPairs
      .map(p => p.toUpperCase().trim())
      .filter(p => p.length > 0 && !commonBases.includes(p));
    commonBases = [...commonBases, ...validCustomPairs];
  }

  // Dynamically get available exchanges from price data
  const availableExchanges = Array.from(new Set(
    Object.keys(priceMap)
      .map(key => key.split('_')[1])
      .filter(exchange => exchange)
  ));
  console.log(`Scanning cross-exchange arbitrage between ${availableExchanges.length} exchanges: ${availableExchanges.join(', ')}`);

  for (const base of commonBases) {
    const pairSymbol = `${base}${quoteCurrency}`;

    // Get all exchanges that have this pair
    const exchangesWithPair: { exchange: string; data: any }[] = [];
    for (const exchange of availableExchanges) {
      const pairKey = `${pairSymbol}_${exchange}`;
      if (priceMap[pairKey]) {
        exchangesWithPair.push({
          exchange,
          data: priceMap[pairKey]
        });
      }
    }

    // Compare prices across exchanges for cross-exchange arbitrage
    if (exchangesWithPair.length >= 2) {
      for (let i = 0; i < exchangesWithPair.length; i++) {
        for (let j = i + 1; j < exchangesWithPair.length; j++) {
          const exchange1 = exchangesWithPair[i];
          const exchange2 = exchangesWithPair[j];

          try {
            // Buy on exchange1, sell on exchange2
            const buyPrice = exchange1.data.askPrice;
            const sellPrice = exchange2.data.bidPrice;
            const amount = tradeAmount / buyPrice;
            const sellAmount = amount * sellPrice;
            const profit = sellAmount - tradeAmount;
            const profitPercent = (profit / tradeAmount) * 100;

            // Calculate arb factor for cross-exchange
            const arbFactor = sellAmount / tradeAmount;

            let signalType = 'arbitrage';
            let overpricedLeg = null;
            let priceDeviation = null;

            if (detectShortSignals) {
              if (arbFactor > 1.001) {
                signalType = 'arbitrage';
              } else if (arbFactor < 0.999) {
                signalType = 'short';
                // For cross-exchange, the overpriced exchange is where we sell (if arb < 1, buy price > sell price)
                overpricedLeg = `${pairSymbol} on ${exchange1.exchange}`;
                priceDeviation = ((buyPrice - sellPrice) / sellPrice) * 100;
              } else {
                signalType = 'none';
              }
            }

            const shouldInclude = filterProfitable ?
              ((profitPercent > 0 && Math.abs(profitPercent) >= minProfitPercent) || (detectShortSignals && signalType === 'short' && Math.abs(profitPercent) >= minProfitPercent)) :
              (detectShortSignals ? (signalType !== 'none' && Math.abs(profitPercent) >= minProfitPercent) : Math.abs(profitPercent) >= minProfitPercent);

            if (shouldInclude && isFinite(profitPercent) && isFinite(amount) && amount > 0) {
              const spread = ((sellPrice - buyPrice) / buyPrice) * 100;
              const liquidityScore = Math.max(10, Math.min(100, 100 - Math.abs(spread * 5)));

              opportunities.push({
                base_symbol: base,
                intermediate_symbol: base,
                quote_symbol: quoteCurrency,
                exchange1: exchange1.exchange,
                exchange2: exchange2.exchange,
                exchange3: exchange2.exchange,
                step1_action: `BUY ${pairSymbol}`,
                step1_price: buyPrice,
                step1_amount: amount,
                step2_action: `TRANSFER`,
                step2_price: 1,
                step2_amount: amount,
                step3_action: `SELL ${pairSymbol}`,
                step3_price: sellPrice,
                step3_amount: amount,
                start_amount: tradeAmount,
                end_amount: sellAmount,
                profit_amount: profit,
                profit_percent: profitPercent,
                step1_volume: tradeAmount,
                step2_volume: tradeAmount,
                step3_volume: sellAmount,
                estimated_slippage: Math.abs(spread) * 0.3,
                liquidity_score: Math.round(liquidityScore),
                signal_type: signalType,
                arb_factor: arbFactor,
                overpriced_leg: overpricedLeg,
                price_deviation: priceDeviation
              });

              console.log(`Cross-exchange: ${base} | Buy ${exchange1.exchange} → Sell ${exchange2.exchange} | Profit: ${profitPercent.toFixed(4)}%`);
            }

            // Try reverse (buy on exchange2, sell on exchange1)
            const buyPrice2 = exchange2.data.askPrice;
            const sellPrice2 = exchange1.data.bidPrice;
            const amount2 = tradeAmount / buyPrice2;
            const sellAmount2 = amount2 * sellPrice2;
            const profit2 = sellAmount2 - tradeAmount;
            const profitPercent2 = (profit2 / tradeAmount) * 100;

            const arbFactor2 = sellAmount2 / tradeAmount;

            let signalType2 = 'arbitrage';
            let overpricedLeg2 = null;
            let priceDeviation2 = null;

            if (detectShortSignals) {
              if (arbFactor2 > 1.001) {
                signalType2 = 'arbitrage';
              } else if (arbFactor2 < 0.999) {
                signalType2 = 'short';
                overpricedLeg2 = `${pairSymbol} on ${exchange2.exchange}`;
                priceDeviation2 = ((buyPrice2 - sellPrice2) / sellPrice2) * 100;
              } else {
                signalType2 = 'none';
              }
            }

            const shouldInclude2 = filterProfitable ?
              ((profitPercent2 > 0 && Math.abs(profitPercent2) >= minProfitPercent) || (detectShortSignals && signalType2 === 'short' && Math.abs(profitPercent2) >= minProfitPercent)) :
              (detectShortSignals ? (signalType2 !== 'none' && Math.abs(profitPercent2) >= minProfitPercent) : Math.abs(profitPercent2) >= minProfitPercent);

            if (shouldInclude2 && isFinite(profitPercent2) && isFinite(amount2) && amount2 > 0) {
              const spread2 = ((sellPrice2 - buyPrice2) / buyPrice2) * 100;
              const liquidityScore2 = Math.max(10, Math.min(100, 100 - Math.abs(spread2 * 5)));

              opportunities.push({
                base_symbol: base,
                intermediate_symbol: base,
                quote_symbol: quoteCurrency,
                exchange1: exchange2.exchange,
                exchange2: exchange1.exchange,
                exchange3: exchange1.exchange,
                step1_action: `BUY ${pairSymbol}`,
                step1_price: buyPrice2,
                step1_amount: amount2,
                step2_action: `TRANSFER`,
                step2_price: 1,
                step2_amount: amount2,
                step3_action: `SELL ${pairSymbol}`,
                step3_price: sellPrice2,
                step3_amount: amount2,
                start_amount: tradeAmount,
                end_amount: sellAmount2,
                profit_amount: profit2,
                profit_percent: profitPercent2,
                step1_volume: tradeAmount,
                step2_volume: tradeAmount,
                step3_volume: sellAmount2,
                estimated_slippage: Math.abs(spread2) * 0.3,
                liquidity_score: Math.round(liquidityScore2),
                signal_type: signalType2,
                arb_factor: arbFactor2,
                overpriced_leg: overpricedLeg2,
                price_deviation: priceDeviation2
              });

              console.log(`Cross-exchange: ${base} | Buy ${exchange2.exchange} → Sell ${exchange1.exchange} | Profit: ${profitPercent2.toFixed(4)}%`);
            }
          } catch (error) {
            // Continue on errors
          }
        }
      }
    }
  }

  // Sort by absolute profit percentage descending
  return opportunities
    .sort((a, b) => Math.abs(b.profit_percent) - Math.abs(a.profit_percent))
    .slice(0, 100);
}


// ============================================================================
// ENHANCED OPPORTUNITY DEDUPLICATION AND EXPIRY SYSTEM
// ============================================================================

/**
 * Key improvements:
 * 1. Smart deduplication - keeps only highest profit per unique path
 * 2. Dynamic expiry - opportunities expire when no longer valid
 * 3. Efficient database operations
 * 4. Quality scoring integration
 */

// ============================================================================
// 1. UNIQUE OPPORTUNITY KEY GENERATOR
// ============================================================================

interface OpportunityKey {
  pathKey: string;      // Unique identifier for the trading path
  hashKey: string;      // Hash for faster lookups
}

/**
 * Generates a unique key for an opportunity based on its trading path
 * This ensures we can identify duplicate opportunities regardless of order
 */
function generateOpportunityKey(opp: any): OpportunityKey {
  // Sort exchanges to handle different orderings of same path
  const exchanges = [opp.exchange1, opp.exchange2, opp.exchange3].sort();
  
  // Sort symbols to handle different orderings
  const symbols = [opp.base_symbol, opp.intermediate_symbol, opp.quote_symbol].sort();
  
  // Create deterministic path key
  const pathKey = `${exchanges.join('-')}_${symbols.join('-')}_${opp.type}`;
  
  // Create hash for faster lookups (simple hash function)
  const hashKey = simpleHash(pathKey);
  
  return { pathKey, hashKey };
}

/**
 * Simple hash function for faster map lookups
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

// ============================================================================
// 2. SMART DEDUPLICATION ENGINE
// ============================================================================

interface DeduplicationResult {
  uniqueOpportunities: any[];
  duplicatesRemoved: number;
  avgProfitImprovement: number;
}

/**
 * Deduplicates opportunities, keeping only the highest profit for each unique path
 */
function deduplicateOpportunities(opportunities: any[]): DeduplicationResult {
  const opportunityMap = new Map<string, any>();
  let duplicatesRemoved = 0;
  let totalProfitImprovement = 0;
  
  for (const opp of opportunities) {
    const { pathKey } = generateOpportunityKey(opp);
    
    const existing = opportunityMap.get(pathKey);
    
    if (!existing) {
      // First occurrence of this path
      opportunityMap.set(pathKey, opp);
    } else {
      // Duplicate found - keep the one with higher absolute profit
      const existingProfit = Math.abs(existing.profit_percent);
      const newProfit = Math.abs(opp.profit_percent);
      
      if (newProfit > existingProfit) {
        // New opportunity is better
        totalProfitImprovement += (newProfit - existingProfit);
        opportunityMap.set(pathKey, opp);
      }
      
      duplicatesRemoved++;
    }
  }
  
  const avgProfitImprovement = duplicatesRemoved > 0 
    ? totalProfitImprovement / duplicatesRemoved 
    : 0;
  
  return {
    uniqueOpportunities: Array.from(opportunityMap.values()),
    duplicatesRemoved,
    avgProfitImprovement
  };
}

// ============================================================================
// 3. DYNAMIC EXPIRY CALCULATION
// ============================================================================

interface ExpiryConfig {
  baseExpiry: number;        // Base expiry in seconds
  profitMultiplier: number;  // Extend expiry for high-profit opps
  liquidityMultiplier: number; // Extend expiry for high-liquidity opps
  maxExpiry: number;         // Maximum expiry time
  minExpiry: number;         // Minimum expiry time
}

const DEFAULT_EXPIRY_CONFIG: ExpiryConfig = {
  baseExpiry: 60,           // 60 seconds base
  profitMultiplier: 1.5,    // High profit = longer expiry
  liquidityMultiplier: 1.2, // High liquidity = longer expiry
  maxExpiry: 300,           // Max 5 minutes
  minExpiry: 30             // Min 30 seconds
};

/**
 * Calculate dynamic expiry time based on opportunity characteristics
 */
function calculateExpiryTime(
  opp: any, 
  config: ExpiryConfig = DEFAULT_EXPIRY_CONFIG
): Date {
  let expirySeconds = config.baseExpiry;
  
  // Extend for high-profit opportunities
  if (Math.abs(opp.profit_percent) > 1.0) {
    expirySeconds *= config.profitMultiplier;
  } else if (Math.abs(opp.profit_percent) > 0.5) {
    expirySeconds *= 1.2;
  }
  
  // Extend for high-liquidity opportunities
  if (opp.liquidity_score && opp.liquidity_score > 80) {
    expirySeconds *= config.liquidityMultiplier;
  }
  
  // Apply bounds
  expirySeconds = Math.min(config.maxExpiry, Math.max(config.minExpiry, expirySeconds));
  
  // Return expiry timestamp
  return new Date(Date.now() + expirySeconds * 1000);
}

// ============================================================================
// 4. INTELLIGENT OPPORTUNITY MERGER (renamed to processOpportunities to avoid clash)
// ============================================================================

interface MergeResult {
  opportunities: any[];
  mergeStats: {
    totalInput: number;
    afterDeduplication: number;
    afterFiltering: number;
    duplicatesRemoved: number;
    lowQualityRemoved: number;
  };
}

/**
 * Complete opportunity processing pipeline
 */
function processOpportunitiesPipeline( // Renamed to avoid clash with existing filterAndRankOpportunities
  triangularOpps: any[],
  crossExchangeOpps: any[],
  minProfitPercent: number = 0.05,
  maxResults: number = 50
): MergeResult {
  console.log('Starting opportunity processing pipeline...');
  
  // Step 1: Combine all opportunities
  const allOpportunities = [...triangularOpps, ...crossExchangeOpps];
  const totalInput = allOpportunities.length;
  
  console.log(`Total input opportunities: ${totalInput}`);
  
  // Step 2: Deduplicate
  const { uniqueOpportunities, duplicatesRemoved, avgProfitImprovement } = 
    deduplicateOpportunities(allOpportunities);
  
  console.log(`After deduplication: ${uniqueOpportunities.length} (removed ${duplicatesRemoved} duplicates)`);
  console.log(`Average profit improvement from deduplication: ${avgProfitImprovement.toFixed(4)}%`);
  
  // Step 3: Calculate quality scores (using the calculateQualityScore defined below)
  const scoredOpportunities = uniqueOpportunities.map(opp => {
    const avgVolume = (opp.step1_volume + opp.step2_volume + opp.step3_volume) / 3;
    const qualityScore = calculateQualityScore(
      opp.profit_percent,
      opp.liquidity_score || 0,
      avgVolume
    );
    
    return {
      ...opp,
      quality_score: qualityScore
    };
  });
  
  // Step 4: Filter by minimum profit
  const filteredOpportunities = scoredOpportunities.filter(opp => 
    Math.abs(opp.profit_percent) >= minProfitPercent
  );
  
  const lowQualityRemoved = scoredOpportunities.length - filteredOpportunities.length;
  
  console.log(`After profit filtering (>=${minProfitPercent}%): ${filteredOpportunities.length} (removed ${lowQualityRemoved})`);
  
  // Step 5: Sort by quality score, then profit
  const sortedOpportunities = filteredOpportunities.sort((a, b) => {
    // Primary sort: quality score (descending)
    if (b.quality_score !== a.quality_score) {
      return b.quality_score - a.quality_score;
    }
    // Secondary sort: profit percentage (descending)
    return Math.abs(b.profit_percent) - Math.abs(a.profit_percent);
  });
  
  // Step 6: Take top N results
  const finalOpportunities = sortedOpportunities.slice(0, maxResults);
  
  // Step 7: Calculate dynamic expiry for each
  const opportunitiesWithExpiry = finalOpportunities.map(opp => ({
    ...opp,
    expires_at: calculateExpiryTime(opp).toISOString()
  }));
  
  console.log(`Final result: ${opportunitiesWithExpiry.length} high-quality opportunities`);
  
  return {
    opportunities: opportunitiesWithExpiry,
    mergeStats: {
      totalInput,
      afterDeduplication: uniqueOpportunities.length,
      afterFiltering: filteredOpportunities.length,
      duplicatesRemoved,
      lowQualityRemoved
    }
  };
}

// ============================================================================
// 5. QUALITY SCORE CALCULATOR (Integrated)
// ============================================================================

function calculateQualityScore(
  profitPercent: number,
  liquidityScore: number,
  avgVolume: number
): number {
  let score = 0;
  
  // Profit scoring (0-50 points)
  if (Math.abs(profitPercent) >= 1.0) {
    score += 50;
  } else if (Math.abs(profitPercent) >= 0.5) {
    score += 35;
  } else if (Math.abs(profitPercent) >= 0.1) {
    score += 20;
  }
  
  // Liquidity scoring (0-30 points)
  if (liquidityScore >= 80) {
    score += 30;
  } else if (liquidityScore >= 60) {
    score += 20;
  } else if (liquidityScore >= 50) {
    score += 10;
  }
  
  // Volume scoring (0-20 points)
  if (avgVolume >= 1000) {
    score += 20;
  } else if (avgVolume >= 500) {
    score += 15;
  } else if (avgVolume >= 100) {
    score += 10;
  } else if (avgVolume >= 50) {
    score += 5;
  }
  
  return score;
}

// ============================================================================
// 6. DATABASE UPSERT STRATEGY
// ============================================================================

/**
 * Efficient database upsert that prevents duplicates
 */
async function upsertOpportunities(
  supabase: any,
  opportunities: any[]
): Promise<{ inserted: number; updated: number; errors: number }> {
  let inserted = 0;
  let updated = 0;
  let errors = 0;
  
  console.log(`Upserting ${opportunities.length} opportunities to database...`);
  
  // Batch operations for better performance
  const BATCH_SIZE = 50;
  
  for (let i = 0; i < opportunities.length; i += BATCH_SIZE) {
    const batch = opportunities.slice(i, i + BATCH_SIZE);
    
    try {
      // Delete existing opportunities with same path to prevent duplicates
      // This logic will need to be adjusted if 'user_id' is also part of the unique key
      // For now, it matches the original deduplication intent based on the path.
      const deletePromises = batch.map(opp => {
        const { pathKey } = generateOpportunityKey(opp);
        
        return supabase
          .from('arbitrage_opportunities')
          .delete()
          .eq('base_symbol', opp.base_symbol)
          .eq('quote_symbol', opp.quote_symbol)
          .eq('intermediate_symbol', opp.intermediate_symbol)
          .eq('exchange1', opp.exchange1)
          .eq('exchange2', opp.exchange2)
          .eq('exchange3', opp.exchange3)
          .eq('type', opp.type)
          .eq('user_id', opp.user_id); // Assuming user_id is now part of the opportunity object for upsert
      });
      
      await Promise.all(deletePromises);
      
      // Insert new opportunities
      const { data, error } = await supabase
        .from('arbitrage_opportunities')
        .insert(batch)
        .select();
      
      if (error) {
        console.error('Batch insert error:', error);
        errors += batch.length;
      } else {
        inserted += data.length;
      }
    } catch (error) {
      console.error('Batch processing error:', error);
      errors += batch.length;
    }
  }
  
  console.log(`Database upsert complete: ${inserted} inserted, ${updated} updated, ${errors} errors`);
  
  return { inserted, updated, errors };
}

// ============================================================================
// 7. USAGE EXAMPLE IN EDGE FUNCTION (Integrated below in the main handler)
// ============================================================================

// ============================================================================
// 8. EXPORT FOR INTEGRATION (Not needed in a single edge function file)
// ============================================================================

// ============================================================================
// 9. CONFIGURATION OBJECT
// ============================================================================

export const OPPORTUNITY_CONFIG = {
  // Deduplication settings
  deduplication: {
    enabled: true,
    keepHighestProfit: true
  },
  
  // Expiry settings
  expiry: {
    baseSeconds: 60,
    minSeconds: 30,
    maxSeconds: 300,
    profitMultiplier: 1.5,
    liquidityMultiplier: 1.2
  },
  
  // Quality filtering
  quality: {
    minProfitPercent: 0.05,
    minLiquidityScore: 50,
    minVolume: 10,
    maxResults: 50
  },
  
  // Database settings
  database: {
    batchSize: 50,
    useUpsert: true,
    deleteOldFirst: true
  }
};


// Main serve handler - unified handler for all request types
serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { mode, userId, action } = body;

    // Handle authenticated user requests with action='scan'
    if (action === 'scan') {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        return new Response(JSON.stringify({ error: 'Authorization header required' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: userError } = await supabase.auth.getUser(token);

      if (userError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
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
        settings = null;
      }

      const enabledExchanges = settings?.enabled_exchanges || ['binance', 'bybit', 'okx'];
      const tradeAmount = settings?.trade_amount || 10;
      const minProfitPercent = (settings?.min_profit_percent || 0.0005) * 100;
      const filterProfitable = settings?.filter_profitable !== undefined ? settings.filter_profitable : true;
      const arbitrageTypes = settings?.arbitrage_types || ['triangular', 'cross_exchange'];
      const customPairs = settings?.custom_pairs || [];

      // Clear expired opportunities in background (non-blocking)
      supabase.rpc('cleanup_expired_opportunities').then(
        () => console.log('Background cleanup completed'),
        (error: any) => console.error('Background cleanup failed:', error)
      );

      // Fetch exchange data
      const exchangeData = await fetchAllExchangeData(enabledExchanges);

      let triangularOpps: any[] = [];
      let crossExchangeOpps: any[] = [];
      const quoteCurrencies = ['USDT', 'BNB'];
      const detectShortSignals = arbitrageTypes.includes('short_signal');

      for (const quoteCurrency of quoteCurrencies) {
        if (arbitrageTypes.includes('triangular')) {
          const foundOpps = findTriangularArbitrage(exchangeData, quoteCurrency, tradeAmount, minProfitPercent, filterProfitable, customPairs, detectShortSignals);
          foundOpps.forEach(opp => opp.type = 'triangular');
          triangularOpps.push(...foundOpps);
        }

        if (arbitrageTypes.includes('cross_exchange')) {
          const foundOpps = findCrossExchangeArbitrage(exchangeData, quoteCurrency, tradeAmount, minProfitPercent, filterProfitable, customPairs, detectShortSignals);
          foundOpps.forEach(opp => opp.type = 'cross_exchange');
          crossExchangeOpps.push(...foundOpps);
        }
      }

      // Use the new processing pipeline
      const { opportunities, mergeStats } = processOpportunitiesPipeline(
        triangularOpps,
        crossExchangeOpps,
        minProfitPercent,
        OPPORTUNITY_CONFIG.quality.maxResults // Use config for max results
      );
      
      console.log('Processing stats:', mergeStats);

      // Add user_id to opportunities before upserting
      const opportunitiesWithUserId = opportunities.map(opp => ({
        ...opp,
        user_id: user.id
      }));

      // Upsert to database
      const dbStats = await upsertOpportunities(supabase, opportunitiesWithUserId);

      return new Response(JSON.stringify({
        success: true,
        data: opportunities,
        opportunities_count: opportunities.length,
        exchanges_successful: mergeStats.totalInput - mergeStats.lowQualityRemoved, // Simplified for response
        exchanges_failed: 0, // Simplified, actual failures handled during fetchAllExchangeData
        merge_stats: mergeStats,
        database_stats: dbStats
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Auto mode: scan for all users with auto_trade enabled
    if (mode === 'auto') {
      console.log('Running in auto mode - scanning for all users with auto_trade enabled');

      // Fetch all users with auto_trade enabled and active subscriptions
      const { data: users, error: usersError } = await supabase
        .from('user_settings')
        .select(`
          user_id,
          refresh_rate,
          trade_amount,
          min_profit_percent,
          max_profit_percent,
          enabled_exchanges,
          custom_pairs,
          arbitrage_types,
          auto_trade,
          filter_profitable
        `)
        .eq('auto_trade', true);

      if (usersError) {
        console.error('Error fetching users with auto_trade:', usersError);
        return new Response(JSON.stringify({ error: 'Failed to fetch users' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (!users || users.length === 0) {
        console.log('No users with auto_trade enabled found');
        return new Response(JSON.stringify({ message: 'No users to scan' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      console.log(`Found ${users.length} users with auto_trade enabled`);

      // Process each user
      const results = [];
      for (const userSettings of users) {
        try {
          // Check if user has active subscription
          const { data: subscription } = await supabase
            .from('user_subscriptions')
            .select(`
              *,
              subscription_plans (
                name,
                price,
                duration_type,
                features
              )
            `)
            .eq('user_id', userSettings.user_id)
            .eq('status', 'active')
            .gte('end_date', new Date().toISOString())
            .maybeSingle(); // Use maybeSingle as a user might not have an active sub

          if (!subscription) {
            console.log(`User ${userSettings.user_id} has no active subscription, skipping`);
            continue;
          }

          // Determine max trade amount based on subscription tier
          const tierName = subscription.subscription_plans?.name || '';
          let maxTradeAmount = 0;

          if (tierName.includes('Tier 1') || tierName.includes('Scanner Only')) {
            console.log(`User ${userSettings.user_id} has Tier 1 (Scanner Only) - skipping auto-trade`);
            continue; // Scanner only tier, no auto-trading
          } else if (tierName.includes('Tier 2') || tierName.includes('$500')) {
            maxTradeAmount = 500;
          } else if (tierName.includes('Tier 3') || tierName.includes('$1,000')) {
            maxTradeAmount = 1000;
          } else {
            maxTradeAmount = 100; // Default fallback
          }

          // Calculate actual trade amount based on user's balance and tier limit
          let actualTradeAmount = Math.min(
            userSettings.trade_amount || 10,
            maxTradeAmount
          );

          console.log(`Processing user ${userSettings.user_id} with ${tierName} (max: $${maxTradeAmount}, actual: $${actualTradeAmount})`);

          // Fetch exchange data
          const exchangeData = await fetchAllExchangeData(
            userSettings.enabled_exchanges || ['binance', 'bybit', 'okx', 'gate', 'kucoin']
          );

          let triangularOpps: any[] = [];
          let crossExchangeOpps: any[] = [];
          const quoteCurrencies = ['USDT', 'BNB'];
          const detectShortSignals = (userSettings.arbitrage_types || []).includes('short_signal');

          for (const quoteCurrency of quoteCurrencies) {
            if ((userSettings.arbitrage_types || []).includes('triangular')) {
              const foundOpps = findTriangularArbitrage(
                exchangeData,
                quoteCurrency, // Pass quoteCurrency directly
                actualTradeAmount,
                userSettings.min_profit_percent || 0.0005,
                userSettings.filter_profitable !== false,
                userSettings.custom_pairs || [],
                detectShortSignals
              );
              foundOpps.forEach(opp => opp.type = 'triangular');
              triangularOpps.push(...foundOpps);
            }

            if ((userSettings.arbitrage_types || []).includes('cross_exchange')) {
              const foundOpps = findCrossExchangeArbitrage(
                exchangeData,
                quoteCurrency, // Pass quoteCurrency directly
                actualTradeAmount,
                userSettings.min_profit_percent || 0.0005,
                userSettings.filter_profitable !== false,
                userSettings.custom_pairs || [],
                detectShortSignals
              );
              foundOpps.forEach(opp => opp.type = 'cross_exchange');
              crossExchangeOpps.push(...foundOpps);
            }
          }

          // Use the new processing pipeline
          const { opportunities, mergeStats } = processOpportunitiesPipeline(
            triangularOpps,
            crossExchangeOpps,
            userSettings.min_profit_percent || 0.05,
            OPPORTUNITY_CONFIG.quality.maxResults
          );

          console.log(`Processing stats for user ${userSettings.user_id}:`, mergeStats);

          // Add user_id to opportunities before upserting
          const opportunitiesWithUserId = opportunities.map(opp => ({
            ...opp,
            user_id: userSettings.user_id
          }));

          // Upsert to database
          const dbStats = await upsertOpportunities(supabase, opportunitiesWithUserId);

          results.push({
            user_id: userSettings.user_id,
            opportunities_found: opportunities.length,
            merge_stats: mergeStats,
            database_stats: dbStats
          });
        } catch (error) {
          console.error(`Error processing user ${userSettings.user_id}:`, error);
        }
      }

      // Cleanup expired opportunities in background (non-blocking)
      (async () => {
        try {
          await supabase.rpc('cleanup_expired_opportunities');
          console.log('Background cleanup completed');
        } catch (error) {
          console.error('Background cleanup failed:', error);
        }
      })();

      return new Response(JSON.stringify({
        success: true,
        users_processed: results.length,
        results
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Manual mode (existing logic, updated to use new pipeline)
    if (!userId) {
      return new Response(JSON.stringify({ error: 'userId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Starting arbitrage scan for user ${userId}`);

    // Check rate limit
    if (!checkRateLimit(userId)) {
      console.log(`Rate limit exceeded for user ${userId}`);
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Cleanup expired opportunities in background (non-blocking)
    (async () => {
      try {
        await supabase.rpc('cleanup_expired_opportunities');
        console.log('Background cleanup completed');
      } catch (error) {
        console.error('Background cleanup failed:', error);
      }
    })();

    // Fetch user settings
    const { data: userSettings, error: settingsError } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (settingsError || !userSettings) {
      console.error('Error fetching user settings:', settingsError);
      return new Response(JSON.stringify({ error: 'User settings not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const enabledExchanges = userSettings.enabled_exchanges || ['binance', 'bybit', 'okx', 'gate', 'kucoin'];
    const tradeAmount = userSettings.trade_amount || 10;
    const minProfitPercent = userSettings.min_profit_percent || 0.0005; // Note: original code used 0.0005, new pipeline expects 0.05
    const customPairs = userSettings.custom_pairs || [];
    const filterProfitable = userSettings.filter_profitable !== false;
    const arbitrageTypes = userSettings.arbitrage_types || ['triangular', 'cross_exchange'];

    console.log(`Fetching data from ${enabledExchanges.length} exchanges concurrently`);

    // Fetch exchange data
    const exchangeData = await fetchAllExchangeData(enabledExchanges);

    let triangularOpps: any[] = [];
    let crossExchangeOpps: any[] = [];
    const quoteCurrencies = ['USDT', 'BNB'];
    const detectShortSignals = arbitrageTypes.includes('short_signal');

    for (const quoteCurrency of quoteCurrencies) {
      if (arbitrageTypes.includes('triangular')) {
        const foundOpps = findTriangularArbitrage(
          exchangeData,
          quoteCurrency, // Pass quoteCurrency directly
          tradeAmount,
          minProfitPercent,
          filterProfitable,
          customPairs,
          detectShortSignals
        );
        foundOpps.forEach(opp => opp.type = 'triangular');
        triangularOpps.push(...foundOpps);
      }

      if (arbitrageTypes.includes('cross_exchange')) {
        const foundOpps = findCrossExchangeArbitrage(
          exchangeData,
          quoteCurrency, // Pass quoteCurrency directly
          tradeAmount,
          minProfitPercent,
          filterProfitable,
          customPairs,
          detectShortSignals
        );
        foundOpps.forEach(opp => opp.type = 'cross_exchange');
        crossExchangeOpps.push(...foundOpps);
      }
    }

    // Use the new processing pipeline
    const { opportunities, mergeStats } = processOpportunitiesPipeline(
      triangularOpps,
      crossExchangeOpps,
      minProfitPercent * 100, // Convert back to percentage for the pipeline
      OPPORTUNITY_CONFIG.quality.maxResults
    );

    console.log(`Total opportunities after processing: ${opportunities.length}`);
    console.log('Processing stats:', mergeStats);

    // Add user_id to opportunities before upserting
    const opportunitiesWithUserId = opportunities.map(opp => ({
      ...opp,
      user_id: userId
    }));

    // Upsert to database
    const dbStats = await upsertOpportunities(supabase, opportunitiesWithUserId);

    return new Response(JSON.stringify({
      success: true,
      opportunities_count: opportunities.length,
      data: opportunities,
      merge_stats: mergeStats,
      database_stats: dbStats
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error in arbitrage scanner:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

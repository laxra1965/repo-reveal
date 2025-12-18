import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import ccxt from 'https://esm.sh/ccxt@4.4.35';

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const userRequestCounts = new Map<string, { count: number, resetTime: number }>();

// Configuration Object
export const OPPORTUNITY_CONFIG = {
  deduplication: { enabled: true, keepHighestProfit: true },
  expiry: { baseSeconds: 60, minSeconds: 30, maxSeconds: 300, profitMultiplier: 1.5, liquidityMultiplier: 1.2 },
  quality: { minProfitPercent: 0.05, minLiquidityScore: 50, minVolume: 10, maxResults: 50 },
  database: { batchSize: 50, useUpsert: true, deleteOldFirst: true }
};

// Fixed shared base currencies
const SHARED_COMMON_BASES = [
  'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'MATIC', 'DOT', 'AVAX',
  'SHIB', 'LTC', 'UNI', 'LINK', 'ATOM', 'TON', 'XLM', 'BCH', 'NEAR', 'TRX',
  'FTM', 'ALGO', 'ICP', 'THETA', 'EOS', 'AAVE', 'GRT', 'SAND', 'MANA', 'AXS',
  'CRV', 'RUNE', 'CAKE', 'SUSHI', 'COMP', 'YFI', 'MKR', 'SNX', 'FIL', 'VET',
  'KAVA', 'ZIL', 'ENJ', 'BAT', 'ZRX', 'REN', 'KNC', 'BAND', 'SXP', 'RSR',
  'OGN', 'DENT', 'WIN', 'HOT', 'ANKR', 'COTI', 'CHR', 'MDT', 'STMX', 'DF',
  'ARB', 'OP', 'IMX', 'APE', 'LDO', 'RNDR', 'INJ', 'PEPE', 'WLD', 'SEI',
  'TIA', 'ORDI', 'STX', 'PYTH', 'JUP', 'BLUR', 'WIF', 'BONK', 'FLOKI', 'GALA',
  'USDC', 'DAI', 'FDUSD', 'TUSD', 'BUSD'
];

// Helper to standardize symbols across exchanges
function standardizeSymbol(symbol: string, exchange: string): string | null {
  if (!symbol) return null;
  let cleanSymbol = symbol.toUpperCase().replace(/[-_/:]/g, ''); // Added colon for Perps
  if (cleanSymbol.length < 3) return null;
  return cleanSymbol;
}

// Helper function to check rate limits
function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const windowMs = 60000;
  const maxRequests = 20;
  let userData = userRequestCounts.get(userId);
  if (!userData || now > userData.resetTime) {
    userData = { count: 0, resetTime: now + windowMs };
    userRequestCounts.set(userId, userData);
  }
  if (userData.count >= maxRequests) return false;
  userData.count++;
  return true;
}

// Helper to get CCXT exchange instance
const getExchangeInstance = (exchangeName: string) => {
  const exchangeId = exchangeName.toLowerCase();
  if (!ccxt[exchangeId]) return null;
  return new ccxt[exchangeId]({
    enableRateLimit: true,
    timeout: 15000,
    options: { 'defaultType': 'spot' }
  });
};

// Unified fetch using CCXT
async function fetchExchangeData(exchangeName: string): Promise<any> {
  console.log(`Fetching data from ${exchangeName} via CCXT...`);
  try {
    const exchange = getExchangeInstance(exchangeName);
    if (!exchange) throw new Error(`Exchange ${exchangeName} not supported`);
    const tickers = await exchange.fetchTickers();
    const priceMap: Record<string, any> = {};

    const validTickers = Object.values(tickers).filter((ticker: any) =>
      ticker && ticker.symbol && ticker.bid !== undefined && ticker.ask !== undefined &&
      (ticker.symbol.includes('/') || (ticker.base && ticker.quote))
    );

    if (exchangeName.toLowerCase() === 'bybit') {
      console.log(`Bybit Market Check: Found ${validTickers.length} active raw symbols`);
    }

    validTickers.forEach((ticker: any) => {
      // Use CCXT's base/quote if available, else split from symbol
      const base = ticker.base || ticker.symbol.split('/')[0];
      const quote = ticker.quote || ticker.symbol.split('/')[1]?.split(':')[0];

      const base_asset = base.toUpperCase();
      const quote_asset = quote.toUpperCase();
      const standardSymbol = base_asset + quote_asset;
      const key = `${standardSymbol}_${exchangeName.toLowerCase()}`;
      const vol = ticker.quoteVolume || ticker.baseVolume || 0;

      // Filter for liquid spot pairs (ignore low volume to save CPU)
      if (ticker.bid > 0 && ticker.ask > ticker.bid && vol > 100) {
        priceMap[key] = {
          symbol: standardSymbol,
          base_asset,
          quote_asset,
          exchange: exchangeName.toLowerCase(),
          bidPrice: ticker.bid,
          askPrice: ticker.ask,
          volume: vol
        };
      }
    });

    console.log(`${exchangeName}: CCXT returned ${Object.keys(priceMap).length} liquid tickers`);
    return { exchangeName, data: priceMap, success: true };
  } catch (error: any) {
    console.error(`CCXT Error fetching ${exchangeName}:`, error.message);
    return { exchangeName, error: error.message, success: false };
  }
}

async function fetchAllExchangeData(enabledExchanges: string[]): Promise<Record<string, any>> {
  console.log(`Fetching data from ${enabledExchanges.length} exchanges concurrently`);
  const results = await Promise.all(enabledExchanges.map(ex => fetchExchangeData(ex)));
  const combinedData: Record<string, any> = {};
  results.forEach(result => {
    if (result.success && result.data) Object.assign(combinedData, result.data);
  });
  console.log(`Common Data Pool: ${Object.keys(combinedData).length} total ticker entries`);
  return combinedData;
}

async function fetchTopMovers(): Promise<string[]> {
  try {
    const response = await fetch('https://api.binance.com/api/v3/ticker/24hr', {
      headers: { 'User-Agent': 'ArbitrageScanner/2.0' },
      signal: (AbortSignal as any).timeout(5000)
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data
      .filter((t: any) => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 50000)
      .map((t: any) => ({
        symbol: t.symbol.replace('USDT', ''),
        change: Math.abs(parseFloat(t.priceChangePercent))
      }))
      .sort((a: any, b: any) => b.change - a.change)
      .slice(0, 50)
      .map((t: any) => t.symbol);
  } catch (error: any) {
    return [];
  }
}

// Search Functions
async function findTriangularArbitrage(priceMap: Record<string, any>, quoteCurrency: string, tradeAmount: number, minProfitPercent: number = 0.05, filterProfitable: boolean = true, customPairs: string[] = [], detectShortSignals: boolean = false): Promise<any[]> {
  const opportunities: any[] = [];
  const topMovers = await fetchTopMovers();
  const availableExchanges = Array.from(new Set(Object.keys(priceMap).map(key => key.split('_')[1])));
  const fee = 0.001; // 0.1% average spot fee

  for (const exchange of availableExchanges) {
    const exchangeData = Object.values(priceMap).filter((t: any) => t.exchange === exchange);
    const pairLookup = new Map(exchangeData.map((t: any) => [`${t.base_asset}${t.quote_asset}`, t]));

    // Build Adjacency Graph for O(1) connectivity checks
    const adjacency = new Map<string, Set<string>>();
    for (const t of exchangeData) {
      if (!adjacency.has(t.base_asset)) adjacency.set(t.base_asset, new Set());
      if (!adjacency.has(t.quote_asset)) adjacency.set(t.quote_asset, new Set());
      adjacency.get(t.base_asset)!.add(t.quote_asset);
      adjacency.get(t.quote_asset)!.add(t.base_asset);
    }

    // Assets connected to our pocket currency (e.g. USDT)
    const quoteNeighbors = adjacency.get(quoteCurrency) || new Set<string>();

    // Targeted Search: Only use assets in the computed whitelist (Movers + Custom + Common)
    const whitelist = new Set([
      ...SHARED_COMMON_BASES,
      ...topMovers,
      ...customPairs.map(p => {
        const up = p.toUpperCase().trim();
        // If it's a full pair like XRPUSDT, extract the base
        if (up.endsWith(quoteCurrency)) return up.slice(0, -quoteCurrency.length);
        return up;
      })
    ]);

    let pathCount = 0;
    let bestGross = -999;
    let bestSymbol = '';

    // Optimized Targeted Search: quoteCurrency -> Base -> Intermediate -> quoteCurrency
    // Both 'base' and 'intermediate' must be in our whitelist
    for (const base of quoteNeighbors) {
      if (!whitelist.has(base)) continue;

      const baseNeighbors = adjacency.get(base) || new Set<string>();
      for (const intermediate of baseNeighbors) {
        if (intermediate === quoteCurrency || !quoteNeighbors.has(intermediate)) continue;
        if (!whitelist.has(intermediate)) continue;

        const p1 = pairLookup.get(`${base}${quoteCurrency}`) || pairLookup.get(`${quoteCurrency}${base}`);
        const p2 = pairLookup.get(`${base}${intermediate}`) || pairLookup.get(`${intermediate}${base}`);
        const p3 = pairLookup.get(`${intermediate}${quoteCurrency}`) || pairLookup.get(`${quoteCurrency}${intermediate}`);

        if (!p1 || !p2 || !p3) continue;
        pathCount++;

        try {
          // Dynamic Directional Analysis
          const s1IsBy = p1.quote_asset === quoteCurrency;
          const s1P = s1IsBy ? p1.askPrice : 1 / p1.bidPrice;
          const s1A = (tradeAmount * (1 - fee)) / (s1IsBy ? s1P : 1);
          const s1RA = s1IsBy ? s1A : s1A * p1.bidPrice;

          const s2IsBy = p2.quote_asset === base;
          const s2P = s2IsBy ? p2.askPrice : p2.bidPrice;
          const s2A = s2IsBy ? (s1RA * (1 - fee)) / s2P : (s1RA * (1 - fee)) * s2P;

          const s3IsSl = p3.base_asset === intermediate;
          const s3P = s3IsSl ? p3.bidPrice : 1 / p3.askPrice;
          const s3A = s3IsSl ? (s2A * (1 - fee)) * s3P : (s2A * (1 - fee)) / p3.askPrice;

          const netPct = ((s3A - tradeAmount) / tradeAmount) * 100;
          const gr = (tradeAmount / s1P) * (s2IsBy ? 1 / p2.askPrice : p2.bidPrice) * (s3IsSl ? p3.bidPrice : 1 / p3.askPrice);
          const grossPct = ((gr - tradeAmount) / tradeAmount) * 100;

          if (grossPct > bestGross) { bestGross = grossPct; bestSymbol = `${base}->${intermediate}`; }

          if (netPct >= minProfitPercent) {
            opportunities.push({
              base_symbol: base, intermediate_symbol: intermediate, quote_symbol: quoteCurrency,
              exchange1: exchange, exchange2: exchange, exchange3: exchange,
              step1_action: s1IsBy ? `BUY ${base}${quoteCurrency}` : `SELL ${quoteCurrency}${base}`,
              step1_price: p1.bidPrice, step1_amount: s1A,
              step2_action: s2IsBy ? `BUY ${intermediate}${base}` : `SELL ${base}${intermediate}`,
              step2_price: s2P, step2_amount: s2A,
              step3_action: s3IsSl ? `SELL ${intermediate}${quoteCurrency}` : `BUY ${quoteCurrency}${intermediate}`,
              step3_price: p3.askPrice, step3_amount: s3A,
              start_amount: tradeAmount, end_amount: s3A, profit_amount: s3A - tradeAmount, profit_percent: netPct,
              type: 'triangular', signal_type: 'arbitrage',
              step1_volume: p1.volume, step2_volume: p2.volume, step3_volume: p3.volume,
              liquidity_score: Math.min(100, (p1.volume + p2.volume + p3.volume) / 1000)
            });
          }
        } catch (e) { }
      }
    }
    console.log(`${exchange}: Evaluated ${pathCount} paths. Best Gross: ${bestGross.toFixed(4)}% (${bestSymbol}). Net Found: ${opportunities.filter(o => o.exchange1 === exchange).length}`);
  }
  return opportunities;
}

function findCrossExchangeArbitrage(priceMap: Record<string, any>, quoteCurrency: string, tradeAmount: number, minProfitPercent: number = 0.05, filterProfitable: boolean = true, customPairs: string[] = [], detectShortSignals: boolean = false): any[] {
  const opportunities: any[] = [];
  const commonBases = Array.from(new Set([...SHARED_COMMON_BASES, ...customPairs.map(p => p.toUpperCase().trim())]));
  const availableExchanges = Array.from(new Set(Object.keys(priceMap).map(key => key.split('_')[1])));
  const transferFeeUSDT = 0.1;

  for (const base of commonBases) {
    const symbols = availableExchanges.map(ex => ({ ex, data: priceMap[`${base}${quoteCurrency}_${ex}`] })).filter(s => s.data);
    if (symbols.length < 2) continue;

    for (let i = 0; i < symbols.length; i++) {
      for (let j = 0; j < symbols.length; j++) {
        if (i === j) continue;
        const ex1 = symbols[i];
        const ex2 = symbols[j];
        const fee = 0.001;

        const buyP = ex1.data.askPrice;
        const sellP = ex2.data.bidPrice;
        const amountAfterBuy = (tradeAmount * (1 - fee)) / buyP;
        const grossReturn = amountAfterBuy * sellP * (1 - fee);
        const netProfit = grossReturn - tradeAmount - transferFeeUSDT;
        const profitPct = (netProfit / tradeAmount) * 100;

        if (profitPct >= minProfitPercent) {
          opportunities.push({
            base_symbol: base, intermediate_symbol: base, quote_symbol: quoteCurrency,
            exchange1: ex1.ex, exchange2: ex2.ex, exchange3: ex2.ex,
            step1_action: `BUY ${base}${quoteCurrency}`, step1_price: buyP, step1_amount: amountAfterBuy,
            step2_action: `TRANSFER`, step2_price: 1, step2_amount: amountAfterBuy,
            step3_action: `SELL ${base}${quoteCurrency}`, step3_price: sellP, step3_amount: amountAfterBuy,
            start_amount: tradeAmount, end_amount: grossReturn, profit_amount: netProfit, profit_percent: profitPct,
            type: 'cross_exchange', signal_type: 'arbitrage',
            step1_volume: ex1.data.volume, step2_volume: 0, step3_volume: ex2.data.volume,
            liquidity_score: Math.min(100, (ex1.data.volume + ex2.data.volume) / 2000)
          });
        }
      }
    }
  }
  return opportunities;
}

function findShortSignals(priceMap: Record<string, any>, quoteCurrency: string, tradeAmount: number, minProfitPercent: number = 0.05, customPairs: string[] = []): any[] {
  const opportunities: any[] = [];
  const commonBases = Array.from(new Set([...SHARED_COMMON_BASES, ...customPairs.map(p => p.toUpperCase().trim())]));
  const availableExchanges = Array.from(new Set(Object.keys(priceMap).map(key => key.split('_')[1])));

  for (const base of commonBases) {
    const symbols = availableExchanges.map(ex => ({ ex, data: priceMap[`${base}${quoteCurrency}_${ex}`] })).filter(s => s.data);
    if (symbols.length < 2) continue;

    const avgPrice = symbols.reduce((acc, s) => acc + (s.data.bidPrice + s.data.askPrice) / 2, 0) / symbols.length;

    for (const s of symbols) {
      const currentPrice = (s.data.bidPrice + s.data.askPrice) / 2;
      const divergence = ((currentPrice - avgPrice) / avgPrice) * 100;

      if (divergence > 2.0) {
        opportunities.push({
          base_symbol: base, intermediate_symbol: base, quote_symbol: quoteCurrency,
          exchange1: s.ex, exchange2: s.ex, exchange3: s.ex,
          step1_action: `SHORT ${base}${quoteCurrency}`, step1_price: s.data.bidPrice, step1_amount: tradeAmount / s.data.bidPrice,
          step2_action: `HEDGE / WAIT`, step2_price: 1, step2_amount: tradeAmount,
          step3_action: `CLOSE AT ${avgPrice.toFixed(4)}`, step3_price: avgPrice, step3_amount: tradeAmount,
          start_amount: tradeAmount, end_amount: tradeAmount * (1 + (divergence / 100)), profit_amount: (tradeAmount * (divergence / 100)), profit_percent: divergence,
          type: 'short', signal_type: 'short',
          step1_volume: s.data.volume, step2_volume: 0, step3_volume: 0,
          liquidity_score: 80
        });
      }
    }
  }
  return opportunities;
}

function calculateQualityScore(profit: number, liq: number, vol: number): number {
  let score = 0;
  if (profit >= 1.0) score += 50; else if (profit >= 0.5) score += 35; else if (profit >= 0.1) score += 20;
  if (liq >= 80) score += 30; else if (liq >= 60) score += 20; else if (liq >= 50) score += 10;
  if (vol >= 1000) score += 20; else if (vol >= 500) score += 15; else if (vol >= 100) score += 10;
  return score;
}

function processOpportunitiesPipeline(tri: any[], cross: any[], short: any[], minProfit: number, maxResults: number, ml: boolean): any {
  const all = [...tri, ...cross, ...short];
  const unique = Array.from(new Map(all.map(o => [`${o.exchange1}_${o.exchange2}_${o.exchange3}_${o.base_symbol}_${o.intermediate_symbol}_${o.quote_symbol}_${o.type}`, o])).values());

  const processed = unique.map(o => ({
    ...o,
    quality_score: calculateQualityScore(o.profit_percent, o.liquidity_score || 0, (o.step1_volume + o.step2_volume + o.step3_volume) / 3),
    expires_at: new Date(Date.now() + 60000).toISOString()
  }))
    .filter(o => o.profit_percent >= minProfit && o.profit_percent <= 50)
    .sort((a, b) => b.quality_score - a.quality_score || b.profit_percent - a.profit_percent)
    .slice(0, maxResults);

  if (all.length > 0) {
    const bestPotential = [...all].sort((a, b) => b.profit_percent - a.profit_percent).slice(0, 3);
    console.log(`Pipeline Status: Input=${all.length}, Best Potential Profit=${bestPotential[0]?.profit_percent.toFixed(4)}%, Threshold=${minProfit.toFixed(4)}%`);
  }

  return { opportunities: processed, mergeStats: { totalInput: all.length, afterDeduplication: unique.length, final: processed.length } };
}

async function upsertOpportunities(supabase: any, opportunities: any[]) {
  if (opportunities.length === 0) return { inserted: 0 };
  const { data, error } = await supabase.from('arbitrage_opportunities').upsert(opportunities, { onConflict: 'user_id,base_symbol,quote_symbol,intermediate_symbol,exchange1,exchange2,exchange3,type' }).select();
  if (error) console.error('Upsert error:', error);
  return { inserted: data?.length || 0 };
}

// Main Handler
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Get Token and Role
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    let isServiceRole = false;

    // Quick check for service role to allow automation
    if (token) {
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]));
          isServiceRole = payload.role === 'service_role';
        }
      } catch (e) { }
    }

    // 2. Parse Body safely
    let body: any = {};
    try {
      const text = await req.text();
      if (text) body = JSON.parse(text);
    } catch (e) {
      console.warn('Body parse failed, trying URL params');
    }

    // Fallback/Merge from URL params
    const url = new URL(req.url);
    const mode = body.mode || url.searchParams.get('mode');
    const userId = body.userId || url.searchParams.get('userId');
    const action = body.action || url.searchParams.get('action');

    // 3. Fetch Global Admin Settings
    const { data: globalArbSettings } = await supabase.from('admin_settings').select('key, value').eq('key', 'enabled_arbitrage_types').maybeSingle();
    const globalEnabledTypes = globalArbSettings?.value?.split(',') || ['triangular', 'cross_exchange', 'short'];

    console.log(`Scanner invoked: mode=${mode}, action=${action}, isServiceRole=${isServiceRole}, globallyEnabled=${globalEnabledTypes.join('|')}`);

    // Auto Mode Logic
    if (mode === 'auto') {
      if (!isServiceRole) {
        return new Response(JSON.stringify({ error: 'Auto mode requires service role' }), { status: 403, headers: corsHeaders });
      }

      console.log('Starting Global Auto-Trade Scan...');
      const { data: users } = await supabase.from('user_settings').select('*').eq('auto_trade', true);
      if (!users || users.length === 0) return new Response(JSON.stringify({ message: 'No auto-trade users found' }), { headers: corsHeaders });

      const allExchs = Array.from(new Set(users.flatMap((u: any) => u.enabled_exchanges || ['binance', 'bybit', 'okx']))) as string[];
      const allCustom = Array.from(new Set(users.flatMap((u: any) => u.custom_pairs || []))) as string[];
      const data = await fetchAllExchangeData(allExchs);

      const gTri: any[] = [];
      const gCross: any[] = [];
      const gShort: any[] = [];

      const isTriEnabled = globalEnabledTypes.includes('triangular');
      const isCrossEnabled = globalEnabledTypes.includes('cross_exchange');
      const isShortEnabled = globalEnabledTypes.includes('short');

      if (isTriEnabled || isCrossEnabled || isShortEnabled) {
        for (const q of ['USDT', 'BNB']) {
          if (isTriEnabled) {
            const t = await findTriangularArbitrage(data, q, 100, 0.01, false, allCustom, true);
            gTri.push(...t);
          }
          if (isCrossEnabled) {
            const c = findCrossExchangeArbitrage(data, q, 100, 0.01, false, allCustom, true);
            gCross.push(...c);
          }
          if (isShortEnabled) {
            const s = findShortSignals(data, q, 100, 0.01, allCustom);
            gShort.push(...s);
          }
        }
        console.log(`Global Search Complete: Found ${gTri.length} tri, ${gCross.length} cross, and ${gShort.length} short paths`);
      }

      for (const u of users) {
        const { data: sub } = await supabase.from('user_subscriptions').select('*, subscription_plans(name)').eq('user_id', u.user_id).eq('status', 'active').gte('end_date', new Date().toISOString()).maybeSingle();
        if (!sub || sub.subscription_plans?.name?.includes('Tier 1')) continue;

        const tier = sub.subscription_plans?.name || '';
        const limit = tier.includes('Tier 3') ? 1000 : (tier.includes('Tier 2') ? 500 : 100);
        const amount = Math.min(u.trade_amount || 10, limit);
        const minP = u.min_profit_percent || 0.1; // Expect percentage directly (e.g. 0.1 = 0.1%)
        const uEx = u.enabled_exchanges || ['binance', 'bybit', 'okx'];
        const uTypes = u.arbitrage_types || ['triangular', 'cross_exchange'];

        const tri = uTypes.includes('triangular')
          ? gTri.filter((o: any) => uEx.includes(o.exchange1)).map((o: any) => ({ ...o, user_id: u.user_id, start_amount: amount, profit_amount: (o.profit_percent / 100) * amount, end_amount: amount + (o.profit_percent / 100) * amount }))
          : [];

        const cross = uTypes.includes('cross_exchange')
          ? gCross.filter((o: any) => uEx.includes(o.exchange1) && uEx.includes(o.exchange2)).map((o: any) => ({ ...o, user_id: u.user_id, start_amount: amount, profit_amount: (o.profit_percent / 100) * amount, end_amount: amount + (o.profit_percent / 100) * amount }))
          : [];

        const short = uTypes.includes('short')
          ? gShort.filter((o: any) => uEx.includes(o.exchange1)).map((o: any) => ({ ...o, user_id: u.user_id, start_amount: amount, profit_amount: (o.profit_percent / 100) * amount, end_amount: amount + (o.profit_percent / 100) * amount }))
          : [];

        const { opportunities } = processOpportunitiesPipeline(tri, cross, short, minP, 50, u.enable_ml_filtering);
        if (opportunities.length > 0) {
          const res = await upsertOpportunities(supabase, opportunities);
          console.log(`User ${u.user_id}: Found ${tri.length}/${cross.length}/${short.length} matches, Upserted ${res.inserted}`);
        }
      }
      console.log(`Auto-Scan Complete: Processed ${users.length} users in ${Date.now() - startTime}ms`);
      return new Response(JSON.stringify({ success: true, processed: users.length }), { headers: corsHeaders });
    }

    // Manual Scan / Action logic
    let finalUserId = userId;

    if (!finalUserId && token) {
      const { data: { user } } = await supabase.auth.getUser(token);
      finalUserId = user?.id;
    }

    if (!finalUserId && !isServiceRole) {
      return new Response(JSON.stringify({ error: 'Unauthorized: No valid user session or ID' }), { status: 401, headers: corsHeaders });
    }

    // If still no finalUserId but it IS service role, we need a target userId from settings or body
    if (!finalUserId && isServiceRole) {
      return new Response(JSON.stringify({ error: 'Service role requires a target userId for manual scans' }), { status: 400, headers: corsHeaders });
    }

    console.log(`Performing manual scan for user: ${finalUserId}`);
    const { data: settings } = await supabase.from('user_settings').select('*').eq('user_id', finalUserId).single();
    if (!settings) return new Response(JSON.stringify({ error: 'User settings not found' }), { status: 404, headers: corsHeaders });

    const exData = await fetchAllExchangeData(settings.enabled_exchanges || ['binance', 'bybit', 'okx']);
    const tri: any[] = [];
    const cross: any[] = [];
    const short: any[] = [];

    const userTypes = settings.arbitrage_types || ['triangular', 'cross_exchange'];
    const activeTypes = userTypes.filter((t: string) => globalEnabledTypes.includes(t));
    const minP = settings.min_profit_percent || 0.1;

    console.log(`Manual Scan Config: Amount=${settings.trade_amount}, MinProfit=${minP}%`);

    for (const q of ['USDT', 'BNB']) {
      if (activeTypes.includes('triangular')) tri.push(...(await findTriangularArbitrage(exData, q, settings.trade_amount || 10, minP, true, settings.custom_pairs || [])));
      if (activeTypes.includes('cross_exchange')) cross.push(...findCrossExchangeArbitrage(exData, q, settings.trade_amount || 10, minP, true, settings.custom_pairs || []));
      if (activeTypes.includes('short')) short.push(...findShortSignals(exData, q, settings.trade_amount || 10, minP, settings.custom_pairs || []));
    }

    const { opportunities } = processOpportunitiesPipeline(tri, cross, short, minP, 50, settings.enable_ml_filtering);
    await upsertOpportunities(supabase, opportunities.map((o: any) => ({ ...o, user_id: finalUserId })));

    return new Response(JSON.stringify({
      success: true,
      count: opportunities.length,
      opportunities_count: opportunities.length,
      data: opportunities
    }), { headers: corsHeaders });

  } catch (err: any) {
    console.error('Scanner Error:', err);
    return new Response(JSON.stringify({ error: err.message, stack: err.stack }), { status: 500, headers: corsHeaders });
  }
});

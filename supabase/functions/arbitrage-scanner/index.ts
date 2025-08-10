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

      // Fetch price data from enabled exchanges
      const priceData: Record<string, any[]> = {};
      
      for (const exchangeName of enabledExchanges) {
        const config = API_CONFIG[exchangeName.charAt(0).toUpperCase() + exchangeName.slice(1)];
        if (!config) continue;

        try {
          console.log(`Fetching data from ${exchangeName}`);
          const response = await fetch(config.url!, {
            headers: {
              'User-Agent': 'ArbitrageScanner/1.0',
              'Accept': 'application/json',
            }
          });

          if (response.ok) {
            const data = await response.json();
            priceData[exchangeName] = normalizeExchangeData(exchangeName, data);
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

      // Find arbitrage opportunities
      const opportunities = findTriangularArbitrage(priceData, tradeAmount, minProfitPercent, maxProfitPercent);

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

function normalizeExchangeData(exchange: string, data: any): any[] {
  switch (exchange.toLowerCase()) {
    case 'binance':
    case 'mexc':
      return data.map((item: any) => ({
        symbol: item.symbol,
        bidPrice: parseFloat(item.bidPrice),
        askPrice: parseFloat(item.askPrice),
        bidQty: parseFloat(item.bidQty || 0),
        askQty: parseFloat(item.askQty || 0)
      }));
    
    case 'bybit':
      return data.result?.list?.map((item: any) => ({
        symbol: item.symbol,
        bidPrice: parseFloat(item.bid1Price),
        askPrice: parseFloat(item.ask1Price),
        bidQty: parseFloat(item.bid1Size || 0),
        askQty: parseFloat(item.ask1Size || 0)
      })) || [];
    
    case 'okx':
      return data.data?.map((item: any) => ({
        symbol: item.instId.replace('-', ''),
        bidPrice: parseFloat(item.bidPx),
        askPrice: parseFloat(item.askPx),
        bidQty: parseFloat(item.bidSz || 0),
        askQty: parseFloat(item.askSz || 0)
      })) || [];
    
    default:
      return [];
  }
}

function findTriangularArbitrage(
  priceData: Record<string, any[]>,
  tradeAmount: number,
  minProfitPercent: number,
  maxProfitPercent: number
): any[] {
  const opportunities: any[] = [];
  const exchangeNames = Object.keys(priceData);

  // Common trading pairs for triangular arbitrage
  const commonBases = ['BTC', 'ETH', 'BNB', 'USDT', 'USDC'];
  const commonQuotes = ['USDT', 'USDC', 'BTC', 'ETH'];

  for (let i = 0; i < exchangeNames.length; i++) {
    for (let j = i; j < exchangeNames.length; j++) {
      for (let k = j; k < exchangeNames.length; k++) {
        const exchange1 = exchangeNames[i];
        const exchange2 = exchangeNames[j];
        const exchange3 = exchangeNames[k];

        const data1 = priceData[exchange1];
        const data2 = priceData[exchange2];
        const data3 = priceData[exchange3];

        // Try different currency combinations
        for (const base of commonBases) {
          for (const quote of commonQuotes) {
            for (const intermediate of commonBases) {
              if (base === quote || base === intermediate || quote === intermediate) continue;

              const opportunity = calculateTriangularArbitrage(
                data1, data2, data3,
                exchange1, exchange2, exchange3,
                base, quote, intermediate,
                tradeAmount
              );

              if (opportunity && 
                  opportunity.profit_percent >= minProfitPercent && 
                  opportunity.profit_percent <= maxProfitPercent) {
                opportunities.push(opportunity);
              }
            }
          }
        }
      }
    }
  }

  return opportunities.sort((a, b) => b.profit_percent - a.profit_percent).slice(0, 10);
}

function calculateTriangularArbitrage(
  data1: any[], data2: any[], data3: any[],
  exchange1: string, exchange2: string, exchange3: string,
  base: string, quote: string, intermediate: string,
  startAmount: number
): any | null {
  
  // Find required pairs
  const pair1Symbol = `${base}${intermediate}`;
  const pair2Symbol = `${intermediate}${quote}`;
  const pair3Symbol = `${base}${quote}`;

  const pair1 = data1.find(p => p.symbol === pair1Symbol);
  const pair2 = data2.find(p => p.symbol === pair2Symbol);
  const pair3 = data3.find(p => p.symbol === pair3Symbol);

  if (!pair1 || !pair2 || !pair3) return null;

  // Calculate path: base -> intermediate -> quote -> base
  const step1Amount = startAmount / pair1.askPrice; // Buy intermediate with base
  const step2Amount = step1Amount * pair2.bidPrice; // Sell intermediate for quote
  const step3Amount = step2Amount / pair3.askPrice; // Buy base with quote
  
  const profit = step3Amount - startAmount;
  const profitPercent = (profit / startAmount) * 100;

  if (profit <= 0) return null;

  return {
    base_symbol: base,
    quote_symbol: quote,
    intermediate_symbol: intermediate,
    exchange1: exchange1.toLowerCase(),
    exchange2: exchange2.toLowerCase(),
    exchange3: exchange3.toLowerCase(),
    step1_action: 'BUY',
    step1_price: pair1.askPrice,
    step1_amount: step1Amount,
    step2_action: 'SELL',
    step2_price: pair2.bidPrice,
    step2_amount: step1Amount,
    step3_action: 'BUY',
    step3_price: pair3.askPrice,
    step3_amount: step3Amount,
    start_amount: startAmount,
    end_amount: step3Amount,
    profit_amount: profit,
    profit_percent: profitPercent
  };
}
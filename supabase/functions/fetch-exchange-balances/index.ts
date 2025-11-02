import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExchangeBalance {
  exchange: string;
  totalUSDT: number;
  assets: Record<string, number>;
  timestamp: string;
  error?: string;
}

// Binance balance fetcher
async function fetchBinanceBalance(apiKey: string, apiSecret: string): Promise<ExchangeBalance> {
  try {
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = createHmac('sha256', apiSecret)
      .update(queryString)
      .digest('hex');

    const response = await fetch(
      `https://api.binance.com/api/v3/account?${queryString}&signature=${signature}`,
      {
        headers: {
          'X-MBX-APIKEY': apiKey,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    if (!text || text.trim() === '') {
      throw new Error('Binance API returned empty response');
    }

    const data = JSON.parse(text);
    const assets: Record<string, number> = {};
    let totalUSDT = 0;

    // Get USDT balance and other assets
    for (const balance of data.balances) {
      const free = parseFloat(balance.free);
      const locked = parseFloat(balance.locked);
      const total = free + locked;

      if (total > 0) {
        assets[balance.asset] = total;
        if (balance.asset === 'USDT') {
          totalUSDT += total;
        }
      }
    }

    // Fetch current prices to convert to USDT
    const priceResponse = await fetch('https://api.binance.com/api/v3/ticker/price');
    const prices = await priceResponse.json();
    const priceMap: Record<string, number> = {};
    
    for (const ticker of prices) {
      if (ticker.symbol.endsWith('USDT')) {
        const asset = ticker.symbol.replace('USDT', '');
        priceMap[asset] = parseFloat(ticker.price);
      }
    }

    // Calculate total in USDT
    for (const [asset, amount] of Object.entries(assets)) {
      if (asset !== 'USDT' && priceMap[asset]) {
        totalUSDT += amount * priceMap[asset];
      }
    }

    return {
      exchange: 'binance',
      totalUSDT,
      assets,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Binance balance fetch error:', error);
    return {
      exchange: 'binance',
      totalUSDT: 0,
      assets: {},
      timestamp: new Date().toISOString(),
      error: error.message,
    };
  }
}

// Bybit balance fetcher
async function fetchBybitBalance(apiKey: string, apiSecret: string): Promise<ExchangeBalance> {
  try {
    const timestamp = Date.now().toString();
    const params = `accountType=UNIFIED&timestamp=${timestamp}`;
    const signature = createHmac('sha256', apiSecret)
      .update(timestamp + apiKey + '5000' + params)
      .digest('hex');

    const response = await fetch(
      `https://api.bybit.com/v5/account/wallet-balance?${params}`,
      {
        headers: {
          'X-BAPI-API-KEY': apiKey,
          'X-BAPI-SIGN': signature,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': '5000',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Bybit API error: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    if (!text || text.trim() === '') {
      throw new Error('Bybit API returned empty response');
    }

    const data = JSON.parse(text);
    if (data.retCode !== 0) {
      throw new Error(`Bybit API error: ${data.retMsg}`);
    }

    const assets: Record<string, number> = {};
    let totalUSDT = 0;

    if (data.result?.list?.[0]?.coin) {
      for (const coin of data.result.list[0].coin) {
        const total = parseFloat(coin.walletBalance || '0');
        if (total > 0) {
          assets[coin.coin] = total;
          if (coin.coin === 'USDT') {
            totalUSDT += total;
          }
        }
      }
    }

    // Fetch current prices
    const priceResponse = await fetch('https://api.bybit.com/v5/market/tickers?category=spot');
    const priceData = await priceResponse.json();
    const priceMap: Record<string, number> = {};

    if (priceData.result?.list) {
      for (const ticker of priceData.result.list) {
        if (ticker.symbol.endsWith('USDT')) {
          const asset = ticker.symbol.replace('USDT', '');
          priceMap[asset] = parseFloat(ticker.lastPrice);
        }
      }
    }

    // Calculate total in USDT
    for (const [asset, amount] of Object.entries(assets)) {
      if (asset !== 'USDT' && priceMap[asset]) {
        totalUSDT += amount * priceMap[asset];
      }
    }

    return {
      exchange: 'bybit',
      totalUSDT,
      assets,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Bybit balance fetch error:', error);
    return {
      exchange: 'bybit',
      totalUSDT: 0,
      assets: {},
      timestamp: new Date().toISOString(),
      error: error.message,
    };
  }
}

// Gate.io balance fetcher
async function fetchGateBalance(apiKey: string, apiSecret: string): Promise<ExchangeBalance> {
  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const method = 'GET';
    const path = '/api/v4/spot/accounts';
    const queryString = '';
    const bodyHash = createHmac('sha512', '')
      .update('')
      .digest('hex');
    
    const signString = `${method}\n${path}\n${queryString}\n${bodyHash}\n${timestamp}`;
    const signature = createHmac('sha512', apiSecret)
      .update(signString)
      .digest('hex');

    const response = await fetch(
      `https://api.gateio.ws${path}`,
      {
        headers: {
          'KEY': apiKey,
          'SIGN': signature,
          'Timestamp': timestamp,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Gate.io API error: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    if (!text || text.trim() === '') {
      throw new Error('Gate.io API returned empty response');
    }

    const data = JSON.parse(text);
    const assets: Record<string, number> = {};
    let totalUSDT = 0;

    for (const balance of data) {
      const available = parseFloat(balance.available || '0');
      const locked = parseFloat(balance.locked || '0');
      const total = available + locked;

      if (total > 0) {
        assets[balance.currency] = total;
        if (balance.currency === 'USDT') {
          totalUSDT += total;
        }
      }
    }

    // Fetch current prices
    const priceResponse = await fetch('https://api.gateio.ws/api/v4/spot/tickers');
    const prices = await priceResponse.json();
    const priceMap: Record<string, number> = {};
    
    for (const ticker of prices) {
      if (ticker.currency_pair.endsWith('_USDT')) {
        const asset = ticker.currency_pair.replace('_USDT', '');
        priceMap[asset] = parseFloat(ticker.last);
      }
    }

    // Calculate total in USDT
    for (const [asset, amount] of Object.entries(assets)) {
      if (asset !== 'USDT' && priceMap[asset]) {
        totalUSDT += amount * priceMap[asset];
      }
    }

    return {
      exchange: 'gate',
      totalUSDT,
      assets,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Gate.io balance fetch error:', error);
    return {
      exchange: 'gate',
      totalUSDT: 0,
      assets: {},
      timestamp: new Date().toISOString(),
      error: error.message,
    };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Fetching balances for user ${user.id}`);

    // Fetch user's exchange credentials
    const { data: credentials, error: credsError } = await supabase
      .from('exchange_credentials')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_connected', true);

    if (credsError) {
      throw new Error(`Failed to fetch credentials: ${credsError.message}`);
    }

    if (!credentials || credentials.length === 0) {
      return new Response(JSON.stringify({ 
        balances: [],
        totalUSDT: 0,
        message: 'No exchange credentials found' 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch balances from each connected exchange
    const balances: ExchangeBalance[] = [];
    
    for (const cred of credentials) {
      let balance: ExchangeBalance;
      
      switch (cred.exchange) {
        case 'binance':
          balance = await fetchBinanceBalance(cred.api_key, cred.api_secret);
          break;
        case 'bybit':
          balance = await fetchBybitBalance(cred.api_key, cred.api_secret);
          break;
        case 'gate':
        case 'gateio':
          balance = await fetchGateBalance(cred.api_key, cred.api_secret);
          break;
        default:
          console.log(`Unsupported exchange: ${cred.exchange}`);
          continue;
      }
      
      balances.push(balance);
    }

    const totalUSDT = balances.reduce((sum, b) => sum + b.totalUSDT, 0);

    console.log(`Total balance: $${totalUSDT.toFixed(2)} across ${balances.length} exchanges`);

    return new Response(JSON.stringify({ 
      balances,
      totalUSDT,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error fetching balances:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

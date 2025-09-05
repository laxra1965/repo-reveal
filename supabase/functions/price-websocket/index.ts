import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PriceUpdate {
  symbol: string;
  exchange: string;
  bidPrice: number;
  askPrice: number;
  timestamp: number;
}

// WebSocket connections storage
const connections = new Map<string, WebSocket>();
const userSubscriptions = new Map<string, Set<string>>();

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const upgradeHeader = req.headers.get('upgrade') || '';
  if (upgradeHeader.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket connection', { status: 400, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get token from URL parameters for WebSocket authentication
    const url = new URL(req.url);
    const token = url.searchParams.get('token');
    
    if (!token) {
      throw new Error('Unauthorized: Missing token parameter');
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      throw new Error('Unauthorized: Invalid token');
    }

    const { socket, response } = Deno.upgradeWebSocket(req);

    socket.onopen = () => {
      console.log(`WebSocket connection opened for user ${user.id}`);
      connections.set(user.id, socket);
      userSubscriptions.set(user.id, new Set());
      
      // Send initial connection confirmation
      socket.send(JSON.stringify({
        type: 'connected',
        message: 'Real-time price stream connected',
        timestamp: Date.now()
      }));

      // Start price streaming for BNB pairs
      startPriceStreaming(user.id, socket);
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        switch (message.type) {
          case 'subscribe':
            handleSubscription(user.id, message.symbols);
            break;
          case 'unsubscribe':
            handleUnsubscription(user.id, message.symbols);
            break;
          case 'ping':
            socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    };

    socket.onclose = () => {
      console.log(`WebSocket connection closed for user ${user.id}`);
      connections.delete(user.id);
      userSubscriptions.delete(user.id);
    };

    socket.onerror = (error) => {
      console.error(`WebSocket error for user ${user.id}:`, error);
    };

    return response;
  } catch (error) {
    console.error('WebSocket setup error:', error);
    return new Response(JSON.stringify({ 
      error: 'WebSocket setup failed',
      message: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function handleSubscription(userId: string, symbols: string[]) {
  const userSubs = userSubscriptions.get(userId);
  if (userSubs) {
    symbols.forEach(symbol => userSubs.add(symbol));
    console.log(`User ${userId} subscribed to: ${symbols.join(', ')}`);
  }
}

function handleUnsubscription(userId: string, symbols: string[]) {
  const userSubs = userSubscriptions.get(userId);
  if (userSubs) {
    symbols.forEach(symbol => userSubs.delete(symbol));
    console.log(`User ${userId} unsubscribed from: ${symbols.join(', ')}`);
  }
}

async function startPriceStreaming(userId: string, socket: WebSocket) {
  const bnbSymbols = [
    'BNBUSDT', 'BNBBTC', 'BNBETH', 'BNBBUSD', 
    'ADABNB', 'DOTBNB', 'LINKBNB', 'LTCBNB'
  ];

  // Subscribe to BNB pairs by default
  handleSubscription(userId, bnbSymbols);

  // Fetch initial prices
  try {
    const binanceResponse = await fetch('https://api.binance.com/api/v3/ticker/bookTicker');
    const binanceData = await binanceResponse.json();
    
    const filteredData = binanceData
      .filter((ticker: any) => bnbSymbols.includes(ticker.symbol))
      .map((ticker: any) => ({
        symbol: ticker.symbol,
        exchange: 'binance',
        bidPrice: parseFloat(ticker.bidPrice),
        askPrice: parseFloat(ticker.askPrice),
        timestamp: Date.now()
      }));

    socket.send(JSON.stringify({
      type: 'initial_prices',
      data: filteredData,
      timestamp: Date.now()
    }));

    console.log(`Sent initial prices for ${filteredData.length} BNB pairs to user ${userId}`);
  } catch (error) {
    console.error('Error fetching initial prices:', error);
  }

  // Set up periodic price updates
  const interval = setInterval(async () => {
    if (socket.readyState !== WebSocket.OPEN) {
      clearInterval(interval);
      return;
    }

    const userSubs = userSubscriptions.get(userId);
    if (!userSubs || userSubs.size === 0) return;

    try {
      // Fetch updated prices from multiple exchanges
      const updates = await fetchPriceUpdates(Array.from(userSubs));
      
      if (updates.length > 0) {
        socket.send(JSON.stringify({
          type: 'price_update',
          data: updates,
          timestamp: Date.now()
        }));
      }
    } catch (error) {
      console.error('Error fetching price updates:', error);
    }
  }, 2000); // Update every 2 seconds
}

async function fetchPriceUpdates(symbols: string[]): Promise<PriceUpdate[]> {
  const updates: PriceUpdate[] = [];

  try {
    // Fetch from Binance
    const binanceResponse = await fetch('https://api.binance.com/api/v3/ticker/bookTicker');
    const binanceData = await binanceResponse.json();
    
    binanceData
      .filter((ticker: any) => symbols.includes(ticker.symbol))
      .forEach((ticker: any) => {
        updates.push({
          symbol: ticker.symbol,
          exchange: 'binance',
          bidPrice: parseFloat(ticker.bidPrice),
          askPrice: parseFloat(ticker.askPrice),
          timestamp: Date.now()
        });
      });

    // Fetch from Bybit (parallel)
    const bybitResponse = await fetch('https://api.bybit.com/v5/market/tickers?category=spot');
    const bybitData = await bybitResponse.json();
    
    if (bybitData.retCode === 0 && bybitData.result?.list) {
      bybitData.result.list
        .filter((ticker: any) => symbols.includes(ticker.symbol))
        .forEach((ticker: any) => {
          updates.push({
            symbol: ticker.symbol,
            exchange: 'bybit',
            bidPrice: parseFloat(ticker.bid1Price),
            askPrice: parseFloat(ticker.ask1Price),
            timestamp: Date.now()
          });
        });
    }

  } catch (error) {
    console.error('Error fetching price updates:', error);
  }

  return updates;
}

// Broadcast price updates to all connected users
export function broadcastPriceUpdate(update: PriceUpdate) {
  connections.forEach((socket, userId) => {
    const userSubs = userSubscriptions.get(userId);
    
    if (userSubs?.has(update.symbol) && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'price_update',
        data: [update],
        timestamp: Date.now()
      }));
    }
  });
}
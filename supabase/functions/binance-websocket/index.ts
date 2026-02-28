import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

interface BinanceTickerData {
  s: string; // symbol
  b: string; // best bid price
  a: string; // best ask price
  c: string; // close price
  h: string; // high price
  l: string; // low price
  v: string; // volume
}

// Store active price data
const priceData: Map<string, BinanceTickerData> = new Map();
let binanceSocket: WebSocket | null = null;
let connectedClients: Set<WebSocket> = new Set();

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Connect to Binance WebSocket streams for BNB pairs
const connectToBinance = () => {
  console.log('Connecting to Binance WebSocket streams...');
  
  // Subscribe to all ticker streams (this gives us all symbols)
  const binanceWsUrl = 'wss://stream.binance.com:9443/ws/!ticker@arr';
  
  binanceSocket = new WebSocket(binanceWsUrl);
  
  binanceSocket.onopen = () => {
    console.log('Connected to Binance WebSocket');
  };
  
  binanceSocket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (Array.isArray(data)) {
        // Process all ticker updates
        const bnbPairs: BinanceTickerData[] = [];
        
        data.forEach((ticker: BinanceTickerData) => {
          // Store all price data
          priceData.set(ticker.s, ticker);
          
          // Focus on BNB pairs for arbitrage
          if (ticker.s.includes('BNB') || ticker.s.startsWith('BNB') || ticker.s.endsWith('BNB')) {
            bnbPairs.push(ticker);
          }
        });
        
        // Send updates to connected clients
        if (bnbPairs.length > 0) {
          const updateMessage = {
            type: 'price_update',
            data: bnbPairs,
            timestamp: Date.now()
          };
          
          broadcastToClients(JSON.stringify(updateMessage));
          
          // Check for arbitrage opportunities with BNB pairs
          await checkArbitrageOpportunities(bnbPairs);
        }
      }
    } catch (error) {
      console.error('Error processing Binance data:', error);
    }
  };
  
  binanceSocket.onerror = (error) => {
    console.error('Binance WebSocket error:', error);
  };
  
  binanceSocket.onclose = () => {
    console.log('Binance WebSocket closed, reconnecting...');
    setTimeout(connectToBinance, 5000);
  };
};

// Broadcast message to all connected clients
const broadcastToClients = (message: string) => {
  connectedClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (error) {
        console.error('Error sending to client:', error);
        connectedClients.delete(client);
      }
    } else {
      connectedClients.delete(client);
    }
  });
};

// Check for arbitrage opportunities with real-time data
const checkArbitrageOpportunities = async (bnbPairs: BinanceTickerData[]) => {
  try {
    // Create price map for BNB triangular arbitrage
    const priceMap: Record<string, any> = {};
    
    bnbPairs.forEach((ticker) => {
      const symbol = standardizeSymbol(ticker.s);
      if (symbol) {
        priceMap[symbol] = {
          bidPrice: parseFloat(ticker.b),
          askPrice: parseFloat(ticker.a),
          symbol: ticker.s
        };
      }
    });
    
    // Find BNB-based triangular arbitrage opportunities
    const opportunities = findBNBTriangularArbitrage(priceMap, 100); // $100 trade amount
    
    if (opportunities.length > 0) {
      console.log(`Found ${opportunities.length} BNB arbitrage opportunities`);
      
      // Store opportunities in database
      for (const opportunity of opportunities) {
        await supabase.from('arbitrage_opportunities').insert({
          user_id: '00000000-0000-0000-0000-000000000000', // System user for real-time data
          ...opportunity,
          detected_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 30000).toISOString() // 30 second expiry
        });
      }
      
      // Broadcast opportunities to clients
      const opportunityMessage = {
        type: 'arbitrage_opportunities',
        data: opportunities,
        timestamp: Date.now()
      };
      
      broadcastToClients(JSON.stringify(opportunityMessage));
    }
  } catch (error) {
    console.error('Error checking arbitrage opportunities:', error);
  }
};

// Standardize symbol names
const standardizeSymbol = (symbol: string): string | null => {
  if (!symbol) return null;
  
  let s = symbol.toUpperCase();
  
  // Convert common pairs to standard format
  if (s.endsWith('USDT')) {
    return s;
  } else if (s.endsWith('BTC')) {
    return s;
  } else if (s.endsWith('ETH')) {
    return s;
  } else if (s.endsWith('BNB')) {
    return s;
  }
  
  return s;
};

// Find BNB-based triangular arbitrage
const findBNBTriangularArbitrage = (priceMap: Record<string, any>, tradeAmount: number): any[] => {
  const opportunities: any[] = [];
  
  // Common altcoins that pair with BNB and USDT
  const altcoins = ['BTC', 'ETH', 'ADA', 'SOL', 'MATIC', 'DOT', 'LINK', 'AVAX', 'UNI', 'LTC'];
  
  for (const altcoin of altcoins) {
    const bnbUsdt = priceMap['BNBUSDT'];
    const altcoinUsdt = priceMap[`${altcoin}USDT`];
    const altcoinBnb = priceMap[`${altcoin}BNB`];
    
    if (bnbUsdt && altcoinUsdt && altcoinBnb) {
      // Path 1: USDT -> BNB -> ALTCOIN -> USDT
      try {
        const step1Amount = tradeAmount / bnbUsdt.askPrice; // Buy BNB with USDT
        const step2Amount = step1Amount / altcoinBnb.askPrice; // Buy ALTCOIN with BNB
        const step3Amount = step2Amount * altcoinUsdt.bidPrice; // Sell ALTCOIN for USDT
        
        const profit = step3Amount - tradeAmount;
        const profitPercent = (profit / tradeAmount) * 100;
        
        if (profit > 0.01 && profitPercent > 0.005) { // Minimum $0.01 profit and 0.005%
          opportunities.push({
            base_symbol: 'USDT',
            intermediate_symbol: 'BNB',
            quote_symbol: altcoin,
            exchange1: 'binance',
            exchange2: 'binance',
            exchange3: 'binance',
            step1_action: 'BUY',
            step1_price: bnbUsdt.askPrice,
            step1_amount: step1Amount,
            step2_action: 'BUY',
            step2_price: altcoinBnb.askPrice,
            step2_amount: step2Amount,
            step3_action: 'SELL',
            step3_price: altcoinUsdt.bidPrice,
            step3_amount: step2Amount,
            start_amount: tradeAmount,
            end_amount: step3Amount,
            profit_amount: profit,
            profit_percent: profitPercent
          });
        }
      } catch (error) {
        console.log(`Error calculating BNB arbitrage for ${altcoin}:`, error);
      }
      
      // Path 2: USDT -> ALTCOIN -> BNB -> USDT
      try {
        const step1Amount = tradeAmount / altcoinUsdt.askPrice; // Buy ALTCOIN with USDT
        const step2Amount = step1Amount * altcoinBnb.bidPrice; // Sell ALTCOIN for BNB
        const step3Amount = step2Amount * bnbUsdt.bidPrice; // Sell BNB for USDT
        
        const profit = step3Amount - tradeAmount;
        const profitPercent = (profit / tradeAmount) * 100;
        
        if (profit > 0.01 && profitPercent > 0.005) { // Minimum $0.01 profit and 0.005%
          opportunities.push({
            base_symbol: 'USDT',
            intermediate_symbol: altcoin,
            quote_symbol: 'BNB',
            exchange1: 'binance',
            exchange2: 'binance',
            exchange3: 'binance',
            step1_action: 'BUY',
            step1_price: altcoinUsdt.askPrice,
            step1_amount: step1Amount,
            step2_action: 'SELL',
            step2_price: altcoinBnb.bidPrice,
            step2_amount: step1Amount,
            step3_action: 'SELL',
            step3_price: bnbUsdt.bidPrice,
            step3_amount: step2Amount,
            start_amount: tradeAmount,
            end_amount: step3Amount,
            profit_amount: profit,
            profit_percent: profitPercent
          });
        }
      } catch (error) {
        console.log(`Error calculating reverse BNB arbitrage for ${altcoin}:`, error);
      }
    }
  }
  
  return opportunities.sort((a, b) => b.profit_percent - a.profit_percent).slice(0, 5);
};

export default async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Authenticate: require valid JWT or service role
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const token = authHeader.replace('Bearer ', '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (token !== serviceKey) {
    // Verify as user JWT
    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });
    const { error: claimsErr } = await anonClient.auth.getClaims(token);
    if (claimsErr) {
      return new Response(JSON.stringify({ error: 'Invalid authentication' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }
  
  const { headers: reqHeaders } = req;
  const upgradeHeader = reqHeaders.get("upgrade") || "";

  if (upgradeHeader.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket connection", { status: 400 });
  }

  console.log('New WebSocket connection request');
  
  const { socket, response } = Deno.upgradeWebSocket(req);
  
  socket.onopen = () => {
    console.log('Client WebSocket connected');
    connectedClients.add(socket);
    
    // Initialize Binance connection if not already connected
    if (!binanceSocket || binanceSocket.readyState !== WebSocket.OPEN) {
      connectToBinance();
    }
    
    // Send current price data to new client
    if (priceData.size > 0) {
      const currentData = Array.from(priceData.values())
        .filter(ticker => ticker.s.includes('BNB'))
        .slice(0, 50); // Limit initial data
      
      socket.send(JSON.stringify({
        type: 'initial_data',
        data: currentData,
        timestamp: Date.now()
      }));
    }
  };
  
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      console.log('Received client message:', message);
      
      // Handle client requests
      if (message.type === 'subscribe_symbol') {
        // Could add symbol-specific subscriptions
        socket.send(JSON.stringify({
          type: 'subscribed',
          symbol: message.symbol,
          timestamp: Date.now()
        }));
      }
    } catch (error) {
      console.error('Error processing client message:', error);
    }
  };
  
  socket.onclose = () => {
    console.log('Client WebSocket disconnected');
    connectedClients.delete(socket);
    
    // Close Binance connection if no clients
    if (connectedClients.size === 0 && binanceSocket) {
      binanceSocket.close();
      binanceSocket = null;
    }
  };
  
  socket.onerror = (error) => {
    console.error('Client WebSocket error:', error);
    connectedClients.delete(socket);
  };

  return response;
};
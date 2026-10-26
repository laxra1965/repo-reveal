import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logInfo, logError, logDebug } from '../utils/logger.ts';
import { standardizeSymbol, findBNBTriangularArbitrage } from '../utils/arbitrage.ts';
import { adaptLegacyTriangular } from '../utils/opportunity-adapter.ts';
import { enqueueStandardOpportunities } from '../utils/opportunity-buffer.ts';
import { orderBookEngine } from '../utils/order-book-engine.ts';

// Import Exchange Sync Managers
import { BybitSync } from './exchanges/bybit-sync.ts';
import { KuCoinSync } from './exchanges/kucoin-sync.ts';
import { MexcSync } from './exchanges/mexc-sync.ts';
import { GateSync } from './exchanges/gate-sync.ts';

// Configuration
const SYMBOLS_TO_TRACK = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOTUSDT', 'POLUSDT'];
const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws';

// Store active price data (exported for other processes to read)
export const priceData: Map<string, any> = new Map();
let connectedClients: Set<WebSocket> = new Set();

/**
 * Update global priceData for legacy scanners
 */
function updateGlobalPriceCache(exchange: string, symbol: string) {
    const book = orderBookEngine.getSnapshot(exchange, symbol);
    if (book && book.bids.length > 0 && book.asks.length > 0) {
        // We use symbol:exchange as key to avoid collisions if multiple exchanges track the same symbol
        const cacheKey = exchange === 'binance' ? symbol : `${symbol}:${exchange}`;
        priceData.set(cacheKey, {
            s: symbol,
            ex: exchange,
            b: book.bids[0].price.toString(),
            a: book.asks[0].price.toString(),
            timestamp: book.timestamp
        });
    }
}

/**
 * Binance Depth Stream Manager
 * Handles snapshot sync and delta sequencing
 */
class BinanceDepthSync {
  private ws: WebSocket | null = null;
  private messageBuffer: Map<string, any[]> = new Map();
  private isSyncing: Map<string, boolean> = new Map();

  constructor(private symbols: string[]) {}

  async connect() {
    logInfo('binance-ws', `Connecting to Binance Depth Streams for ${this.symbols.length} symbols...`);
    
    this.ws = new WebSocket(BINANCE_WS_URL);

    this.ws.onopen = () => {
      logInfo('binance-ws', 'WebSocket connected');
      this.subscribe();
    };

    this.ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      if (data.e === 'depthUpdate') {
        await this.handleDepthUpdate(data);
      }
    };

    this.ws.onclose = () => {
      logInfo('binance-ws', 'WebSocket closed, reconnecting...');
      setTimeout(() => this.connect(), 5000);
    };

    this.ws.onerror = (error) => {
      logError('binance-ws', 'WebSocket error', { error });
    };
  }

  private subscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const streams = this.symbols.map(s => `${s.toLowerCase()}@depth@100ms`);
    
    this.ws.send(JSON.stringify({
      method: "SUBSCRIBE",
      params: streams,
      id: 1
    }));

    this.symbols.forEach(s => {
      this.messageBuffer.set(s, []);
      this.isSyncing.set(s, true);
      this.syncSnapshot(s);
    });
  }

  private async syncSnapshot(symbol: string) {
    try {
      logInfo('binance-ws', `Fetching snapshot for ${symbol}...`);
      const book = await orderBookEngine.fetchOrderBook('binance', symbol, false);
      
      if (book) {
        logInfo('binance-ws', `Snapshot synced for ${symbol} at sequence ${book.sequence}`);
        this.isSyncing.set(symbol, false);
        
        // Process buffered messages
        const buffer = this.messageBuffer.get(symbol) || [];
        for (const msg of buffer) {
          await this.processUpdate(symbol, msg);
        }
        this.messageBuffer.set(symbol, []);
      }
    } catch (error) {
      logError('binance-ws', `Failed to sync snapshot for ${symbol}`, { error });
      setTimeout(() => this.syncSnapshot(symbol), 5000);
    }
  }

  private async handleDepthUpdate(data: any) {
    const symbol = data.s;
    if (this.isSyncing.get(symbol)) {
      this.messageBuffer.get(symbol)?.push(data);
    } else {
      await this.processUpdate(symbol, data);
    }
  }

  private async processUpdate(symbol: string, data: any) {
    const bids: Array<[number, number]> = data.b.map((b: any) => [parseFloat(b[0]), parseFloat(b[1])]);
    const asks: Array<[number, number]> = data.a.map((a: any) => [parseFloat(a[0]), parseFloat(a[1])]);
    
    // Binance sequence: 'u' is final update ID, 'U' is first update ID
    const success = orderBookEngine.updateOrderBook(
      'binance',
      symbol,
      bids,
      asks,
      data.u,
      data.E, // Event time
      data.U  // First update ID
    );

    if (!success) {
      logError('binance-ws', `Sequence out of sync for ${symbol}, resyncing...`);
      this.isSyncing.set(symbol, true);
      this.messageBuffer.set(symbol, []);
      await this.syncSnapshot(symbol);
    } else {
      // Update global price cache
      updateGlobalPriceCache('binance', symbol);
    }
  }
}

// Initialize Sync Managers for all exchanges
const binanceSync = new BinanceDepthSync(SYMBOLS_TO_TRACK);
const bybitSync = new BybitSync(SYMBOLS_TO_TRACK);
const kucoinSync = new KuCoinSync(SYMBOLS_TO_TRACK);
const mexcSync = new MexcSync(SYMBOLS_TO_TRACK);
const gateSync = new GateSync(SYMBOLS_TO_TRACK);

// Connect all
binanceSync.connect();
bybitSync.connect();
kucoinSync.connect();
mexcSync.connect();
gateSync.connect();

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

// Broadcast message to all connected clients
const broadcastToClients = (message: string) => {
  connectedClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (error) {
        logError('binance-websocket', 'Error sending to client', { error });
        connectedClients.delete(client);
      }
    } else {
      connectedClients.delete(client);
    }
  });
};

export default async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const upgradeHeader = req.headers.get("upgrade") || "";
  if (upgradeHeader.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket connection", { status: 400 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.onopen = () => {
    logInfo('binance-websocket', 'Client WebSocket connected');
    connectedClients.add(socket);
  };

  socket.onclose = () => {
    logInfo('binance-websocket', 'Client WebSocket disconnected');
    connectedClients.delete(socket);
  };

  return response;
};
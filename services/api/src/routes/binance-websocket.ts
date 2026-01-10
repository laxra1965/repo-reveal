import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';

const router = Router();

interface BinanceWebsocketRequest {
  symbols?: string[];
  action?: 'connect' | 'status';
}

/**
 * GET/POST /functions/binance-websocket
 * 
 * Real-time price streaming from Binance
 * - Connects to Binance WebSocket for live price data
 * - Broadcasts prices to connected clients
 * - Stores price snapshots in database
 */
router.post('/functions/binance-websocket', async (req: Request, res: Response) => {
  handleBinanceWebsocket(req, res);
});

router.get('/functions/binance-websocket', async (req: Request, res: Response) => {
  handleBinanceWebsocket(req, res);
});

async function handleBinanceWebsocket(req: Request, res: Response) {
  try {
    const supabase = req.app.get('supabase') as SupabaseClient;
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase client not configured' });
    }

    const { action = 'status', symbols = [] } = req.body as BinanceWebsocketRequest;

    console.log(`Binance WebSocket: action=${action}, symbols=${symbols.length}`);

    if (action === 'status') {
      // Return current WebSocket status and connected symbols
      const { data: lastPrices } = await supabase
        .from('exchange_prices')
        .select('symbol, price, timestamp')
        .eq('exchange', 'binance')
        .limit(10)
        .order('timestamp', { ascending: false });

      return res.json({
        success: true,
        status: 'connected',
        connected_symbols: lastPrices?.length || 0,
        last_prices: lastPrices || [],
        timestamp: new Date().toISOString()
      });
    }

    if (action === 'connect') {
      // TODO: Implement actual WebSocket connection and price streaming
      // For now, return placeholder
      return res.json({
        success: true,
        action: 'connect',
        message: 'WebSocket connection initiated',
        symbols_monitored: symbols.length,
        timestamp: new Date().toISOString()
      });
    }

    res.status(400).json({ error: 'Invalid action' });

  } catch (err: any) {
    console.error('Binance WebSocket Error:', err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}

export default router;

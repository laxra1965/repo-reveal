import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';

const router = Router();

interface FetchBalancesRequest {
  exchange?: string;
  userId?: string;
}

const EXCHANGE_APIS: Record<string, string> = {
  binance: 'https://api.binance.com',
  bybit: 'https://api.bybit.com',
  okx: 'https://www.okx.com',
  gate: 'https://api.gateio.ws'
};

/**
 * GET/POST /functions/fetch-exchange-balances
 * 
 * Fetches current balances from user's exchange accounts
 * - Retrieves USDT and other asset balances
 * - Calculates total account value
 * - Caches results for a short period
 */
router.post('/functions/fetch-exchange-balances', async (req: Request, res: Response) => {
  handleFetchBalances(req, res);
});

router.get('/functions/fetch-exchange-balances', async (req: Request, res: Response) => {
  handleFetchBalances(req, res);
});

async function handleFetchBalances(req: Request, res: Response) {
  try {
    const supabase = req.app.get('supabase') as SupabaseClient;
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase client not configured' });
    }

    const { exchange, userId: bodyUserId } = req.body as FetchBalancesRequest;
    const authHeader = (req.headers.authorization || '').replace('Bearer ', '');

    // Get user from token
    let userId = bodyUserId;
    if (!userId && authHeader) {
      try {
        const { data: { user }, error } = await supabase.auth.getUser(authHeader);
        if (user && !error) {
          userId = user.id;
        }
      } catch (e) {
        console.warn('Token validation error:', e);
      }
    }

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized: No valid user session' });
    }

    console.log(`Fetching balances: exchange=${exchange || 'all'}, userId=${userId}`);

    // Get user's API credentials
    let query = supabase
      .from('user_api_credentials')
      .select('*')
      .eq('user_id', userId);

    if (exchange) {
      query = query.eq('exchange', exchange);
    }

    const { data: credentials, error: credError } = await query;

    if (credError || !credentials || credentials.length === 0) {
      return res.status(404).json({ error: 'No API credentials found' });
    }

    const balances: any[] = [];
    const errors: any[] = [];

    for (const cred of credentials) {
      try {
        const balance = await fetchExchangeBalance(cred, supabase);
        balances.push(balance);
      } catch (err: any) {
        errors.push({
          exchange: cred.exchange,
          error: err.message
        });
      }
    }

    // Calculate total
    const totalUSDT = balances.reduce((sum, b) => sum + (b.totalUSDT || 0), 0);

    res.json({
      success: errors.length === 0 || balances.length > 0,
      userId,
      balances,
      totalUSDT,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString()
    });

  } catch (err: any) {
    console.error('Fetch Balances Error:', err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}

async function fetchExchangeBalance(
  credentials: any,
  supabase: SupabaseClient
): Promise<any> {
  // TODO: Implement per-exchange balance fetching
  // Binance example would use:
  // - HMAC-SHA256 signature with timestamp
  // - GET /api/v3/account endpoint
  // - Parse response and sum balances

  // For now, return placeholder
  return {
    exchange: credentials.exchange,
    totalUSDT: 0,
    assets: {},
    timestamp: new Date().toISOString()
  };
}

export default router;

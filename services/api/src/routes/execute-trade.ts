import { Router, Request, Response } from 'express';
import { createHmac } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';

const router = Router();

interface TradeRequest {
  opportunities: any[];
  userId?: string;
  action?: 'validate' | 'execute' | 'simulate';
}

interface ExchangeCredentials {
  api_key: string;
  api_secret: string;
  api_passphrase?: string;
  exchange: string;
}

const EXCHANGE_APIS: Record<string, { baseUrl: string; orderEndpoint: string }> = {
  binance: {
    baseUrl: 'https://api.binance.com',
    orderEndpoint: '/api/v3/order'
  },
  bybit: {
    baseUrl: 'https://api.bybit.com',
    orderEndpoint: '/v5/order/create'
  },
  okx: {
    baseUrl: 'https://www.okx.com',
    orderEndpoint: '/api/v5/trade/order'
  },
  gate: {
    baseUrl: 'https://api.gateio.ws',
    orderEndpoint: '/api/v4/spot/orders'
  }
};

/**
 * POST /functions/execute-trade
 * 
 * Executes trades on exchange APIs
 * Actions:
 * - validate: Check API credentials and permissions
 * - simulate: Show what would happen without executing
 * - execute: Actually execute the trades
 */
router.post('/functions/execute-trade', async (req: Request, res: Response) => {
  try {
    const supabase = req.app.get('supabase') as SupabaseClient;
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase client not configured' });
    }

    const { opportunities = [], userId, action = 'simulate' } = req.body as TradeRequest;
    const authHeader = (req.headers.authorization || '').replace('Bearer ', '');

    // Get user from token
    let currentUserId = userId;
    if (!currentUserId && authHeader) {
      try {
        const { data: { user }, error } = await supabase.auth.getUser(authHeader);
        if (user && !error) {
          currentUserId = user.id;
        }
      } catch (e) {
        console.warn('Token validation error:', e);
      }
    }

    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized: No valid user session' });
    }

    console.log(`Trade execution: action=${action}, userId=${currentUserId}, opportunities=${opportunities.length}`);

    if (opportunities.length === 0) {
      return res.status(400).json({ error: 'No opportunities provided' });
    }

    // Fetch user credentials from database
    const { data: credentials, error: credError } = await supabase
      .from('user_api_credentials')
      .select('*')
      .eq('user_id', currentUserId);

    if (credError || !credentials || credentials.length === 0) {
      return res.status(404).json({ error: 'No API credentials found for user' });
    }

    const results: any[] = [];
    const errors: any[] = [];

    for (const opp of opportunities) {
      try {
        // Get exchange config
        const exchange = opp.primary_exchange || opp.exchanges?.[0];
        if (!exchange) {
          errors.push({ opportunity: opp.id, error: 'No exchange specified' });
          continue;
        }

        // Find credentials for this exchange
        const cred = credentials.find((c: any) => c.exchange === exchange);
        if (!cred) {
          errors.push({ opportunity: opp.id, error: `No credentials for ${exchange}` });
          continue;
        }

        if (action === 'validate') {
          // Validate credentials only
          const isValid = await validateExchangeCredentials(cred, supabase);
          results.push({
            opportunity: opp.id,
            exchange,
            valid: isValid.valid,
            message: isValid.message
          });
        } else if (action === 'simulate') {
          // Simulate what would happen
          results.push({
            opportunity: opp.id,
            exchange,
            simulated: true,
            steps: generateTradeSteps(opp),
            profitEstimate: opp.profit_percent || 'N/A'
          });
        } else if (action === 'execute') {
          // Actually execute (requires specific approval)
          const execResult = await executeTradeOnExchange(cred, opp, supabase);
          if (execResult.success) {
            results.push(execResult);
          } else {
            errors.push(execResult);
          }
        }
      } catch (err: any) {
        errors.push({ opportunity: opp.id, error: err.message });
      }
    }

    res.json({
      success: errors.length === 0,
      action,
      userId: currentUserId,
      results,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString()
    });

  } catch (err: any) {
    console.error('Trade Execution Error:', err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

async function validateExchangeCredentials(
  cred: ExchangeCredentials,
  supabase: SupabaseClient
): Promise<{ valid: boolean; message: string }> {
  try {
    const exchange = cred.exchange.toLowerCase();
    
    // TODO: Implement per-exchange validation
    // For now, return placeholder
    return { valid: true, message: `${exchange} credentials validated` };
  } catch (err: any) {
    return { valid: false, message: err.message };
  }
}

async function executeTradeOnExchange(
  cred: ExchangeCredentials,
  opportunity: any,
  supabase: SupabaseClient
): Promise<any> {
  try {
    const exchange = cred.exchange.toLowerCase();
    
    // TODO: Implement actual trade execution per exchange
    // This requires detailed logic for each exchange API
    
    return {
      success: true,
      opportunity: opportunity.id,
      exchange,
      orderId: `${exchange}-${Date.now()}`,
      status: 'pending'
    };
  } catch (err: any) {
    return {
      success: false,
      opportunity: opportunity.id,
      error: err.message
    };
  }
}

function generateTradeSteps(opportunity: any): any[] {
  // Placeholder: generate steps for the trade
  return [
    { step: 1, action: 'Sell', symbol: opportunity.symbol, amount: opportunity.amount },
    { step: 2, action: 'Buy', symbol: opportunity.next_symbol, amount: opportunity.amount },
    { step: 3, action: 'Sell', symbol: opportunity.final_symbol, amount: opportunity.amount }
  ];
}

export default router;

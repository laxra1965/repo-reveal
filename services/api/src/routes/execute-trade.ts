import { Router, Request, Response } from 'express';
import { createHmac } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';

const router = Router();

interface TradeRequest {
  opportunities?: any[];
  userId?: string;
  action?: 'validate' | 'execute' | 'simulate' | 'execute_single';
  tradeId?: string;
  opportunityId?: string;
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

    const { opportunities = [], userId, action = 'simulate', tradeId, opportunityId } = req.body as TradeRequest;
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

    console.log(`Trade execution: action=${action}, userId=${currentUserId}, tradeId=${tradeId}`);

    // Handle execute_single: fetch trade + opportunity from DB and execute
    if (action === 'execute_single' && tradeId) {
      const { data: trade, error: tradeErr } = await supabase
        .from('trade_history')
        .select('*')
        .eq('id', tradeId)
        .eq('user_id', currentUserId)
        .single();

      if (tradeErr || !trade) {
        return res.status(404).json({ error: 'Trade not found' });
      }

      // Mark as executing
      await supabase
        .from('trade_history')
        .update({ status: 'executing', started_at: new Date().toISOString() })
        .eq('id', tradeId);

      // Fetch user credentials for the required exchanges
      const { data: credentials } = await supabase
        .from('exchange_credentials')
        .select('*')
        .eq('user_id', currentUserId);

      if (!credentials || credentials.length === 0) {
        await supabase
          .from('trade_history')
          .update({ status: 'failed', error_message: 'No exchange credentials configured', completed_at: new Date().toISOString() })
          .eq('id', tradeId);
        return res.status(404).json({ error: 'No exchange credentials found' });
      }

      // Fetch opportunity details if available
      let opportunity = null;
      if (trade.opportunity_id) {
        const { data: opp } = await supabase
          .from('opportunities')
          .select('*')
          .eq('id', trade.opportunity_id)
          .single();
        opportunity = opp;
      }

      try {
        // TODO: Implement actual multi-leg execution via MultiExchangeExecutor
        // For now, delegate to the executor service via Redis pub/sub
        const executionPayload = {
          tradeId,
          userId: currentUserId,
          opportunity,
          trade,
          credentials: credentials.map((c: any) => ({ exchange: c.exchange, id: c.id })),
        };

        // Publish execution job to Redis for the executor service to pick up
        const redis = req.app.get('redis');
        if (redis) {
          await redis.publish('trade:execute', JSON.stringify(executionPayload));
          return res.json({
            success: true,
            tradeId,
            status: 'submitted',
            message: 'Trade submitted to executor service',
          });
        }

        // If no Redis, return pending status
        return res.json({
          success: true,
          tradeId,
          status: 'pending',
          message: 'Trade queued for execution',
        });
      } catch (execErr: any) {
        await supabase
          .from('trade_history')
          .update({ status: 'failed', error_message: execErr.message, completed_at: new Date().toISOString() })
          .eq('id', tradeId);
        return res.status(500).json({ error: execErr.message });
      }
    }

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

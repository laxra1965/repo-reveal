import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import ccxt from 'https://esm.sh/ccxt@4.1.17';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper interfaces
interface ExecutionResult {
  success: boolean;
  orderId?: string;
  executedPrice?: number;
  executedAmount?: number;
  fee?: number;
  error?: string;
}

// Trade executor using CCXT
class TradeExecutor {
  constructor(
    private supabase: any,
    private userId: string,
    private maxTradeAmount: number
  ) {}

  /**
   * Initialize and configure the specific CCXT exchange client
   */
  private async getExchangeClient(exchangeName: string) {
    // 1. Fetch credentials from DB
    const { data: credential } = await this.supabase
      .from('exchange_credentials')
      .select('*')
      .eq('user_id', this.userId)
      .eq('exchange', exchangeName)
      .eq('is_connected', true)
      .single();

    if (!credential) {
      throw new Error(`No credentials found for ${exchangeName}`);
    }

    // 2. Check if exchange exists in CCXT
    const exchangeId = exchangeName.toLowerCase();
    if (!ccxt[exchangeId]) {
      throw new Error(`Exchange ${exchangeName} is not supported by CCXT lib`);
    }

    // 3. Initialize Client
    const exchange = new ccxt[exchangeId]({
      apiKey: credential.api_key,
      secret: credential.api_secret,
      enableRateLimit: true, // Crucial for stability
      options: { defaultType: 'spot' }
    });

    // 4. Handle Sandbox/Testnet modes
    if (credential.test_mode) {
      exchange.setSandboxMode(true);
    }

    return exchange;
  }

  /**
   * Helper to execute a single CCXT Market Order
   */
  private async executeStep(
    exchangeName: string,
    symbol: string,
    side: 'buy' | 'sell',
    amount: number
  ): Promise<ExecutionResult> {
    try {
      const client = await this.getExchangeClient(exchangeName);
      
      // CCXT expects symbols like 'BTC/USDT', ensure slash exists
      // If incoming is 'BTCUSDT', this might need adjustment depending on data source,
      // but assuming we construct it with slashes in executeTrade.
      
      const order = await client.createMarketOrder(symbol, side, amount);

      // Wait for order to fill if needed or just return result
      // For some exchanges, we might want to fetch the order result again to get exact 'filled' status
      // But for speed, we usually rely on the response.
      
      return {
        success: true,
        orderId: order.id,
        executedPrice: order.average || order.price,
        executedAmount: order.filled || order.amount,
        fee: order.fee ? order.fee.cost : 0
      };
    } catch (err: any) {
      console.error(`Order failed on ${exchangeName}:`, err.message);
      return {
        success: false,
        error: err.message
      };
    }
  }

  async executeTrade(opportunity: any): Promise<any> {
    // 1. Create initial trade history record
    const { data: tradeRecord, error: tradeError } = await this.supabase
      .from('trade_history')
      .insert({
        user_id: this.userId,
        opportunity_id: opportunity.id,
        status: 'executing',
        base_symbol: opportunity.base_symbol,
        quote_symbol: opportunity.quote_symbol,
        intermediate_symbol: opportunity.intermediate_symbol,
        start_amount: opportunity.start_amount,
        expected_profit: opportunity.profit_amount,
        total_steps: 3,
        completed_steps: 0,
        execution_details: {},
      })
      .select()
      .single();

    if (tradeError) {
      throw new Error(`Failed to create trade record: ${tradeError.message}`);
    }

    const tradeId = tradeRecord.id;
    const executionDetails: any = {
      steps: [],
      startTime: new Date().toISOString(),
    };

    try {
      // Validate trade amount against position limit (Subscription check)
      if (opportunity.start_amount > this.maxTradeAmount) {
        throw new Error(
          `Trade amount $${opportunity.start_amount} exceeds position limit $${this.maxTradeAmount}`
        );
      }

      // --- STEP 1 ---
      const sym1 = `${opportunity.base_symbol}/${opportunity.intermediate_symbol}`;
      const side1 = opportunity.step1_action.toLowerCase();
      
      console.log(`Executing Step 1: ${side1} ${sym1} on ${opportunity.exchange1}`);
      
      const step1Result = await this.executeStep(
        opportunity.exchange1,
        sym1,
        side1,
        opportunity.step1_amount
      );

      if (!step1Result.success) throw new Error(`Step 1 failed: ${step1Result.error}`);

      executionDetails.steps.push({
        step: 1,
        action: side1,
        symbol: sym1,
        exchange: opportunity.exchange1,
        orderId: step1Result.orderId,
        expectedPrice: opportunity.step1_price,
        executedPrice: step1Result.executedPrice,
        executedAmount: step1Result.executedAmount,
        timestamp: new Date().toISOString(),
      });

      await this.supabase.from('trade_history').update({ 
        completed_steps: 1,
        execution_details: executionDetails 
      }).eq('id', tradeId);

      // --- STEP 2 ---
      const sym2 = `${opportunity.intermediate_symbol}/${opportunity.quote_symbol}`;
      const side2 = opportunity.step2_action.toLowerCase();

      console.log(`Executing Step 2: ${side2} ${sym2} on ${opportunity.exchange2}`);

      const step2Result = await this.executeStep(
        opportunity.exchange2,
        sym2,
        side2,
        opportunity.step2_amount
      );

      if (!step2Result.success) throw new Error(`Step 2 failed: ${step2Result.error}`);

      executionDetails.steps.push({
        step: 2,
        action: side2,
        symbol: sym2,
        exchange: opportunity.exchange2,
        orderId: step2Result.orderId,
        expectedPrice: opportunity.step2_price,
        executedPrice: step2Result.executedPrice,
        executedAmount: step2Result.executedAmount,
        timestamp: new Date().toISOString(),
      });

      await this.supabase.from('trade_history').update({ 
        completed_steps: 2,
        execution_details: executionDetails 
      }).eq('id', tradeId);

      // --- STEP 3 ---
      const sym3 = `${opportunity.base_symbol}/${opportunity.quote_symbol}`;
      const side3 = opportunity.step3_action.toLowerCase();

      console.log(`Executing Step 3: ${side3} ${sym3} on ${opportunity.exchange3}`);

      const step3Result = await this.executeStep(
        opportunity.exchange3,
        sym3,
        side3,
        opportunity.step3_amount
      );

      if (!step3Result.success) throw new Error(`Step 3 failed: ${step3Result.error}`);

      executionDetails.steps.push({
        step: 3,
        action: side3,
        symbol: sym3,
        exchange: opportunity.exchange3,
        orderId: step3Result.orderId,
        expectedPrice: opportunity.step3_price,
        executedPrice: step3Result.executedPrice,
        executedAmount: step3Result.executedAmount,
        timestamp: new Date().toISOString(),
      });

      // --- CALCULATION ---
      // Calculate actual profit based on the final step execution
      // This assumes the last step converts back to the start currency
      const finalAmount = (step3Result.executedAmount || 0) * (step3Result.executedPrice || 0);
      const actualProfit = finalAmount - opportunity.start_amount;
      
      executionDetails.endTime = new Date().toISOString();
      executionDetails.finalAmount = finalAmount;
      executionDetails.actualProfit = actualProfit;

      // Update trade record as completed
      await this.supabase
        .from('trade_history')
        .update({
          status: 'completed',
          completed_steps: 3,
          final_amount: finalAmount,
          actual_profit: actualProfit,
          execution_details: executionDetails,
          completed_at: new Date().toISOString(),
        })
        .eq('id', tradeId);

      // Log success to scanner_logs
      await this.supabase
        .from('scanner_logs')
        .insert({
          user_id: this.userId,
          log_type: 'trade',
          message: `Trade completed successfully. Profit: $${actualProfit.toFixed(2)}`,
          details: {
            tradeId,
            opportunityId: opportunity.id,
            expectedProfit: opportunity.profit_amount,
            actualProfit,
          },
        });

      return {
        success: true,
        tradeId,
        actualProfit,
        executionDetails,
      };

    } catch (error: any) {
      // Update trade record as failed
      executionDetails.error = error.message;
      executionDetails.endTime = new Date().toISOString();

      await this.supabase
        .from('trade_history')
        .update({
          status: 'failed',
          error_message: error.message,
          execution_details: executionDetails,
          completed_at: new Date().toISOString(),
        })
        .eq('id', tradeId);

      // Log error
      await this.supabase
        .from('scanner_logs')
        .insert({
          user_id: this.userId,
          log_type: 'error',
          message: `Trade execution failed: ${error.message}`,
          details: {
            tradeId,
            opportunityId: opportunity.id,
            error: error.message,
            executionDetails,
          },
        });

      throw error;
    }
  }
}

// Main Server Handler
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize Supabase Admin
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Auth Check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
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

    // 2. Parse Request
    const { opportunityId } = await req.json();

    if (!opportunityId) {
      return new Response(JSON.stringify({ error: 'Missing opportunityId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Check Subscription & Limits
    const { data: subscription } = await supabase
      .from('user_subscriptions')
      .select(`
        *,
        subscription_plans (
          name,
          price,
          duration_type
        )
      `)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .gte('end_date', new Date().toISOString())
      .single();

    if (!subscription) {
      return new Response(
        JSON.stringify({ error: 'No active subscription found' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Determine max trade amount based on tier
    const tierName = subscription.subscription_plans?.name || '';
    let maxTradeAmount = 100; // Default for basic

    if (tierName.includes('Tier 1') || tierName.includes('Scanner Only')) {
      return new Response(
        JSON.stringify({ error: 'Trade execution requires Tier 2 or Tier 3 subscription' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } else if (tierName.includes('Tier 2') || tierName.includes('$500')) {
      maxTradeAmount = 500;
    } else if (tierName.includes('Tier 3') || tierName.includes('$1,000')) {
      maxTradeAmount = 1000;
    }

    // 4. Fetch Opportunity Details
    const { data: opportunity, error: oppError } = await supabase
      .from('arbitrage_opportunities')
      .select('*')
      .eq('id', opportunityId)
      .gt('expires_at', new Date().toISOString()) // Ensure not expired
      .single();

    if (oppError || !opportunity) {
      return new Response(
        JSON.stringify({ error: 'Opportunity not found or expired' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // 5. Execute Trade
    const executor = new TradeExecutor(supabase, user.id, maxTradeAmount);
    const result = await executor.executeTrade(opportunity);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Trade execution error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        success: false 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

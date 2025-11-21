import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TradeStep {
  action: 'BUY' | 'SELL';
  symbol: string;
  price: number;
  amount: number;
  exchange: string;
}

interface ExecutionResult {
  success: boolean;
  orderId?: string;
  executedPrice?: number;
  executedAmount?: number;
  error?: string;
}

// Exchange API implementations
class BinanceAPI {
  constructor(
    private apiKey: string,
    private apiSecret: string,
    private testMode: boolean = false
  ) {}

  private getBaseUrl(): string {
    return this.testMode 
      ? 'https://testnet.binance.vision/api'
      : 'https://api.binance.com/api';
  }

  private sign(params: Record<string, any>): string {
    const queryString = Object.entries(params)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
    
    return createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
  }

  async placeOrder(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number
  ): Promise<ExecutionResult> {
    try {
      const timestamp = Date.now();
      const params = {
        symbol,
        side,
        type: 'MARKET',
        quantity: quantity.toFixed(8),
        timestamp,
      };

      const signature = this.sign(params);
      const queryString = Object.entries({ ...params, signature })
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');

      const response = await fetch(
        `${this.getBaseUrl()}/v3/order?${queryString}`,
        {
          method: 'POST',
          headers: {
            'X-MBX-APIKEY': this.apiKey,
          },
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Binance API error: ${error}`);
      }

      const data = await response.json();
      
      return {
        success: true,
        orderId: data.orderId,
        executedPrice: parseFloat(data.fills?.[0]?.price || data.price || '0'),
        executedAmount: parseFloat(data.executedQty || '0'),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async getBalance(asset: string): Promise<number> {
    try {
      const timestamp = Date.now();
      const params = { timestamp };
      const signature = this.sign(params);

      const response = await fetch(
        `${this.getBaseUrl()}/v3/account?timestamp=${timestamp}&signature=${signature}`,
        {
          headers: {
            'X-MBX-APIKEY': this.apiKey,
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch balance');
      }

      const data = await response.json();
      const balance = data.balances.find((b: any) => b.asset === asset);
      
      return parseFloat(balance?.free || '0');
    } catch (error) {
      console.error('Error fetching Binance balance:', error);
      return 0;
    }
  }
}

class BybitAPI {
  constructor(
    private apiKey: string,
    private apiSecret: string,
    private testMode: boolean = false
  ) {}

  private getBaseUrl(): string {
    return this.testMode
      ? 'https://api-testnet.bybit.com'
      : 'https://api.bybit.com';
  }

  private sign(params: string, timestamp: string): string {
    const signString = timestamp + this.apiKey + '5000' + params;
    return createHmac('sha256', this.apiSecret)
      .update(signString)
      .digest('hex');
  }

  async placeOrder(
    symbol: string,
    side: 'Buy' | 'Sell',
    quantity: number
  ): Promise<ExecutionResult> {
    try {
      const timestamp = Date.now().toString();
      const params = JSON.stringify({
        category: 'spot',
        symbol,
        side,
        orderType: 'Market',
        qty: quantity.toString(),
      });

      const signature = this.sign(params, timestamp);

      const response = await fetch(
        `${this.getBaseUrl()}/v5/order/create`,
        {
          method: 'POST',
          headers: {
            'X-BAPI-API-KEY': this.apiKey,
            'X-BAPI-SIGN': signature,
            'X-BAPI-TIMESTAMP': timestamp,
            'X-BAPI-RECV-WINDOW': '5000',
            'Content-Type': 'application/json',
          },
          body: params,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Bybit API error: ${error}`);
      }

      const data = await response.json();
      
      if (data.retCode !== 0) {
        throw new Error(data.retMsg);
      }

      return {
        success: true,
        orderId: data.result.orderId,
        executedPrice: parseFloat(data.result.avgPrice || '0'),
        executedAmount: parseFloat(data.result.cumExecQty || '0'),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async getBalance(asset: string): Promise<number> {
    try {
      const timestamp = Date.now().toString();
      const params = `accountType=UNIFIED&timestamp=${timestamp}`;
      const signature = this.sign(params, timestamp);

      const response = await fetch(
        `${this.getBaseUrl()}/v5/account/wallet-balance?${params}`,
        {
          headers: {
            'X-BAPI-API-KEY': this.apiKey,
            'X-BAPI-SIGN': signature,
            'X-BAPI-TIMESTAMP': timestamp,
            'X-BAPI-RECV-WINDOW': '5000',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch balance');
      }

      const data = await response.json();
      
      if (data.retCode !== 0) {
        throw new Error(data.retMsg);
      }

      const coin = data.result?.list?.[0]?.coin?.find((c: any) => c.coin === asset);
      return parseFloat(coin?.walletBalance || '0');
    } catch (error) {
      console.error('Error fetching Bybit balance:', error);
      return 0;
    }
  }
}

// Trade executor
class TradeExecutor {
  constructor(
    private supabase: any,
    private userId: string,
    private maxTradeAmount: number
  ) {}

  private async getExchangeAPI(exchange: string) {
    const { data: credential } = await this.supabase
      .from('exchange_credentials')
      .select('*')
      .eq('user_id', this.userId)
      .eq('exchange', exchange)
      .eq('is_connected', true)
      .single();

    if (!credential) {
      throw new Error(`No credentials found for ${exchange}`);
    }

    switch (exchange.toLowerCase()) {
      case 'binance':
        return new BinanceAPI(
          credential.api_key,
          credential.api_secret,
          credential.test_mode
        );
      case 'bybit':
        return new BybitAPI(
          credential.api_key,
          credential.api_secret,
          credential.test_mode
        );
      default:
        throw new Error(`Unsupported exchange: ${exchange}`);
    }
  }

  async executeTrade(opportunity: any): Promise<any> {
    // Create trade history record
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
      // Validate trade amount against position limit
      if (opportunity.start_amount > this.maxTradeAmount) {
        throw new Error(
          `Trade amount $${opportunity.start_amount} exceeds position limit $${this.maxTradeAmount}`
        );
      }

      // Step 1: Execute first trade
      console.log(`Executing Step 1: ${opportunity.step1_action} ${opportunity.base_symbol}${opportunity.intermediate_symbol}`);
      
      const api1 = await this.getExchangeAPI(opportunity.exchange1);
      const step1Result = await api1.placeOrder(
        `${opportunity.base_symbol}${opportunity.intermediate_symbol}`,
        opportunity.step1_action,
        opportunity.step1_amount
      );

      if (!step1Result.success) {
        throw new Error(`Step 1 failed: ${step1Result.error}`);
      }

      executionDetails.steps.push({
        step: 1,
        action: opportunity.step1_action,
        symbol: `${opportunity.base_symbol}${opportunity.intermediate_symbol}`,
        exchange: opportunity.exchange1,
        orderId: step1Result.orderId,
        expectedPrice: opportunity.step1_price,
        executedPrice: step1Result.executedPrice,
        expectedAmount: opportunity.step1_amount,
        executedAmount: step1Result.executedAmount,
        timestamp: new Date().toISOString(),
      });

      await this.supabase
        .from('trade_history')
        .update({ 
          completed_steps: 1,
          execution_details: executionDetails 
        })
        .eq('id', tradeId);

      // Step 2: Execute second trade
      console.log(`Executing Step 2: ${opportunity.step2_action} ${opportunity.intermediate_symbol}${opportunity.quote_symbol}`);
      
      const api2 = await this.getExchangeAPI(opportunity.exchange2);
      const step2Result = await api2.placeOrder(
        `${opportunity.intermediate_symbol}${opportunity.quote_symbol}`,
        opportunity.step2_action,
        opportunity.step2_amount
      );

      if (!step2Result.success) {
        throw new Error(`Step 2 failed: ${step2Result.error}`);
      }

      executionDetails.steps.push({
        step: 2,
        action: opportunity.step2_action,
        symbol: `${opportunity.intermediate_symbol}${opportunity.quote_symbol}`,
        exchange: opportunity.exchange2,
        orderId: step2Result.orderId,
        expectedPrice: opportunity.step2_price,
        executedPrice: step2Result.executedPrice,
        expectedAmount: opportunity.step2_amount,
        executedAmount: step2Result.executedAmount,
        timestamp: new Date().toISOString(),
      });

      await this.supabase
        .from('trade_history')
        .update({ 
          completed_steps: 2,
          execution_details: executionDetails 
        })
        .eq('id', tradeId);

      // Step 3: Execute third trade
      console.log(`Executing Step 3: ${opportunity.step3_action} ${opportunity.base_symbol}${opportunity.quote_symbol}`);
      
      const api3 = await this.getExchangeAPI(opportunity.exchange3);
      const step3Result = await api3.placeOrder(
        `${opportunity.base_symbol}${opportunity.quote_symbol}`,
        opportunity.step3_action,
        opportunity.step3_amount
      );

      if (!step3Result.success) {
        throw new Error(`Step 3 failed: ${step3Result.error}`);
      }

      executionDetails.steps.push({
        step: 3,
        action: opportunity.step3_action,
        symbol: `${opportunity.base_symbol}${opportunity.quote_symbol}`,
        exchange: opportunity.exchange3,
        orderId: step3Result.orderId,
        expectedPrice: opportunity.step3_price,
        executedPrice: step3Result.executedPrice,
        expectedAmount: opportunity.step3_amount,
        executedAmount: step3Result.executedAmount,
        timestamp: new Date().toISOString(),
      });

      // Calculate actual profit
      const finalAmount = step3Result.executedAmount! * step3Result.executedPrice!;
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

      // Log success
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
    } catch (error) {
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

// Main handler
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

    const { opportunityId } = await req.json();

    if (!opportunityId) {
      return new Response(JSON.stringify({ error: 'Missing opportunityId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check subscription and get position limit
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
    let maxTradeAmount = 100; // Default

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

    // Fetch opportunity
    const { data: opportunity, error: oppError } = await supabase
      .from('arbitrage_opportunities')
      .select('*')
      .eq('id', opportunityId)
      .gt('expires_at', new Date().toISOString())
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

    // Execute trade
    const executor = new TradeExecutor(supabase, user.id, maxTradeAmount);
    const result = await executor.executeTrade(opportunity);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
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

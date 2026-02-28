import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExchangeCredentials {
  api_key: string;
  api_secret: string;
  api_passphrase?: string;
  exchange: string;
  test_mode: boolean;
}

interface TradeStep {
  exchange: string;
  action: string;
  symbol: string;
  amount: number;
  price: number;
}

// Exchange API endpoints
const EXCHANGE_APIS: Record<string, { baseUrl: string; orderEndpoint: string; permissionsEndpoint?: string }> = {
  binance: {
    baseUrl: 'https://api.binance.com',
    orderEndpoint: '/api/v3/order',
    permissionsEndpoint: '/api/v3/account'
  },
  bybit: {
    baseUrl: 'https://api.bybit.com',
    orderEndpoint: '/v5/order/create',
    permissionsEndpoint: '/v5/user/query-api'
  },
  okx: {
    baseUrl: 'https://www.okx.com',
    orderEndpoint: '/api/v5/trade/order',
    permissionsEndpoint: '/api/v5/account/config'
  },
  gate: {
    baseUrl: 'https://api.gateio.ws',
    orderEndpoint: '/api/v4/spot/orders',
    permissionsEndpoint: '/api/v4/spot/accounts'
  }
};

// Friendly error messages for common API errors
function getHumanReadableError(error: string, exchange: string): string {
  const lowerError = error.toLowerCase();

  if (lowerError.includes('not authorized') || lowerError.includes('unauthorized') || lowerError.includes('permission') || lowerError.includes('api key')) {
    return `API key for ${exchange} doesn't have trading permissions. Please enable "Spot Trading" in your ${exchange} API settings.`;
  }
  if (lowerError.includes('invalid signature') || lowerError.includes('signature')) {
    return `Invalid API signature for ${exchange}. Please verify your API key and secret are correct.`;
  }
  if (lowerError.includes('insufficient') || lowerError.includes('balance')) {
    return `Insufficient balance on ${exchange} to execute this trade.`;
  }
  if (lowerError.includes('rate limit') || lowerError.includes('too many')) {
    return `Rate limit exceeded on ${exchange}. Please wait a moment before retrying.`;
  }
  if (lowerError.includes('ip') || lowerError.includes('whitelist')) {
    return `IP not whitelisted for ${exchange} API. Add your server IP to the API whitelist.`;
  }
  if (lowerError.includes('expired') || lowerError.includes('timestamp')) {
    return `Request timestamp issue with ${exchange}. This may be a temporary sync error.`;
  }
  if (lowerError.includes('minimum') || lowerError.includes('min qty') || lowerError.includes('lot size')) {
    return `Trade amount too small for ${exchange}. Try increasing the trade amount.`;
  }
  if (lowerError.includes('symbol') || lowerError.includes('pair')) {
    return `Trading pair not available on ${exchange}.`;
  }

  return `${exchange} error: ${error}`;
}

// Helper function to decrypt credentials if needed
async function decryptCredentials(supabaseUrl: string, supabaseServiceKey: string, credential: any): Promise<{ api_key: string; api_secret: string; api_passphrase?: string }> {
  if (credential.encrypted_api_key && credential.encrypted_api_secret) {
    console.log(`Decrypting credentials for ${credential.exchange}...`);

    // Use FUNCTIONS_URL if set (Hetzner), otherwise use Supabase URL
    const functionsUrl = Deno.env.get('FUNCTIONS_URL') || `${supabaseUrl}/functions/v1`;
    const encryptUrl = functionsUrl.includes('/functions/v1')
      ? `${functionsUrl}/encrypt-api-keys`
      : `${functionsUrl}/functions/encrypt-api-keys`;

    const response = await fetch(encryptUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'decrypt',
        encryptedKey: credential.encrypted_api_key,
        encryptedSecret: credential.encrypted_api_secret,
        encryptedPassphrase: credential.encrypted_api_passphrase
      })
    });

    const data = await response.json();
    return {
      api_key: data.apiKey,
      api_secret: data.apiSecret,
      api_passphrase: data.apiPassphrase
    };
  }

  return {
    api_key: credential.api_key,
    api_secret: credential.api_secret,
    api_passphrase: credential.api_passphrase
  };
}

// Validate API key permissions before trading
async function validateBinancePermissions(credentials: ExchangeCredentials): Promise<{ valid: boolean; canTrade: boolean; error?: string }> {
  try {
    const timestamp = Date.now();
    const params = new URLSearchParams({
      timestamp: timestamp.toString(),
      recvWindow: '5000'
    });

    const queryString = params.toString();
    const encoder = new TextEncoder();
    const keyData = encoder.encode(credentials.api_secret);
    const messageData = encoder.encode(queryString);

    const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, messageData);
    const signature = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    const response = await fetch(`${EXCHANGE_APIS.binance.baseUrl}/api/v3/account?${queryString}&signature=${signature}`, {
      headers: { 'X-MBX-APIKEY': credentials.api_key }
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.code === -2015) return { valid: false, canTrade: false, error: 'Invalid API key or IP not whitelisted' };
      if (data.code === -1022) return { valid: false, canTrade: false, error: 'Invalid API signature - check your secret key' };
      return { valid: false, canTrade: false, error: data.msg || 'API validation failed' };
    }

    return { valid: true, canTrade: data.canTrade === true };
  } catch (error) {
    return { valid: false, canTrade: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

async function validateBybitPermissions(credentials: ExchangeCredentials): Promise<{ valid: boolean; canTrade: boolean; error?: string }> {
  try {
    const timestamp = Date.now();
    const recvWindow = 5000;
    const signPayload = `${timestamp}${credentials.api_key}${recvWindow}`;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(credentials.api_secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signPayload));
    const signature = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    const response = await fetch(`${EXCHANGE_APIS.bybit.baseUrl}/v5/user/query-api`, {
      headers: {
        'X-BAPI-API-KEY': credentials.api_key,
        'X-BAPI-SIGN': signature,
        'X-BAPI-TIMESTAMP': timestamp.toString(),
        'X-BAPI-RECV-WINDOW': recvWindow.toString()
      }
    });

    const data = await response.json();

    if (data.retCode !== 0) {
      return { valid: false, canTrade: false, error: data.retMsg || 'API validation failed' };
    }

    const permissions = data.result?.permissions || {};
    const canSpotTrade = permissions.Spot?.includes('SpotTrade') || false;

    return { valid: true, canTrade: canSpotTrade };
  } catch (error) {
    return { valid: false, canTrade: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

async function validateExchangePermissions(exchange: string, credentials: ExchangeCredentials): Promise<{ valid: boolean; canTrade: boolean; error?: string }> {
  switch (exchange.toLowerCase()) {
    case 'binance':
      return validateBinancePermissions(credentials);
    case 'bybit':
      return validateBybitPermissions(credentials);
    default:
      // For other exchanges, assume valid if credentials exist (will fail on actual trade if invalid)
      return { valid: true, canTrade: true };
  }
}

// Execute order on Binance
async function executeBinanceOrder(
  credentials: ExchangeCredentials,
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  testMode: boolean
): Promise<{ success: boolean; orderId?: string; filledQty?: number; avgPrice?: number; error?: string; isPaperTrade?: boolean }> {
  try {
    const timestamp = Date.now();
    const params = new URLSearchParams({
      symbol: symbol.replace('/', ''),
      side,
      type: 'MARKET',
      quantity: quantity.toFixed(8),
      timestamp: timestamp.toString(),
      recvWindow: '5000'
    });

    const queryString = params.toString();

    // Generate signature
    const encoder = new TextEncoder();
    const keyData = encoder.encode(credentials.api_secret);
    const messageData = encoder.encode(queryString);

    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', key, messageData);
    const signature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const endpoint = testMode ? '/api/v3/order/test' : '/api/v3/order';
    const url = `${EXCHANGE_APIS.binance.baseUrl}${endpoint}?${queryString}&signature=${signature}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-MBX-APIKEY': credentials.api_key,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.msg || 'Binance order failed' };
    }

    if (testMode) {
      // Paper trading simulation - return simulated success
      console.log(`[PAPER TRADE] Binance ${side} ${quantity} ${symbol}`);
      const simulatedPrice = side === 'BUY' ? 1.001 : 0.999; // Simulate slight slippage
      return {
        success: true,
        orderId: `PAPER_${Date.now()}`,
        filledQty: quantity,
        avgPrice: simulatedPrice,
        isPaperTrade: true
      };
    }

    return {
      success: true,
      orderId: data.orderId?.toString(),
      filledQty: parseFloat(data.executedQty || quantity),
      avgPrice: parseFloat(data.fills?.[0]?.price || 0)
    };
  } catch (error) {
    console.error('Binance order error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Execute order on Bybit
async function executeBybitOrder(
  credentials: ExchangeCredentials,
  symbol: string,
  side: 'Buy' | 'Sell',
  quantity: number,
  testMode: boolean
): Promise<{ success: boolean; orderId?: string; filledQty?: number; avgPrice?: number; error?: string }> {
  try {
    const timestamp = Date.now();
    const recvWindow = 5000;

    const body = JSON.stringify({
      category: 'spot',
      symbol: symbol.replace('/', ''),
      side,
      orderType: 'Market',
      qty: quantity.toFixed(8)
    });

    // Generate signature
    const signPayload = `${timestamp}${credentials.api_key}${recvWindow}${body}`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(credentials.api_secret);
    const messageData = encoder.encode(signPayload);

    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', key, messageData);
    const signature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const url = `${EXCHANGE_APIS.bybit.baseUrl}${EXCHANGE_APIS.bybit.orderEndpoint}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-BAPI-API-KEY': credentials.api_key,
        'X-BAPI-SIGN': signature,
        'X-BAPI-TIMESTAMP': timestamp.toString(),
        'X-BAPI-RECV-WINDOW': recvWindow.toString(),
        'Content-Type': 'application/json'
      },
      body
    });

    const data = await response.json();

    if (data.retCode !== 0) {
      return { success: false, error: data.retMsg || 'Bybit order failed' };
    }

    return {
      success: true,
      orderId: data.result?.orderId,
      filledQty: quantity,
      avgPrice: 0
    };
  } catch (error) {
    console.error('Bybit order error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Execute order on OKX
async function executeOKXOrder(
  credentials: ExchangeCredentials,
  symbol: string,
  side: 'buy' | 'sell',
  quantity: number,
  testMode: boolean
): Promise<{ success: boolean; orderId?: string; filledQty?: number; avgPrice?: number; error?: string }> {
  try {
    const timestamp = new Date().toISOString();

    const body = JSON.stringify({
      instId: symbol.replace('/', '-'),
      tdMode: 'cash',
      side,
      ordType: 'market',
      sz: quantity.toFixed(8)
    });

    // Generate signature
    const signPayload = `${timestamp}POST/api/v5/trade/order${body}`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(credentials.api_secret);
    const messageData = encoder.encode(signPayload);

    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', key, messageData);
    const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

    const url = `${EXCHANGE_APIS.okx.baseUrl}${EXCHANGE_APIS.okx.orderEndpoint}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'OK-ACCESS-KEY': credentials.api_key,
        'OK-ACCESS-SIGN': signature,
        'OK-ACCESS-TIMESTAMP': timestamp,
        'OK-ACCESS-PASSPHRASE': credentials.api_passphrase || '',
        'Content-Type': 'application/json'
      },
      body
    });

    const data = await response.json();

    if (data.code !== '0') {
      return { success: false, error: data.msg || 'OKX order failed' };
    }

    return {
      success: true,
      orderId: data.data?.[0]?.ordId,
      filledQty: quantity,
      avgPrice: 0
    };
  } catch (error) {
    console.error('OKX order error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Execute order on Gate.io
async function executeGateOrder(
  credentials: ExchangeCredentials,
  symbol: string,
  side: 'buy' | 'sell',
  quantity: number,
  testMode: boolean
): Promise<{ success: boolean; orderId?: string; filledQty?: number; avgPrice?: number; error?: string; isPaperTrade?: boolean }> {
  try {
    // Gate.io paper trade simulation
    if (testMode) {
      console.log(`[PAPER TRADE] Gate ${side} ${quantity} ${symbol}`);
      const simulatedSlippage = side === 'buy' ? 1.002 : 0.998;
      return {
        success: true,
        orderId: `PAPER_GATE_${Date.now()}`,
        filledQty: quantity,
        avgPrice: simulatedSlippage,
        isPaperTrade: true
      };
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const currencyPair = symbol.replace('/', '_').toUpperCase();

    const body = JSON.stringify({
      currency_pair: currencyPair,
      side,
      type: 'market',
      amount: quantity.toFixed(8),
      time_in_force: 'ioc'
    });

    // Generate signature for Gate.io
    const method = 'POST';
    const url = '/api/v4/spot/orders';
    const queryString = '';

    // Hash the body
    const encoder = new TextEncoder();
    const bodyHash = await crypto.subtle.digest('SHA-512', encoder.encode(body));
    const bodyHashHex = Array.from(new Uint8Array(bodyHash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const signString = `${method}\n${url}\n${queryString}\n${bodyHashHex}\n${timestamp}`;

    const keyData = encoder.encode(credentials.api_secret);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signString));
    const signature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const response = await fetch(`${EXCHANGE_APIS.gate.baseUrl}${EXCHANGE_APIS.gate.orderEndpoint}`, {
      method: 'POST',
      headers: {
        'KEY': credentials.api_key,
        'SIGN': signature,
        'Timestamp': timestamp,
        'Content-Type': 'application/json'
      },
      body
    });

    const data = await response.json();

    if (!response.ok || data.label) {
      return { success: false, error: data.message || data.label || 'Gate order failed' };
    }

    return {
      success: true,
      orderId: data.id,
      filledQty: parseFloat(data.filled_amount || quantity),
      avgPrice: parseFloat(data.avg_deal_price || 0)
    };
  } catch (error) {
    console.error('Gate order error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Main trade execution function
async function executeArbitrageTrade(
  supabase: any,
  tradeId: string,
  opportunity: any,
  credentials: Record<string, ExchangeCredentials>,
  tradeAmount: number
): Promise<{ success: boolean; actualProfit?: number; error?: string }> {
  const executionLog: any[] = [];
  let currentAmount = tradeAmount;
  let completedSteps = 0;

  try {
    // Validate all exchange permissions before starting
    const exchanges = [opportunity.exchange1, opportunity.exchange2, opportunity.exchange3];
    const uniqueExchanges = [...new Set(exchanges.map((e: string) => e.toLowerCase()))];

    for (const exchange of uniqueExchanges) {
      const creds = credentials[exchange];
      if (!creds) {
        throw new Error(`Missing API credentials for ${exchange}. Please add your ${exchange} API keys in Profile settings.`);
      }

      // Skip validation for paper trading
      if (!creds.test_mode) {
        console.log(`Validating ${exchange} API permissions...`);
        const validation = await validateExchangePermissions(exchange, creds);

        if (!validation.valid) {
          throw new Error(`${exchange} API key validation failed: ${validation.error}`);
        }

        if (!validation.canTrade) {
          throw new Error(`${exchange} API key doesn't have trading permissions. Please enable "Spot Trading" in your ${exchange} API settings.`);
        }

        console.log(`✓ ${exchange} API key validated with trading permissions`);
      }
    }

    // Check opportunity staleness - reject if older than 5 seconds
    if (opportunity.detected_at) {
      const ageMs = Date.now() - new Date(opportunity.detected_at).getTime();
      const maxAgeMs = 5000; // 5 seconds max

      if (ageMs > maxAgeMs) {
        throw new Error(`Opportunity too stale (${(ageMs / 1000).toFixed(1)}s old). Prices likely changed. Skipping trade for safety.`);
      }

      console.log(`✓ Opportunity freshness OK (${(ageMs / 1000).toFixed(1)}s old)`);
    }

    // Update trade status to executing
    await supabase
      .from('trade_history')
      .update({ status: 'executing', started_at: new Date().toISOString() })
      .eq('id', tradeId);

    // Step 1: Execute first trade
    const step1Creds = credentials[opportunity.exchange1.toLowerCase()];
    if (!step1Creds) throw new Error(`No credentials for ${opportunity.exchange1}`);

    console.log(`Step 1: ${opportunity.step1_action} on ${opportunity.exchange1}`);

    let step1Result;
    const exchange1 = opportunity.exchange1.toLowerCase();
    const step1Side = opportunity.step1_action.includes('BUY') ? 'BUY' : 'SELL';

    // Auto-detect correct symbol format per exchange
    let step1Symbol = `${opportunity.base_symbol}${opportunity.quote_symbol}`;
    if (exchange1 === 'okx') step1Symbol = `${opportunity.base_symbol}-${opportunity.quote_symbol}`;
    if (exchange1 === 'gate') step1Symbol = `${opportunity.base_symbol}_${opportunity.quote_symbol}`;

    if (exchange1 === 'binance') {
      step1Result = await executeBinanceOrder(step1Creds, step1Symbol, step1Side as 'BUY' | 'SELL', step1Side === 'BUY' ? currentAmount / opportunity.step1_price : currentAmount, step1Creds.test_mode);
    } else if (exchange1 === 'bybit') {
      step1Result = await executeBybitOrder(step1Creds, step1Symbol, step1Side === 'BUY' ? 'Buy' : 'Sell', step1Side === 'BUY' ? currentAmount / opportunity.step1_price : currentAmount, step1Creds.test_mode);
    } else if (exchange1 === 'okx') {
      step1Result = await executeOKXOrder(step1Creds, step1Symbol, step1Side === 'BUY' ? 'buy' : 'sell', step1Side === 'BUY' ? currentAmount / opportunity.step1_price : currentAmount, step1Creds.test_mode);
    } else if (exchange1 === 'gate') {
      step1Result = await executeGateOrder(step1Creds, step1Symbol, step1Side === 'BUY' ? 'buy' : 'sell', step1Side === 'BUY' ? currentAmount / opportunity.step1_price : currentAmount, step1Creds.test_mode);
    } else {
      throw new Error(`Unsupported exchange: ${opportunity.exchange1}`);
    }

    if (!step1Result.success) {
      throw new Error(getHumanReadableError(step1Result.error || 'Unknown error', opportunity.exchange1));
    }

    executionLog.push({ step: 1, ...step1Result, timestamp: new Date().toISOString() });
    // If we bought, currentAmount is now base currency. If we sold, it's quote currency.
    currentAmount = step1Result.filledQty || (step1Side === 'BUY' ? currentAmount / opportunity.step1_price : currentAmount * opportunity.step1_price);
    completedSteps = 1;

    // Update progress
    await supabase
      .from('trade_history')
      .update({
        completed_steps: completedSteps,
        execution_details: { ...opportunity.execution_details, log: executionLog }
      })
      .eq('id', tradeId);

    // Step 2: Execute second trade
    const step2Creds = credentials[opportunity.exchange2.toLowerCase()];
    if (!step2Creds) throw new Error(`No credentials for ${opportunity.exchange2}`);

    console.log(`Step 2: ${opportunity.step2_action} on ${opportunity.exchange2}`);

    let step2Result;
    const exchange2 = opportunity.exchange2.toLowerCase();
    const step2Side = opportunity.step2_action.includes('BUY') ? 'BUY' : 'SELL';

    // Auto-detect correct symbol format per exchange
    let step2Symbol = `${opportunity.base_symbol}${opportunity.intermediate_symbol}`;
    if (exchange2 === 'okx') step2Symbol = `${opportunity.base_symbol}-${opportunity.intermediate_symbol}`;
    if (exchange2 === 'gate') step2Symbol = `${opportunity.base_symbol}_${opportunity.intermediate_symbol}`;

    if (exchange2 === 'binance') {
      step2Result = await executeBinanceOrder(step2Creds, step2Symbol, step2Side as 'BUY' | 'SELL', step2Side === 'BUY' ? currentAmount / opportunity.step2_price : currentAmount, step2Creds.test_mode);
    } else if (exchange2 === 'bybit') {
      step2Result = await executeBybitOrder(step2Creds, step2Symbol, step2Side === 'BUY' ? 'Buy' : 'Sell', step2Side === 'BUY' ? currentAmount / opportunity.step2_price : currentAmount, step2Creds.test_mode);
    } else if (exchange2 === 'okx') {
      step2Result = await executeOKXOrder(step2Creds, step2Symbol, step2Side === 'BUY' ? 'buy' : 'sell', step2Side === 'BUY' ? currentAmount / opportunity.step2_price : currentAmount, step2Creds.test_mode);
    } else if (exchange2 === 'gate') {
      step2Result = await executeGateOrder(step2Creds, step2Symbol, step2Side === 'BUY' ? 'buy' : 'sell', step2Side === 'BUY' ? currentAmount / opportunity.step2_price : currentAmount, step2Creds.test_mode);
    } else {
      throw new Error(`Unsupported exchange: ${opportunity.exchange2}`);
    }

    if (!step2Result.success) {
      throw new Error(getHumanReadableError(step2Result.error || 'Unknown error', opportunity.exchange2));
    }

    executionLog.push({ step: 2, ...step2Result, timestamp: new Date().toISOString() });
    currentAmount = step2Result.filledQty || (step2Side === 'BUY' ? currentAmount / opportunity.step2_price : currentAmount * opportunity.step2_price);
    completedSteps = 2;

    await supabase
      .from('trade_history')
      .update({
        completed_steps: completedSteps,
        execution_details: { ...opportunity.execution_details, log: executionLog }
      })
      .eq('id', tradeId);

    // Step 3: Execute third trade
    const step3Creds = credentials[opportunity.exchange3.toLowerCase()];
    if (!step3Creds) throw new Error(`No credentials for ${opportunity.exchange3}`);

    console.log(`Step 3: ${opportunity.step3_action} on ${opportunity.exchange3}`);

    let step3Result;
    const exchange3 = opportunity.exchange3.toLowerCase();
    const step3Side = opportunity.step3_action.includes('BUY') ? 'BUY' : 'SELL';

    // Auto-detect correct symbol format per exchange
    let step3Symbol = `${opportunity.intermediate_symbol}${opportunity.quote_symbol}`;
    if (exchange3 === 'okx') step3Symbol = `${opportunity.intermediate_symbol}-${opportunity.quote_symbol}`;
    if (exchange3 === 'gate') step3Symbol = `${opportunity.intermediate_symbol}_${opportunity.quote_symbol}`;

    if (exchange3 === 'binance') {
      step3Result = await executeBinanceOrder(step3Creds, step3Symbol, step3Side as 'BUY' | 'SELL', step3Side === 'BUY' ? currentAmount / opportunity.step3_price : currentAmount, step3Creds.test_mode);
    } else if (exchange3 === 'bybit') {
      step3Result = await executeBybitOrder(step3Creds, step3Symbol, step3Side === 'BUY' ? 'Buy' : 'Sell', step3Side === 'BUY' ? currentAmount / opportunity.step3_price : currentAmount, step3Creds.test_mode);
    } else if (exchange3 === 'okx') {
      step3Result = await executeOKXOrder(step3Creds, step3Symbol, step3Side === 'BUY' ? 'buy' : 'sell', step3Side === 'BUY' ? currentAmount / opportunity.step3_price : currentAmount, step3Creds.test_mode);
    } else if (exchange3 === 'gate') {
      step3Result = await executeGateOrder(step3Creds, step3Symbol, step3Side === 'BUY' ? 'buy' : 'sell', step3Side === 'BUY' ? currentAmount / opportunity.step3_price : currentAmount, step3Creds.test_mode);
    } else {
      throw new Error(`Unsupported exchange: ${opportunity.exchange3}`);
    }

    if (!step3Result.success) {
      throw new Error(getHumanReadableError(step3Result.error || 'Unknown error', opportunity.exchange3));
    }

    executionLog.push({ step: 3, ...step3Result, timestamp: new Date().toISOString() });
    const finalAmount = (step3Result.filledQty || opportunity.step3_amount) * opportunity.step3_price;
    completedSteps = 3;

    const actualProfit = finalAmount - tradeAmount;

    // Mark trade as completed
    await supabase
      .from('trade_history')
      .update({
        status: 'completed',
        completed_steps: completedSteps,
        completed_at: new Date().toISOString(),
        final_amount: finalAmount,
        actual_profit: actualProfit,
        execution_details: { ...opportunity.execution_details, log: executionLog }
      })
      .eq('id', tradeId);

    // Log success
    await supabase.from('scanner_logs').insert({
      user_id: opportunity.user_id,
      log_type: 'trade_complete',
      message: `Trade completed successfully`,
      details: {
        trade_id: tradeId,
        start_amount: tradeAmount,
        final_amount: finalAmount,
        actual_profit: actualProfit,
        profit_percent: (actualProfit / tradeAmount) * 100
      }
    });

    return { success: true, actualProfit };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Check if this is a partial failure (completed some steps but not all)
    const isPartialFailure = completedSteps > 0 && completedSteps < 3;

    console.log(`Trade execution failed at step ${completedSteps}. Partial failure: ${isPartialFailure}`);

    if (isPartialFailure) {
      // Create recovery state for partial failures
      console.log('Creating recovery state for partial failure...');

      try {
        const { data: existingRecovery } = await supabase
          .from('trade_recovery_state')
          .select('id')
          .eq('trade_id', tradeId)
          .single();

        // Only create if doesn't exist
        if (!existingRecovery) {
          const { error: recoveryError } = await supabase
            .from('trade_recovery_state')
            .insert({
              trade_id: tradeId,
              user_id: opportunity.user_id,
              current_step: completedSteps,
              recovery_attempts: 0,
              recovery_status: 'pending'
            });

          if (recoveryError) {
            console.error('Failed to create recovery state:', recoveryError);
          } else {
            console.log('Recovery state created successfully');
          }
        } else {
          console.log('Recovery state already exists for this trade');
        }
      } catch (recoveryCreationError) {
        console.error('Error in recovery state creation:', recoveryCreationError);
      }

      // Mark trade as failed with partial info
      await supabase
        .from('trade_history')
        .update({
          status: 'failed',
          completed_steps: completedSteps,
          completed_at: new Date().toISOString(),
          error_message: errorMessage,
          execution_details: {
            ...opportunity.execution_details,
            log: executionLog,
            error: errorMessage,
            recoverable: true
          }
        })
        .eq('id', tradeId);

      // Log partial failure
      await supabase.from('scanner_logs').insert({
        user_id: opportunity.user_id,
        log_type: 'trade_partial_failure',
        message: `Trade partially failed at step ${completedSteps}: ${errorMessage}`,
        details: {
          trade_id: tradeId,
          completed_steps: completedSteps,
          error: errorMessage,
          recoverable: true
        }
      });

    } else {
      // Complete failure - no recovery possible
      await supabase
        .from('trade_history')
        .update({
          status: 'failed',
          completed_steps: completedSteps,
          completed_at: new Date().toISOString(),
          error_message: errorMessage,
          execution_details: { ...opportunity.execution_details, log: executionLog, error: errorMessage }
        })
        .eq('id', tradeId);

      // Log failure
      await supabase.from('scanner_logs').insert({
        user_id: opportunity.user_id,
        log_type: 'trade_failed',
        message: `Trade failed: ${errorMessage}`,
        details: {
          trade_id: tradeId,
          completed_steps: completedSteps,
          error: errorMessage
        }
      });
    }

    return { success: false, error: errorMessage };
  }
}

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // PHASE 0 Safety Lock
  if (Deno.env.get('RUNTIME') !== 'vps') {
    return new Response(JSON.stringify({ error: 'Execution outside VPS is disabled.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Service role authentication required
  const authHeader = req.headers.get('Authorization');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (!authHeader || authHeader.replace('Bearer ', '') !== serviceKey) {
    return new Response(JSON.stringify({ error: 'Unauthorized: service role required' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { action, tradeId, userId } = await req.json();

    if (action === 'execute_single') {
      // Execute a single trade from the queue
      const { data: trade, error: tradeError } = await supabase
        .from('trade_history')
        .select(`
          *,
          arbitrage_opportunities (*)
        `)
        .eq('id', tradeId)
        .single();

      if (tradeError || !trade) {
        throw new Error('Trade not found');
      }

      // Get user credentials
      const { data: credentials, error: credError } = await supabase
        .from('exchange_credentials')
        .select('*')
        .eq('user_id', trade.user_id)
        .eq('is_connected', true);

      if (credError || !credentials?.length) {
        throw new Error('No exchange credentials found');
      }

      const credMap: Record<string, ExchangeCredentials> = {};

      // Decrypt credentials if needed
      for (const c of credentials) {
        const decrypted = await decryptCredentials(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
          c
        );

        credMap[c.exchange.toLowerCase()] = {
          api_key: decrypted.api_key,
          api_secret: decrypted.api_secret,
          exchange: c.exchange,
          test_mode: c.test_mode
        };
      }

      const result = await executeArbitrageTrade(
        supabase,
        tradeId,
        { ...trade, ...trade.arbitrage_opportunities },
        credMap,
        trade.start_amount
      );

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'execute_queued') {
      // Get all pending trades from queue for this user
      const { data: pendingTrades, error: queueError } = await supabase
        .from('trade_history')
        .select(`
          *,
          arbitrage_opportunities (*)
        `)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(5);

      if (queueError) {
        throw new Error('Failed to fetch pending trades');
      }

      if (!pendingTrades?.length) {
        return new Response(JSON.stringify({ message: 'No pending trades' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Get user credentials
      const { data: credentials, error: credError } = await supabase
        .from('exchange_credentials')
        .select('*')
        .eq('user_id', userId)
        .eq('is_connected', true);

      if (credError || !credentials?.length) {
        throw new Error('No exchange credentials found');
      }

      const credMap: Record<string, ExchangeCredentials> = {};

      // Decrypt credentials if needed
      for (const c of credentials) {
        const decrypted = await decryptCredentials(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
          c
        );

        credMap[c.exchange.toLowerCase()] = {
          api_key: decrypted.api_key,
          api_secret: decrypted.api_secret,
          exchange: c.exchange,
          test_mode: c.test_mode
        };
      }

      const results = [];
      for (const trade of pendingTrades) {
        const result = await executeArbitrageTrade(
          supabase,
          trade.id,
          { ...trade, ...trade.arbitrage_opportunities },
          credMap,
          trade.start_amount
        );
        results.push({ tradeId: trade.id, ...result });
      }

      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    throw new Error('Invalid action');
  } catch (error) {
    console.error('Execute trade error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
}

// Export default handler for unified server
export default handler;

// For Supabase Edge Functions compatibility (commented out for unified server)
// if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
//   serve(handler);
// }

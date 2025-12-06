import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function validateBinance(apiKey: string, apiSecret: string): Promise<{ valid: boolean; canTrade: boolean; error?: string }> {
  try {
    const timestamp = Date.now();
    const params = new URLSearchParams({
      timestamp: timestamp.toString(),
      recvWindow: '5000'
    });

    const queryString = params.toString();
    const encoder = new TextEncoder();
    const keyData = encoder.encode(apiSecret);
    const messageData = encoder.encode(queryString);
    
    const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, messageData);
    const signature = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    const response = await fetch(`https://api.binance.com/api/v3/account?${queryString}&signature=${signature}`, {
      headers: { 'X-MBX-APIKEY': apiKey }
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

async function validateBybit(apiKey: string, apiSecret: string): Promise<{ valid: boolean; canTrade: boolean; error?: string }> {
  try {
    const timestamp = Date.now();
    const recvWindow = 5000;
    const signPayload = `${timestamp}${apiKey}${recvWindow}`;
    
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signPayload));
    const signature = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    const response = await fetch(`https://api.bybit.com/v5/user/query-api`, {
      headers: {
        'X-BAPI-API-KEY': apiKey,
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

async function validateOKX(apiKey: string, apiSecret: string): Promise<{ valid: boolean; canTrade: boolean; error?: string }> {
  try {
    const timestamp = new Date().toISOString();
    const signPayload = `${timestamp}GET/api/v5/account/config`;
    
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signPayload));
    const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

    const response = await fetch(`https://www.okx.com/api/v5/account/config`, {
      headers: {
        'OK-ACCESS-KEY': apiKey,
        'OK-ACCESS-SIGN': signature,
        'OK-ACCESS-TIMESTAMP': timestamp,
        'OK-ACCESS-PASSPHRASE': ''
      }
    });

    const data = await response.json();
    
    if (data.code !== '0') {
      return { valid: false, canTrade: false, error: data.msg || 'API validation failed' };
    }

    return { valid: true, canTrade: true };
  } catch (error) {
    return { valid: false, canTrade: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

async function validateGate(apiKey: string, apiSecret: string): Promise<{ valid: boolean; canTrade: boolean; error?: string }> {
  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const method = 'GET';
    const url = '/api/v4/spot/accounts';
    const queryString = '';
    const body = '';
    
    const encoder = new TextEncoder();
    const bodyHash = await crypto.subtle.digest('SHA-512', encoder.encode(body));
    const bodyHashHex = Array.from(new Uint8Array(bodyHash)).map(b => b.toString(16).padStart(2, '0')).join('');
    
    const signString = `${method}\n${url}\n${queryString}\n${bodyHashHex}\n${timestamp}`;
    
    const keyData = encoder.encode(apiSecret);
    const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signString));
    const signature = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    const response = await fetch(`https://api.gateio.ws${url}`, {
      headers: {
        'KEY': apiKey,
        'SIGN': signature,
        'Timestamp': timestamp
      }
    });

    if (!response.ok) {
      const data = await response.json();
      return { valid: false, canTrade: false, error: data.message || data.label || 'API validation failed' };
    }

    return { valid: true, canTrade: true };
  } catch (error) {
    return { valid: false, canTrade: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { exchange, apiKey, apiSecret } = await req.json();

    if (!exchange || !apiKey || !apiSecret) {
      return new Response(
        JSON.stringify({ valid: false, canTrade: false, error: 'Missing required parameters' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Validating ${exchange} API key...`);

    let result;
    switch (exchange.toLowerCase()) {
      case 'binance':
        result = await validateBinance(apiKey, apiSecret);
        break;
      case 'bybit':
        result = await validateBybit(apiKey, apiSecret);
        break;
      case 'okx':
        result = await validateOKX(apiKey, apiSecret);
        break;
      case 'gate':
        result = await validateGate(apiKey, apiSecret);
        break;
      default:
        result = { valid: true, canTrade: true, error: undefined };
    }

    console.log(`${exchange} validation result:`, result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Validation error:', error);
    return new Response(
      JSON.stringify({ valid: false, canTrade: false, error: error instanceof Error ? error.message : 'Validation failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

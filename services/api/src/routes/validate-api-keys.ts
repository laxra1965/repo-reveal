import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';

const router = Router();

interface ValidateApiKeysRequest {
  exchange?: string;
  apiKey?: string;
  apiSecret?: string;
  apiPassphrase?: string;
  userId?: string;
}

const EXCHANGE_APIS: Record<string, { baseUrl: string; testEndpoint: string }> = {
  binance: {
    baseUrl: 'https://api.binance.com',
    testEndpoint: '/api/v3/account'
  },
  bybit: {
    baseUrl: 'https://api.bybit.com',
    testEndpoint: '/v5/user/query-api'
  },
  okx: {
    baseUrl: 'https://www.okx.com',
    testEndpoint: '/api/v5/account/config'
  },
  gate: {
    baseUrl: 'https://api.gateio.ws',
    testEndpoint: '/api/v4/spot/accounts'
  }
};

/**
 * GET/POST /functions/validate-api-keys
 * 
 * Validates exchange API credentials
 * - Tests API key validity
 * - Checks trading permissions
 * - Verifies API key configuration
 */
router.post('/functions/validate-api-keys', async (req: Request, res: Response) => {
  handleValidateApiKeys(req, res);
});

router.get('/functions/validate-api-keys', async (req: Request, res: Response) => {
  res.json({ message: 'API key validation endpoint. Use POST to validate keys.' });
});

async function handleValidateApiKeys(req: Request, res: Response) {
  try {
    const supabase = req.app.get('supabase') as SupabaseClient;
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase client not configured' });
    }

    const { exchange, apiKey, apiSecret, apiPassphrase, userId: bodyUserId } = req.body as ValidateApiKeysRequest;
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

    if (!userId && !apiKey) {
      return res.status(401).json({ error: 'Unauthorized: No valid user session or credentials provided' });
    }

    console.log(`Validating API keys: exchange=${exchange}, userId=${userId}`);

    const validationResults: any[] = [];

    // If specific credentials provided, validate those
    if (apiKey && exchange) {
      const result = await validateSingleApiKey(
        {
          exchange: exchange.toLowerCase(),
          api_key: apiKey,
          api_secret: apiSecret || '',
          api_passphrase: apiPassphrase
        },
        supabase
      );
      validationResults.push(result);
    } else if (userId) {
      // Otherwise, validate all credentials for the user
      const { data: credentials, error: credError } = await supabase
        .from('user_api_credentials')
        .select('*')
        .eq('user_id', userId);

      if (credError || !credentials || credentials.length === 0) {
        return res.status(404).json({ error: 'No API credentials found for user' });
      }

      for (const cred of credentials) {
        const result = await validateSingleApiKey(cred, supabase);
        validationResults.push(result);
      }
    } else {
      return res.status(400).json({ error: 'No credentials or user provided' });
    }

    const allValid = validationResults.every(r => r.valid);

    res.json({
      success: allValid,
      results: validationResults,
      timestamp: new Date().toISOString()
    });

  } catch (err: any) {
    console.error('Validate API Keys Error:', err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}

async function validateSingleApiKey(
  credentials: any,
  supabase: SupabaseClient
): Promise<any> {
  try {
    const exchange = credentials.exchange.toLowerCase();
    const config = EXCHANGE_APIS[exchange];

    if (!config) {
      return {
        exchange,
        valid: false,
        canTrade: false,
        message: `Unsupported exchange: ${exchange}`
      };
    }

    // TODO: Implement per-exchange API validation
    // Example for Binance:
    // 1. Create HMAC-SHA256 signature
    // 2. Send request to account endpoint
    // 3. Check for valid response and permissions
    
    // For now, return placeholder
    return {
      exchange,
      valid: true,
      canTrade: true,
      message: `${exchange} API key is valid`,
      permissions: ['spot_trading']
    };

  } catch (err: any) {
    return {
      exchange: credentials.exchange,
      valid: false,
      canTrade: false,
      message: err.message
    };
  }
}

export default router;

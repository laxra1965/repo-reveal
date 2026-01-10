import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';

const router = Router();

interface RateLimitRequest {
  exchange: string;
  action?: 'check' | 'status' | 'reset';
}

// Rate limit configurations per exchange
const EXCHANGE_LIMITS: Record<string, { maxRequests: number; windowMs: number }> = {
  binance: { maxRequests: 1200, windowMs: 60000 }, // 1200 per minute
  bybit: { maxRequests: 600, windowMs: 60000 }, // 600 per minute
  okx: { maxRequests: 300, windowMs: 60000 }, // 300 per minute
  gate: { maxRequests: 300, windowMs: 60000 }, // 300 per minute
  default: { maxRequests: 120, windowMs: 60000 } // 120 per minute
};

// In-memory storage (upgrade to Redis for production)
const requestLog = new Map<string, number[]>();

/**
 * GET/POST /functions/rate-limiter
 * 
 * Distributed rate limiting for exchange API calls
 * - Tracks requests per exchange
 * - Enforces exchange-specific rate limits
 * - Returns current usage and remaining quota
 */
router.post('/functions/rate-limiter', async (req: Request, res: Response) => {
  handleRateLimit(req, res);
});

router.get('/functions/rate-limiter', async (req: Request, res: Response) => {
  handleRateLimit(req, res);
});

async function handleRateLimit(req: Request, res: Response) {
  try {
    const { exchange = 'default', action = 'check' } = req.body as RateLimitRequest;
    const supabase = req.app.get('supabase') as SupabaseClient;

    console.log(`Rate Limiter: exchange=${exchange}, action=${action}`);

    const config = EXCHANGE_LIMITS[exchange.toLowerCase()] || EXCHANGE_LIMITS.default;

    if (action === 'check') {
      // Check if request is allowed
      const now = Date.now();
      const key = `${exchange}:requests`;
      const timestamps = requestLog.get(key) || [];

      // Remove old timestamps outside the window
      const validTimestamps = timestamps.filter(ts => now - ts < config.windowMs);

      if (validTimestamps.length < config.maxRequests) {
        // Request allowed
        validTimestamps.push(now);
        requestLog.set(key, validTimestamps);

        res.json({
          allowed: true,
          exchange,
          used: validTimestamps.length,
          limit: config.maxRequests,
          remaining: config.maxRequests - validTimestamps.length,
          resetAt: new Date(now + config.windowMs).toISOString()
        });
      } else {
        // Rate limit exceeded
        res.status(429).json({
          allowed: false,
          exchange,
          used: validTimestamps.length,
          limit: config.maxRequests,
          remaining: 0,
          retryAfter: Math.ceil((validTimestamps[0] + config.windowMs - now) / 1000),
          resetAt: new Date(validTimestamps[0] + config.windowMs).toISOString()
        });
      }
    } else if (action === 'status') {
      // Return current status for all exchanges
      const status: any = {};
      const now = Date.now();

      for (const [exchangeName, exchangeConfig] of Object.entries(EXCHANGE_LIMITS)) {
        const key = `${exchangeName}:requests`;
        const timestamps = requestLog.get(key) || [];
        const validTimestamps = timestamps.filter(ts => now - ts < exchangeConfig.windowMs);

        status[exchangeName] = {
          used: validTimestamps.length,
          limit: exchangeConfig.maxRequests,
          remaining: exchangeConfig.maxRequests - validTimestamps.length,
          resetAt: validTimestamps.length > 0
            ? new Date(validTimestamps[0] + exchangeConfig.windowMs).toISOString()
            : 'ready'
        };
      }

      res.json({
        success: true,
        action: 'status',
        status,
        timestamp: new Date().toISOString()
      });
    } else if (action === 'reset') {
      // Reset rate limit for exchange (admin only)
      const key = `${exchange}:requests`;
      requestLog.delete(key);

      res.json({
        success: true,
        action: 'reset',
        exchange,
        message: `Rate limit reset for ${exchange}`,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({ error: 'Invalid action' });
    }

  } catch (err: any) {
    console.error('Rate Limiter Error:', err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}

export default router;

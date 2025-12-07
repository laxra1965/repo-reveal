import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Rate Limiter Edge Function
 * 
 * Implements distributed rate limiting for exchange API calls
 * Uses in-memory storage (for now, upgrade to Redis for production)
 * 
 * Endpoints:
 * - POST /check: Check if request is allowed
 * - GET /status: Get current rate limit status
 */

interface RateLimitConfig {
    maxRequests: number;
    windowMs: number;
}

// Rate limit configurations per exchange
const EXCHANGE_LIMITS: Record<string, RateLimitConfig> = {
    binance: { maxRequests: 1200, windowMs: 60000 }, // 1200 per minute
    bybit: { maxRequests: 600, windowMs: 60000 }, // 600 per minute
    okx: { maxRequests: 300, windowMs: 60000 }, // 300 per minute
    gate: { maxRequests: 300, windowMs: 60000 }, // 300 per minute
    default: { maxRequests: 120, windowMs: 60000 }, // 120 per minute
};

// In-memory storage (use KV or Redis for production)
const requestLog = new Map<string, number[]>();

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const url = new URL(req.url);
        const path = url.pathname;

        if (path.endsWith('/check')) {
            return await handleRateLimitCheck(req);
        } else if (path.endsWith('/status')) {
            return await handleStatusCheck(req);
        } else {
            return new Response('Not Found', { status: 404, headers: corsHeaders });
        }
    } catch (error) {
        console.error('Rate limiter error:', error);
        return new Response(
            JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error',
            }),
            {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
        );
    }
});

async function handleRateLimitCheck(req: Request): Promise<Response> {
    const { userId, exchange, endpoint } = await req.json();

    if (!userId || !exchange) {
        return new Response(
            JSON.stringify({ error: 'userId and exchange are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    const key = `${userId}:${exchange}:${endpoint || 'default'}`;
    const config = EXCHANGE_LIMITS[exchange.toLowerCase()] || EXCHANGE_LIMITS.default;

    const now = Date.now();
    const windowStart = now - config.windowMs;

    // Get existing requests
    let requests = requestLog.get(key) || [];

    // Remove requests outside the window
    requests = requests.filter((timestamp) => timestamp > windowStart);

    // Check if limit exceeded
    if (requests.length >= config.maxRequests) {
        const oldestRequest = Math.min(...requests);
        const retryAfter = Math.ceil((oldestRequest + config.windowMs - now) / 1000);

        return new Response(
            JSON.stringify({
                allowed: false,
                limit: config.maxRequests,
                remaining: 0,
                resetIn: retryAfter,
                retryAfter,
            }),
            {
                status: 429,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json',
                    'X-RateLimit-Limit': config.maxRequests.toString(),
                    'X-RateLimit-Remaining': '0',
                    'X-RateLimit-Reset': new Date(oldestRequest + config.windowMs).toISOString(),
                    'Retry-After': retryAfter.toString(),
                },
            }
        );
    }

    // Add current request
    requests.push(now);
    requestLog.set(key, requests);

    const remaining = config.maxRequests - requests.length;

    return new Response(
        JSON.stringify({
            allowed: true,
            limit: config.maxRequests,
            remaining,
            resetIn: Math.ceil(config.windowMs / 1000),
        }),
        {
            status: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
                'X-RateLimit-Limit': config.maxRequests.toString(),
                'X-RateLimit-Remaining': remaining.toString(),
                'X-RateLimit-Reset': new Date(now + config.windowMs).toISOString(),
            },
        }
    );
}

async function handleStatusCheck(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const userId = url.searchParams.get('userId');
    const exchange = url.searchParams.get('exchange');

    if (!userId || !exchange) {
        return new Response(
            JSON.stringify({ error: 'userId and exchange query parameters are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    const key = `${userId}:${exchange}:default`;
    const config = EXCHANGE_LIMITS[exchange.toLowerCase()] || EXCHANGE_LIMITS.default;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    let requests = requestLog.get(key) || [];
    requests = requests.filter((timestamp) => timestamp > windowStart);

    const remaining = Math.max(0, config.maxRequests - requests.length);

    return new Response(
        JSON.stringify({
            exchange,
            limit: config.maxRequests,
            remaining,
            used: requests.length,
            windowMs: config.windowMs,
        }),
        {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
    );
}

// Cleanup old entries periodically (every 5 minutes)
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;

    requestLog.forEach((requests, key) => {
        const exchange = key.split(':')[1];
        const config = EXCHANGE_LIMITS[exchange] || EXCHANGE_LIMITS.default;
        const windowStart = now - config.windowMs;

        const filtered = requests.filter((timestamp) => timestamp > windowStart);

        if (filtered.length === 0) {
            requestLog.delete(key);
            cleaned++;
        } else if (filtered.length !== requests.length) {
            requestLog.set(key, filtered);
        }
    });

    if (cleaned > 0) {
        console.log(`[RateLimiter] Cleaned ${cleaned} expired entries`);
    }
}, 5 * 60 * 1000);

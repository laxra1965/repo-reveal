import './arbitrage-scanner/scheduler.ts';
import { autoCycle, caller } from './_shared/trading-runtime.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PORT = Deno.env.get('PORT') || "8000";
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || 'https://repo-reveal.lovable.app').split(',').map(s=>s.trim()).filter(Boolean);
setInterval(() => { void autoCycle().catch(() => console.error('VPS auto cycle failed')); }, 15000);
const START_TIME = Date.now();

// Request counter for monitoring
let requestCount = 0;
let requestsByPath: Record<string, number> = {};

// Rate limiting
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute
const rateLimitMap = new Map<string, number[]>();

function getClientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() 
    || req.headers.get('x-real-ip') 
    || 'unknown';
}

function isRateLimited(clientIp: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  let timestamps = rateLimitMap.get(clientIp) || [];
  timestamps = timestamps.filter(t => t > windowStart);
  
  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }
  
  timestamps.push(now);
  rateLimitMap.set(clientIp, timestamps);
  
  // Cleanup old entries
  if (rateLimitMap.size > 10000) {
    for (const [ip, ts] of rateLimitMap.entries()) {
      if (ts.filter(t => t > windowStart).length === 0) {
        rateLimitMap.delete(ip);
      }
    }
  }
  
  return false;
}

function getCorsHeaders(origin: string | null) {
  const allowedOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-idempotency-key, x-supabase-client-platform, x-supabase-client-runtime',
  };
}

async function checkDatabaseHealth(): Promise<{status: string; latency: number; rowCount?: number}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

  try {
    const start = Date.now();
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      clearTimeout(timeoutId);
      return { status: 'error', latency: 0 };
    }

    const client = createClient(supabaseUrl, supabaseKey);
    
    // Use a simpler query for health check and wrap in timeout
    const { data, error } = await Promise.race([
      client
        .from('opportunities')
        .select('id')
        .limit(1),
      new Promise<any>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('Database timeout')));
      })
    ]);

    const latency = Date.now() - start;
    clearTimeout(timeoutId);
    
    if (error) {
      console.error('[health] Database error:', error);
      return { status: 'error', latency };
    }
    
    return { status: 'healthy', latency, rowCount: data ? data.length : 0 };
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('[health] Database health check failed:', err instanceof Error ? err.message : err);
    return { status: 'error', latency: 0 };
  }
}

async function handleRequest(req: Request): Promise<Response> {
  const startTime = performance.now();
  const url = new URL(req.url);
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);
  const clientIp = getClientIp(req);

  // Apply rate limiting (except for health checks)
  if (url.pathname !== '/health' && url.pathname !== '/monitor') {
    if (isRateLimited(clientIp)) {
      const duration = performance.now() - startTime;
      console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname} - 429 (${duration.toFixed(2)}ms) - ${clientIp}`);
      return new Response(JSON.stringify({
        error: 'Rate limit exceeded',
        limit: RATE_LIMIT_MAX_REQUESTS,
        window_seconds: RATE_LIMIT_WINDOW / 1000
      }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Request tracking
  requestCount++;
  const path = url.pathname;
  requestsByPath[path] = (requestsByPath[path] || 0) + 1;

  // Enhanced health check endpoint
  if (url.pathname === '/health') {
    const dbHealth = await checkDatabaseHealth();
    const uptime = Math.floor((Date.now() - START_TIME) / 1000);
    const duration = performance.now() - startTime;
    console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname} - 200 (${duration.toFixed(2)}ms) - ${clientIp}`);
    
    return new Response(JSON.stringify({
      status: dbHealth.status === 'healthy' ? 'ok' : 'degraded',
      uptime_seconds: uptime,
      requests_total: requestCount,
      database: dbHealth,
      opportunities_count: dbHealth.rowCount || 0,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Monitoring endpoint (shows request stats)
  if (url.pathname === '/monitor') {
    const topPaths = Object.entries(requestsByPath)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([path, count]) => ({ path, count }));

    const duration = performance.now() - startTime;
    console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname} - 200 (${duration.toFixed(2)}ms) - ${clientIp}`);

    return new Response(JSON.stringify({
      total_requests: requestCount,
      top_endpoints: topPaths,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const pathParts = url.pathname.split('/').filter(p => p);
  const functionName = pathParts[0] === 'functions' ? pathParts[1] : pathParts[0];

  if (!functionName) {
    return new Response(JSON.stringify({ error: 'Function name required' }), {
      status: 400, headers: corsHeaders
    });
  }

  // Handle common non-function paths gracefully to avoid noisy import errors
  if (functionName === 'favicon.ico') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (functionName === 'sitemap.xml') {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`;
    return new Response(xml, { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/xml' } });
  }
  if (functionName === 'robots.txt') {
    const robots = `User-agent: *\nDisallow:`;
    return new Response(robots, { status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } });
  }
  if (['bins', 'bin', 'backup'].includes(functionName)) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const routes = new Set(['arbitrage-scanner','execute-trade','auto-trade-scheduler','validate-api-keys','encrypt-api-keys','fetch-opportunities','clear-user-data']);
  if (!routes.has(functionName)) return new Response(JSON.stringify({error:'Not found'}), {status:404,headers:corsHeaders});
  try {
    const auth = await caller(req);
    if (functionName === 'arbitrage-scanner' && !auth.service) {
      const {data,error}=await auth.db.from('admin_users').select('id').eq('user_id',auth.userId).maybeSingle();
      if(error||!data)return new Response(JSON.stringify({error:'Admin required'}),{status:403,headers:corsHeaders});
    }
    // Check module existence before attempting import to avoid uncaught module-not-found errors
    const moduleUrl = new URL(`./${functionName}/index.ts`, import.meta.url);
    try {
      await Deno.stat(moduleUrl.pathname);
    } catch {
      const duration = performance.now() - startTime;
      console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname} - 404 (${duration.toFixed(2)}ms) - ${clientIp}`);
      return new Response(JSON.stringify({ error: `Function '${functionName}' not found` }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const handlerModule = await import(moduleUrl.href);

    if (typeof handlerModule.default === 'function') {
      const response = await handlerModule.default(req);

      // Merge function headers with CORS headers
      const finalHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([k, v]) => finalHeaders.set(k, v));

      const duration = performance.now() - startTime;
      console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname} - ${response.status} (${duration.toFixed(2)}ms) - ${clientIp}`);

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: finalHeaders
      });
    }

    throw new Error('Handler not found');
  } catch (err) {
    const duration = performance.now() - startTime;
    console.error(`[${new Date().toISOString()}] ${req.method} ${url.pathname} - 500 (${duration.toFixed(2)}ms) - ${clientIp} - ${err instanceof Error ? err.message : String(err)}`);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

console.log(`🚀 Server starting on 0.0.0.0:${PORT}`);
Deno.serve({ port: parseInt(PORT), hostname: "0.0.0.0" }, handleRequest);

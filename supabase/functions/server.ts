// Unified HTTP server for all edge functions
// Routes requests to appropriate function handlers

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: any;

const PORT = Deno.env.get('PORT') || '8000';
const ALLOWED_ORIGINS = Deno.env.get('ALLOWED_ORIGINS')?.split(',') || ['*'];

// CORS headers
function getCorsHeaders(origin: string | null) {
  const allowedOrigin = ALLOWED_ORIGINS.includes('*') || !origin 
    ? '*' 
    : ALLOWED_ORIGINS.includes(origin) 
      ? origin 
      : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

// Function handler registry
const functionHandlers = new Map<string, (req: Request) => Promise<Response>>();

// Import and register function handlers
async function initializeHandlers() {
  try {
    // Import arbitrage-scanner handler
    const scannerModule = await import('./arbitrage-scanner/index.ts');
    if (scannerModule.default) {
      functionHandlers.set('arbitrage-scanner', scannerModule.default);
    }

    // Import execute-trade handler  
    const executeModule = await import('./execute-trade/index.ts');
    if (executeModule.default) {
      functionHandlers.set('execute-trade', executeModule.default);
    }

    // Import auto-trade-scheduler handler
    const schedulerModule = await import('./auto-trade-scheduler/index.ts');
    if (schedulerModule.default) {
      functionHandlers.set('auto-trade-scheduler', schedulerModule.default);
    }

    // Import encrypt-api-keys handler
    const encryptModule = await import('./encrypt-api-keys/index.ts');
    if (encryptModule.default) {
      functionHandlers.set('encrypt-api-keys', encryptModule.default);
    }

    // Import other handlers as needed
    // Note: Some functions may need to be updated to export default handlers
    
    console.log(`✅ Registered ${functionHandlers.size} function handlers`);
  } catch (error) {
    console.error('Error initializing handlers:', error);
  }
}

// Get handler for function name
function getHandler(functionName: string): ((req: Request) => Promise<Response>) | null {
  return functionHandlers.get(functionName) || null;
}

// Health check handler
async function handleHealthCheck(): Promise<Response> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ 
          status: 'error', 
          message: 'Missing environment variables',
          timestamp: new Date().toISOString()
        }),
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Test database connection
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { error } = await supabase.from('user_settings').select('count').limit(1);

    return new Response(
      JSON.stringify({
        status: error ? 'degraded' : 'healthy',
        database: error ? 'disconnected' : 'connected',
        timestamp: new Date().toISOString(),
        uptime: process.uptime ? process.uptime() : 'unknown'
      }),
      {
        status: error ? 503 : 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        status: 'error',
        message: error.message,
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Main request handler
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  // Handle OPTIONS requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check endpoint
  if (url.pathname === '/health' || url.pathname === '/health/') {
    const healthResponse = await handleHealthCheck();
    // Add CORS headers to health check
    Object.entries(corsHeaders).forEach(([key, value]) => {
      healthResponse.headers.set(key, value);
    });
    return healthResponse;
  }

  // Detailed health check
  if (url.pathname === '/health/detailed') {
    const healthResponse = await handleHealthCheck();
    Object.entries(corsHeaders).forEach(([key, value]) => {
      healthResponse.headers.set(key, value);
    });
    return healthResponse;
  }

  // Route to function handlers
  // Path format: /functions/{function-name} or /{function-name}
  const pathParts = url.pathname.split('/').filter(p => p);
  
  // Determine function name
  let functionName: string;
  if (pathParts[0] === 'functions' && pathParts.length > 1) {
    functionName = pathParts[1];
  } else if (pathParts.length > 0) {
    functionName = pathParts[0];
  } else {
    return new Response(
      JSON.stringify({ error: 'Function name required in path' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }

  // Get handler for function
  const handler = getHandler(functionName);
  
  if (!handler) {
    // Try to load handler dynamically if not in registry
    try {
      let handlerModule;
      switch (functionName) {
        case 'arbitrage-scanner':
          handlerModule = await import('./arbitrage-scanner/index.ts');
          break;
        case 'execute-trade':
          handlerModule = await import('./execute-trade/index.ts');
          break;
        case 'auto-trade-scheduler':
          handlerModule = await import('./auto-trade-scheduler/index.ts');
          break;
        case 'encrypt-api-keys':
          handlerModule = await import('./encrypt-api-keys/index.ts');
          break;
        case 'fetch-exchange-balances':
          handlerModule = await import('./fetch-exchange-balances/index.ts');
          break;
        case 'validate-api-keys':
          handlerModule = await import('./validate-api-keys/index.ts');
          break;
        case 'scheduled-arb-scan':
          handlerModule = await import('./scheduled-arb-scan/index.ts');
          break;
        default:
          handlerModule = null;
      }
      
      if (handlerModule?.default) {
        const dynamicHandler = handlerModule.default;
        functionHandlers.set(functionName, dynamicHandler);
        const response = await dynamicHandler(req);
        
        // Add CORS headers
        const responseHeaders = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([key, value]) => {
          responseHeaders.set(key, value);
        });
        
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders
        });
      }
    } catch (importError) {
      console.error(`Error importing function ${functionName}:`, importError);
    }
    
    return new Response(
      JSON.stringify({ error: `Function '${functionName}' not found` }),
      {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }

  // Call the function handler
  try {
    const response = await handler(req);
    
    // Ensure CORS headers are present
    const responseHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      responseHeaders.set(key, value);
    });
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch (error: any) {
    console.error(`Error in function ${functionName}:`, error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error.message,
        function: functionName
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
}

// Start server
async function startServer() {
  console.log(`🚀 Starting unified function server on port ${PORT}...`);
  console.log(`📡 Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  
  // Initialize handlers
  await initializeHandlers();
  
  console.log(`✅ Server ready on port ${PORT}`);
  serve(handleRequest, { port: parseInt(PORT) });
}

startServer();


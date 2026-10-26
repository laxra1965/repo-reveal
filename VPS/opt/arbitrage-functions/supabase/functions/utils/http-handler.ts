// Utility to create HTTP handlers compatible with both Supabase Edge Functions and standalone server

export interface HandlerFunction {
  (req: Request): Promise<Response>;
}

/**
 * Wraps a handler function to work with both Supabase serve() and standalone server
 */
export function createHandler(handler: HandlerFunction): HandlerFunction {
  return handler;
}

/**
 * CORS headers helper
 */
export function getCorsHeaders(allowedOrigins: string[] = ['*'], origin: string | null = null) {
  const allowedOrigin = allowedOrigins.includes('*') || !origin 
    ? '*' 
    : allowedOrigins.includes(origin) 
      ? origin 
      : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}


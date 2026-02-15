import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Get allowed origins from environment or use secure defaults
const getAllowedOrigins = (): string[] => {
  const env = Deno.env.get('ALLOWED_ORIGINS') || '';
  return env.split(',').filter(o => o.trim()) || ['http://localhost:3000', 'http://localhost:5173'];
};

const corsHeaders = {
  'Access-Control-Allow-Origin': getAllowedOrigins()[0], // Use first allowed origin
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
};

serve(async (req) => {
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

    console.log('Running scheduled arbitrage scan cleanup...');

    // Cleanup old opportunities (older than 24 hours)
    const { data: cleanupResult, error: cleanupError } = await supabase
      .rpc('cleanup_old_opportunities');

    if (cleanupError) {
      console.error('Cleanup error:', cleanupError);
    } else {
      console.log(`Cleaned up ${cleanupResult} old opportunities`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        deleted: cleanupResult || 0,
        timestamp: new Date().toISOString()
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in scheduled scan:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

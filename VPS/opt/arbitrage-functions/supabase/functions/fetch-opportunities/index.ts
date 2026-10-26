import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logError, logInfo } from '../utils/logger.ts';

// Get allowed origins from environment or use secure defaults
const getAllowedOrigins = (): string[] => {
  const env = Deno.env.get('ALLOWED_ORIGINS') || '';
  return env.split(',').filter(o => o.trim()) || ['http://localhost:3000', 'http://localhost:5173'];
};

const corsHeaders = {
  'Access-Control-Allow-Origin': getAllowedOrigins()[0],
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
};

interface OpportunitiesQuery {
  limit?: number;
  strategy?: string; // 'triangular_arbitrage' | 'cross_exchange'
  min_profit?: number;
  status?: string; // 'active' | 'expired'
  sort_by?: string; // 'profit' | 'detected_at'
  order?: string; // 'asc' | 'desc'
}

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const strategy = url.searchParams.get('strategy') || undefined;
    const min_profit = url.searchParams.get('min_profit') ? parseFloat(url.searchParams.get('min_profit')!) : undefined;
    const status = url.searchParams.get('status') || undefined;
    const sort_by = url.searchParams.get('sort_by') || 'detected_at';
    const order = (url.searchParams.get('order') || 'desc').toLowerCase();

    // Input validation
    if (limit > 1000 || limit < 1) {
      return new Response(
        JSON.stringify({ error: 'Limit must be between 1 and 1000' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (order !== 'asc' && order !== 'desc') {
      return new Response(
        JSON.stringify({ error: 'Order must be asc or desc' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      logError('fetch-opportunities', 'Missing Supabase configuration', {});
      return new Response(
        JSON.stringify({ error: 'Service configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const client = createClient(supabaseUrl, supabaseKey);

    logInfo('fetch-opportunities', 'Fetching opportunities', {
      limit,
      strategy,
      min_profit,
      status,
      sort_by,
      order,
    });

    let query = client
      .from('opportunities')
      .select('*');

    // Apply filters
    if (strategy) {
      query = query.eq('strategy', strategy);
    }

    if (min_profit !== undefined) {
      query = query.gte('profit_percent', min_profit);
    }

    if (status) {
      query = query.eq('status', status);
    } else {
      // Default to active opportunities
      query = query.eq('status', 'active');
    }

    // Apply sorting
    const sortColumn = sort_by === 'profit' ? 'profit_percent' : 'detected_at';
    query = query.order(sortColumn, { ascending: order === 'asc' });

    // Apply limit
    query = query.limit(limit);

    const { data, error } = await query;

    if (error) {
      logError('fetch-opportunities', 'Database query failed', { error: error.message || error });
      return new Response(
        JSON.stringify({ error: 'Failed to fetch opportunities' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        count: data?.length || 0,
        data: data || [],
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    logError('fetch-opportunities', 'Unexpected error', { error });
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

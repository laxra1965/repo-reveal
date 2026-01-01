import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ClearDataRequest {
  action: 'clear_opportunities' | 'clear_opportunities_old' | 'clear_scan_logs' | 'clear_scan_logs_old' | 'clear_all';
  daysOld?: number; // For clearing old data
}

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth token
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: No token provided' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { action, daysOld = 30 }: ClearDataRequest = await req.json();

    let deletedCount = 0;
    let details: Record<string, number> = {};

    switch (action) {
      case 'clear_opportunities':
        // Clear all opportunities for user
        const { count: oppCount } = await supabase
          .from('arbitrage_opportunities')
          .delete()
          .eq('user_id', user.id)
          .select('*', { count: 'exact', head: true });
        
        deletedCount = oppCount || 0;
        details.opportunities = deletedCount;
        break;

      case 'clear_opportunities_old':
        // Clear opportunities older than X days
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - (daysOld || 30));
        
        const { count: oldOppCount } = await supabase
          .from('arbitrage_opportunities')
          .delete()
          .eq('user_id', user.id)
          .lt('detected_at', cutoffDate.toISOString())
          .select('*', { count: 'exact', head: true });
        
        deletedCount = oldOppCount || 0;
        details.opportunities = deletedCount;
        details.daysOld = daysOld;
        break;

      case 'clear_scan_logs':
        // Clear all scan logs for user
        const { count: logCount } = await supabase
          .from('scanner_logs')
          .delete()
          .eq('user_id', user.id)
          .select('*', { count: 'exact', head: true });
        
        deletedCount = logCount || 0;
        details.scan_logs = deletedCount;
        break;

      case 'clear_scan_logs_old':
        // Clear scan logs older than X days
        const logCutoffDate = new Date();
        logCutoffDate.setDate(logCutoffDate.getDate() - (daysOld || 30));
        
        const { count: oldLogCount } = await supabase
          .from('scanner_logs')
          .delete()
          .eq('user_id', user.id)
          .lt('created_at', logCutoffDate.toISOString())
          .select('*', { count: 'exact', head: true });
        
        deletedCount = oldLogCount || 0;
        details.scan_logs = deletedCount;
        details.daysOld = daysOld;
        break;

      case 'clear_all':
        // Clear all opportunities and scan logs
        const { count: allOppCount } = await supabase
          .from('arbitrage_opportunities')
          .delete()
          .eq('user_id', user.id)
          .select('*', { count: 'exact', head: true });
        
        const { count: allLogCount } = await supabase
          .from('scanner_logs')
          .delete()
          .eq('user_id', user.id)
          .select('*', { count: 'exact', head: true });
        
        deletedCount = (allOppCount || 0) + (allLogCount || 0);
        details.opportunities = allOppCount || 0;
        details.scan_logs = allLogCount || 0;
        break;

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    return new Response(
      JSON.stringify({
        success: true,
        action,
        deletedCount,
        details,
        timestamp: new Date().toISOString()
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error: any) {
    console.error('Clear data error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
}

// Export default handler for unified server
export default handler;

// For Supabase Edge Functions compatibility
if (typeof Deno !== 'undefined' && Deno.serve) {
  serve(handler);
}


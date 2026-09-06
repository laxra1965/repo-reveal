import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-signature, x-timestamp, x-nonce',
};

interface ClearDataRequest {
  action: 'clear_opportunities' | 'clear_opportunities_old' | 'clear_scan_logs' | 'clear_scan_logs_old' | 'clear_all';
  daysOld?: number;
  opportunityIds?: string[];
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    if (!token) return json({ error: 'Unauthorized: No token provided' }, 401);

    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return json({ error: 'Unauthorized: Invalid token' }, 401);

    const { action, daysOld = 30, opportunityIds = [] }: ClearDataRequest = await req.json();

    const details: Record<string, number> = {};

    const clearOpportunities = async (olderThanDays?: number) => {
      // `opportunities` is a shared table (no user_id column).
      // When the client sends the ids it currently sees, only those are removed.
      if (opportunityIds.length > 0) {
        let removed = 0;
        for (let i = 0; i < opportunityIds.length; i += 200) {
          const batch = opportunityIds.slice(i, i + 200);
          const { data, error } = await supabase
            .from('opportunities')
            .delete()
            .in('id', batch)
            .select('id');
          if (error) throw error;
          removed += data?.length || 0;
        }
        return removed;
      }

      let query = supabase.from('opportunities').delete();
      if (olderThanDays !== undefined) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - olderThanDays);
        query = query.lt('detected_at', cutoff.toISOString());
      } else {
        // delete everything (guard clause required by PostgREST)
        query = query.not('id', 'is', null);
      }
      const { data, error } = await query.select('id');
      if (error) throw error;
      return data?.length || 0;
    };

    const clearLogs = async (olderThanDays?: number) => {
      let query = supabase.from('scanner_logs').delete().eq('user_id', user.id);
      if (olderThanDays !== undefined) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - olderThanDays);
        query = query.lt('created_at', cutoff.toISOString());
      }
      const { data, error } = await query.select('id');
      if (error) throw error;
      return data?.length || 0;
    };

    switch (action) {
      case 'clear_opportunities':
        details.opportunities = await clearOpportunities();
        break;
      case 'clear_opportunities_old':
        details.opportunities = await clearOpportunities(daysOld);
        details.daysOld = daysOld;
        break;
      case 'clear_scan_logs':
        details.scan_logs = await clearLogs();
        break;
      case 'clear_scan_logs_old':
        details.scan_logs = await clearLogs(daysOld);
        details.daysOld = daysOld;
        break;
      case 'clear_all':
        details.opportunities = await clearOpportunities();
        details.scan_logs = await clearLogs();
        break;
      default:
        return json({ error: 'Invalid action' }, 400);
    }

    const deletedCount = (details.opportunities || 0) + (details.scan_logs || 0);

    return json({
      success: true,
      action,
      deletedCount,
      details,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Clear data error:', error);
    return json({ success: false, error: error?.message || 'Unknown error' }, 500);
  }
}

export default handler;

if (typeof Deno !== 'undefined' && Deno.serve) {
  Deno.serve(handler);
}

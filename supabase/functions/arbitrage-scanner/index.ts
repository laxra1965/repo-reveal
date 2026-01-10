import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Import modules
import { fetchAllExchangeData } from './exchange-data-fetcher.ts';
import { findTriangularArbitrage, findCrossExchangeArbitrage, findShortSignals } from './scanner-core.ts';
import { processOpportunitiesPipeline, upsertOpportunities } from './opportunity-processor.ts';

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Main Handler
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Get Token and Role
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    let isServiceRole = false;

    // Quick check for service role to allow automation
    if (token) {
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]));
          isServiceRole = payload.role === 'service_role';
        }
      } catch (e) { }
    }

    // 2. Parse Body safely
    let body: any = {};
    try {
      const text = await req.text();
      if (text) body = JSON.parse(text);
    } catch (e) {
      console.warn('Body parse failed, trying URL params');
    }

    // Fallback/Merge from URL params
    const url = new URL(req.url);
    const mode = body.mode || url.searchParams.get('mode');
    const userId = body.userId || url.searchParams.get('userId');
    const action = body.action || url.searchParams.get('action');

    // 3. Fetch Global Admin Settings
    const { data: globalArbSettings } = await supabase.from('admin_settings').select('key, value').eq('key', 'enabled_arbitrage_types').maybeSingle();
    const globalEnabledTypes = globalArbSettings?.value?.split(',') || ['triangular', 'cross_exchange', 'short'];

    console.log(`Scanner invoked: mode=${mode}, action=${action}, isServiceRole=${isServiceRole}, globallyEnabled=${globalEnabledTypes.join('|')}`);

    // Auto Mode Logic - DISABLED: VPS API handles auto-trade scheduling
    if (mode === 'auto') {
      return new Response(JSON.stringify({ message: 'Auto-trade mode is handled by VPS API. Supabase edge function is deprecated for this purpose.' }), { status: 200, headers: corsHeaders });
      const { data: users } = await supabase.from('user_settings').select('*').eq('auto_trade', true);
      if (!users || users.length === 0) return new Response(JSON.stringify({ message: 'No auto-trade users found' }), { headers: corsHeaders });

      // 1. Fetch ALL required exchange data once (Network Optimization)
      const allExchs = Array.from(new Set(users.flatMap((u: any) => u.enabled_exchanges || ['binance', 'bybit', 'okx']))) as string[];
      const data = await fetchAllExchangeData(allExchs); // Returns map of "SYMBOL_EXCHANGE" -> data

      let totalProcessed = 0;
      let totalOpportunities = 0;

      // 2. Process logic PER USER (CPU Bound - ensuring correct slippage/whitelist compliance)
      for (const u of users) {
        try {
          // Check subscription status
          const { data: sub } = await supabase.from('user_subscriptions').select('*, subscription_plans(name)').eq('user_id', u.user_id).eq('status', 'active').gte('end_date', new Date().toISOString()).maybeSingle();
          if (!sub || sub.subscription_plans?.name?.includes('Tier 1')) continue;

          const tier = sub.subscription_plans?.name || '';
          const limit = tier.includes('Tier 3') ? 1000 : (tier.includes('Tier 2') ? 500 : 100);
          const amount = Math.max(5, Math.min(u.trade_amount || 10, limit)); // Enforce $5 min
          const minP = u.min_profit_percent || 0.1;
          const uEx = (u.enabled_exchanges || ['binance', 'bybit', 'okx']) as string[];
          const uTypes = (u.arbitrage_types || ['triangular', 'cross_exchange']) as string[];
          const uCustom = (u.custom_pairs || []) as string[];
          const uMl = u.enable_ml_filtering;

          // Filter price map for this user to prevent scanning disabled exchanges
          const userPriceMap: Record<string, any> = {};
          let hasData = false;
          for (const key in data) {
            const entry = data[key];
            if (uEx.includes(entry.exchange)) {
              userPriceMap[key] = entry;
              hasData = true;
            }
          }

          if (!hasData) continue;

          const tri: any[] = [];
          const cross: any[] = [];
          const short: any[] = [];

          // Execute Search Algorithms with USER SPECIFIC parameters (amount, minProfit, whitelist)
          for (const q of ['USDT', 'BNB']) {
            if (uTypes.includes('triangular') && globalEnabledTypes.includes('triangular')) {
              tri.push(...(await findTriangularArbitrage(userPriceMap, q, amount, minP, true, uCustom, true)));
            }
            if (uTypes.includes('cross_exchange') && globalEnabledTypes.includes('cross_exchange')) {
              cross.push(...findCrossExchangeArbitrage(userPriceMap, q, amount, minP, true, uCustom, true));
            }
            if (uTypes.includes('short') && globalEnabledTypes.includes('short')) {
              short.push(...findShortSignals(userPriceMap, q, amount, minP, uCustom));
            }
          }

          // Pipeline: Deduplicate -> Score -> Sort -> Limit
          const { opportunities } = processOpportunitiesPipeline(tri, cross, short, minP, 50, uMl);

          // Attach User ID
          const finalOpportunities = opportunities.map((o: any) => ({ ...o, user_id: u.user_id }));

          if (finalOpportunities.length > 0) {
            const res = await upsertOpportunities(supabase, finalOpportunities);
            console.log(`User ${u.user_id}: Found ${opportunities.length} (Upserted ${res.inserted})`);
            totalOpportunities += res.inserted;
          }
          totalProcessed++;

        } catch (err) {
          console.error(`Error processing user ${u.user_id}:`, err);
        }
      }

      console.log(`Auto-Scan Complete: Processed ${totalProcessed} users, ${totalOpportunities} new opportunities.`);
      return new Response(JSON.stringify({ success: true, processed: totalProcessed, opportunities: totalOpportunities }), { headers: corsHeaders });
    }

    // Manual Scan / Action logic
    let finalUserId = userId;

    if (!finalUserId && token) {
      const { data: { user } } = await supabase.auth.getUser(token);
      finalUserId = user?.id;
    }

    if (!finalUserId && !isServiceRole) {
      return new Response(JSON.stringify({ error: 'Unauthorized: No valid user session or ID' }), { status: 401, headers: corsHeaders });
    }

    // If still no finalUserId but it IS service role, we need a target userId from settings or body
    if (!finalUserId && isServiceRole) {
      return new Response(JSON.stringify({ error: 'Service role requires a target userId for manual scans' }), { status: 400, headers: corsHeaders });
    }

    console.log(`Performing manual scan for user: ${finalUserId}`);
    const { data: settings } = await supabase.from('user_settings').select('*').eq('user_id', finalUserId).single();
    if (!settings) return new Response(JSON.stringify({ error: 'User settings not found' }), { status: 404, headers: corsHeaders });

    const exData = await fetchAllExchangeData(settings.enabled_exchanges || ['binance', 'bybit', 'okx']);
    const tri: any[] = [];
    const cross: any[] = [];
    const short: any[] = [];

    const userTypes = settings.arbitrage_types || ['triangular', 'cross_exchange'];
    const activeTypes = userTypes.filter((t: string) => globalEnabledTypes.includes(t));
    const minP = settings.min_profit_percent || 0.1;

    console.log(`Manual Scan Config: Amount=${settings.trade_amount}, MinProfit=${minP}%`);

    for (const q of ['USDT', 'BNB']) {
      if (activeTypes.includes('triangular')) tri.push(...(await findTriangularArbitrage(exData, q, settings.trade_amount || 10, minP, true, settings.custom_pairs || [])));
      if (activeTypes.includes('cross_exchange')) cross.push(...findCrossExchangeArbitrage(exData, q, settings.trade_amount || 10, minP, true, settings.custom_pairs || []));
      if (activeTypes.includes('short')) short.push(...findShortSignals(exData, q, settings.trade_amount || 10, minP, settings.custom_pairs || []));
    }

    const { opportunities } = processOpportunitiesPipeline(tri, cross, short, minP, 50, settings.enable_ml_filtering);
    await upsertOpportunities(supabase, opportunities.map((o: any) => ({ ...o, user_id: finalUserId })));

    return new Response(JSON.stringify({
      success: true,
      count: opportunities.length,
      opportunities_count: opportunities.length,
      data: opportunities
    }), { headers: corsHeaders });

  } catch (err: any) {
    console.error('Scanner Error:', err);
    return new Response(JSON.stringify({ error: err.message, stack: err.stack }), { status: 500, headers: corsHeaders });
  }
}

// For Supabase Edge Functions compatibility
if (typeof Deno !== 'undefined' && Deno.serve) {
  serve(handler);
}

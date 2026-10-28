import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logError, logInfo } from './logger.ts';
import { StandardOpportunity, formatPath } from './opportunity-types.ts';

interface BufferedRow {
  detected_at: string;
  strategy: string;
  path: string;
  exchange1: string | null;
  exchange2: string | null;
  exchange3: string | null;
  pair1: string | null;
  pair2: string | null;
  pair3: string | null;
  profit_percent: number;
  liquidity_score: number;
  volume_estimate: number;
   estimated_slippage: number;
  status: string;
}

const buffer: StandardOpportunity[] = [];
// Path -> Last saved timestamp (epoch seconds)
const pathCooldowns = new Map<string, number>();

const FLUSH_INTERVAL_MS = parseInt(Deno.env.get('OPPORTUNITY_FLUSH_MS') || '5000', 10);
const MAX_BUFFER_SIZE = parseInt(Deno.env.get('OPPORTUNITY_BUFFER_MAX') || '1000', 10);
const PATH_COOLDOWN_SECONDS = parseInt(Deno.env.get('OPPORTUNITY_PATH_COOLDOWN_SECONDS') || '60', 10);

let supabase: SupabaseClient | null = null;

const getSupabase = (): SupabaseClient | null => {
  if (supabase) return supabase;

  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !key) {
    logError('opportunity-buffer', 'Missing Supabase configuration for batch writer', {});
    return null;
  }

  supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        'x-client-info': 'arbitrage-bot-vps',
      }
    }
  });
  return supabase;
};

const buildDedupKey = (opp: StandardOpportunity): string => {
  const ex = opp.exchange1 || opp.exchange || opp.primary_exchange || 'unknown';
  const p1 = opp.pair1 || '';
  const p2 = opp.pair2 || '';
  const p3 = opp.pair3 || '';
  return `${ex}-${p1}-${p2}-${p3}`;
};

const toBufferedRow = (opp: StandardOpportunity): BufferedRow => ({
  detected_at: new Date(opp.detected_at * 1000).toISOString(),
  strategy: opp.strategy,
  path: formatPath(opp.path),
  exchange1: opp.exchange1,
  exchange2: opp.exchange2,
  exchange3: opp.exchange3,
  pair1: opp.pair1,
  pair2: opp.pair2,
  pair3: opp.pair3,
  profit_percent: opp.profit_percent,
  liquidity_score: opp.liquidity_score,
  volume_estimate: opp.volume_estimate,
  estimated_slippage: opp.estimated_slippage,
  status: opp.status,
});

// Quality filters before buffering
// Note: When env vars are 0, they disable filtering (allow all)
// When not set, defaults are used (more permissive than before)
const MIN_PROFIT_PERCENT = Deno.env.get('MIN_PROFIT_PERCENT') !== undefined 
  ? parseFloat(Deno.env.get('MIN_PROFIT_PERCENT')!) 
  : 0; // Default to 0 (allow all profit levels including marginal)
  
const MIN_LIQUIDITY_SCORE = Deno.env.get('MIN_LIQUIDITY_SCORE') !== undefined 
  ? parseFloat(Deno.env.get('MIN_LIQUIDITY_SCORE')!) 
  : 0; // Default to 0 (allow all liquidity levels including partial depth)
  
const MAX_SLIPPAGE = Deno.env.get('MAX_SLIPPAGE') !== undefined 
  ? parseFloat(Deno.env.get('MAX_SLIPPAGE')!) 
  : 2.0; // Default to 2% slippage tolerance (increased from 1%)

export const enqueueStandardOpportunities = (opps: StandardOpportunity[]): void => {
  const nowSec = Math.floor(Date.now() / 1000);

  for (const raw of opps) {
    const opp: StandardOpportunity = {
      ...raw,
      detected_at: raw.detected_at || nowSec,
      status: raw.status || 'active',
    };

    // Apply filters only if they're actually set
    if (MIN_PROFIT_PERCENT > 0 && opp.profit_percent < MIN_PROFIT_PERCENT) {
      continue;
    }
    if (MIN_LIQUIDITY_SCORE > 0 && opp.liquidity_score < MIN_LIQUIDITY_SCORE) {
      continue;
    }
    if (opp.estimated_slippage > MAX_SLIPPAGE) {
      continue;
    }

    const key = buildDedupKey(opp);
    const lastSaved = pathCooldowns.get(key) || 0;
    
    // Skip if this path was saved recently (within cooldown window)
    if (nowSec - lastSaved < PATH_COOLDOWN_SECONDS) {
      continue;
    }
    
    pathCooldowns.set(key, nowSec);
    buffer.push(opp);

    if (buffer.length >= MAX_BUFFER_SIZE) {
      // Best effort synchronous flush when buffer is full
      void flushBuffer();
    }
  }
};

let flushing = false;
const flushBuffer = async (): Promise<void> => {
  if (flushing) return;
  if (buffer.length === 0) {
    void logInfo('opportunity-buffer', 'Buffer empty, skipping flush', {});
    return;
  }

  const client = getSupabase();
  if (!client) {
    logError('opportunity-buffer', 'Supabase client unavailable', {});
    return;
  }

  flushing = true;
  const batch = buffer.splice(0, 100);
  const rows: BufferedRow[] = batch.map(toBufferedRow);

  try {
    console.log(`[FLUSH] Attempting to insert ${rows.length} rows`);
    console.log('[FLUSH] First row:', JSON.stringify(rows[0]));
    
    // In Supabase v2, we must chain .select() if we want to get the inserted data back
    // to verify the count. The service role key should bypass RLS automatically.
    const result = await client
      .from('opportunities')
      .insert(rows)
      .select('id');
    
    const rowsInserted = result.data?.length || 0;
    
    if (result.error) {
      const errorMsg = typeof result.error === 'string' ? result.error : JSON.stringify(result.error);
      logError('opportunity-buffer', '❌ INSERT FAILED - SQL Error', {
        error: errorMsg,
        rows_count: rows.length,
        rows_inserted: rowsInserted,
      });
      buffer.unshift(...batch.slice(0, MAX_BUFFER_SIZE - buffer.length));
      console.error('[writer] insert failed');
      return;
    }
    
    // CRITICAL: Check if RLS silently blocked the insert
    if (rowsInserted === 0 && rows.length > 0) {
      logError('opportunity-buffer', '❌ RLS BLOCKING INSERT - Zero rows persisted (RLS policy or permissions issue)', {
        attempted: rows.length,
        actual_inserted: 0,
        likely_cause: 'Row Level Security (RLS) enabled or policy misconfigured',
        fix: 'Check service-role configuration and explicit table grants; keep RLS enabled',
      });
      console.error('[RLS-BLOCK] Inserted 0 rows out of', rows.length, 'attempted. RLS is likely blocking inserts!');
      console.error('[writer] Keep RLS enabled; check service configuration and grants');
      return;
    }
    
    // Success case
    logInfo('opportunity-buffer', '✅ Batch insert completed successfully', {
      count: rows.length,
      rows_inserted: rowsInserted,
    });
    console.log('[SUCCESS] Inserted', rowsInserted, '/', rows.length, 'rows successfully');
  } catch (err) {
    logError('opportunity-buffer', '❌ EXCEPTION in batch insert', {
      error: String(err),
      message: err instanceof Error ? err.message : 'Unknown',
    });
    buffer.unshift(...batch.slice(0, MAX_BUFFER_SIZE - buffer.length));
    console.error('[writer] insert exception');
  } finally { flushing = false; }
};

// Start background flush loop only in long-lived VPS runtime
const runtime = Deno.env.get('RUNTIME');
if (runtime === 'vps') {
  logInfo('opportunity-buffer', 'Starting background batch writer', {
    interval_ms: FLUSH_INTERVAL_MS,
  });
  setInterval(() => {
    void flushBuffer();
  }, FLUSH_INTERVAL_MS);
}


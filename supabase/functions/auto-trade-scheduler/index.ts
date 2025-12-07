import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('=== Auto Trade Scheduler Started ===');

    // Step 1: Queue auto trades for users with auto_trade enabled
    console.log('Step 1: Queuing auto trades for eligible users...');
    const { data: queueResult, error: queueError } = await supabase
      .rpc('queue_auto_trades_for_users');

    if (queueError) {
      console.error('Queue error:', queueError);
      throw new Error(`Failed to queue trades: ${queueError.message}`);
    }

    const usersProcessed = queueResult?.[0]?.users_processed || 0;
    const tradesQueued = queueResult?.[0]?.trades_queued || 0;
    
    console.log(`Queued ${tradesQueued} trades for ${usersProcessed} users`);

    // Step 2: Process pending auto trades
    console.log('Step 2: Processing pending auto trades...');
    const { data: processResult, error: processError } = await supabase
      .rpc('process_pending_auto_trades');

    if (processError) {
      console.error('Process error:', processError);
      throw new Error(`Failed to process trades: ${processError.message}`);
    }

    const processed = processResult?.[0]?.processed || 0;
    const succeeded = processResult?.[0]?.succeeded || 0;
    const failed = processResult?.[0]?.failed || 0;

    console.log(`Processed ${processed} trades: ${succeeded} succeeded, ${failed} failed`);

    // Step 3: Get pending trades that need execution via edge function
    const { data: pendingExecutions, error: pendingError } = await supabase
      .from('trade_history')
      .select('id, user_id')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(10);

    if (pendingError) {
      console.error('Pending fetch error:', pendingError);
    }

    let executedCount = 0;
    let executionErrors: string[] = [];

    // Step 4: Execute pending trades via the execute-trade function
    if (pendingExecutions && pendingExecutions.length > 0) {
      console.log(`Step 4: Executing ${pendingExecutions.length} pending trades...`);
      
      for (const trade of pendingExecutions) {
        try {
          const { data: execResult, error: execError } = await supabase.functions.invoke('execute-trade', {
            body: { 
              action: 'execute_single',
              tradeId: trade.id,
              userId: trade.user_id
            }
          });

          if (execError) {
            executionErrors.push(`Trade ${trade.id}: ${execError.message}`);
            console.error(`Execution error for trade ${trade.id}:`, execError);
          } else if (execResult?.success) {
            executedCount++;
            console.log(`Successfully executed trade ${trade.id}`);
          } else {
            executionErrors.push(`Trade ${trade.id}: ${execResult?.error || 'Unknown error'}`);
          }
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : 'Unknown error';
          executionErrors.push(`Trade ${trade.id}: ${errorMsg}`);
          console.error(`Exception executing trade ${trade.id}:`, e);
        }
      }
    }

    // Step 5: Cleanup expired opportunities
    console.log('Step 5: Cleaning up expired opportunities...');
    const { data: cleanupResult, error: cleanupError } = await supabase
      .rpc('cleanup_expired_opportunities');

    if (cleanupError) {
      console.error('Cleanup error:', cleanupError);
    }

    const deletedOpportunities = cleanupResult?.[0]?.deleted_count || 0;

    // Step 6: Get auto trade status for monitoring
    const { data: statusData, error: statusError } = await supabase
      .rpc('get_auto_trade_status');

    const executionTime = Date.now() - startTime;

    // Log the scheduler run
    await supabase.from('scanner_health_metrics').insert([
      { metric_name: 'scheduler_run_time_ms', metric_value: executionTime },
      { metric_name: 'trades_queued', metric_value: tradesQueued },
      { metric_name: 'trades_processed', metric_value: processed },
      { metric_name: 'trades_executed', metric_value: executedCount },
      { metric_name: 'trades_failed', metric_value: failed + executionErrors.length }
    ]);

    console.log('=== Auto Trade Scheduler Completed ===');
    console.log(`Total execution time: ${executionTime}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        execution_time_ms: executionTime,
        queue_phase: {
          users_processed: usersProcessed,
          trades_queued: tradesQueued
        },
        process_phase: {
          processed,
          succeeded,
          failed
        },
        execution_phase: {
          pending_count: pendingExecutions?.length || 0,
          executed: executedCount,
          errors: executionErrors
        },
        cleanup: {
          deleted_opportunities: deletedOpportunities
        },
        status: statusData?.[0] || null
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    const executionTime = Date.now() - startTime;
    console.error('Scheduler error:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        execution_time_ms: executionTime,
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

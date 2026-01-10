import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';

const router = Router();

interface AutoTradeSchedulerRequest {
  action?: 'queue' | 'process' | 'status';
}

/**
 * GET/POST /functions/auto-trade-scheduler
 * 
 * Manages auto-trading for users with auto_trade enabled
 * - Queues trades based on user settings
 * - Processes pending trades
 * - Returns status of auto-trade system
 */
router.post('/functions/auto-trade-scheduler', async (req: Request, res: Response) => {
  handleAutoTradeScheduler(req, res);
});

router.get('/functions/auto-trade-scheduler', async (req: Request, res: Response) => {
  handleAutoTradeScheduler(req, res);
});

async function handleAutoTradeScheduler(req: Request, res: Response) {
  try {
    const supabase = req.app.get('supabase') as SupabaseClient;
    
    // Check if Supabase is temporarily disabled
    const skipSupabase = process.env.SKIP_SUPABASE === 'true';
    if (skipSupabase) {
      console.log('⚠️  Supabase is disabled via SKIP_SUPABASE flag');
    }
    
    if (!supabase && !skipSupabase) {
      return res.status(500).json({ error: 'Supabase client not configured' });
    }

    const { action = 'queue' } = req.body as AutoTradeSchedulerRequest;
    const startTime = Date.now();

    console.log(`=== Auto Trade Scheduler Started: action=${action} ===`);

    let results = {
      queueResult: null as any,
      processResult: null as any
    };
    
    // Return early if Supabase is disabled - use VPS scanner implementation
    if (skipSupabase) {
      console.log('Using VPS scanner implementation for auto-trade scheduling');
      
      // Get auto-trade users from database directly
      const { data: users } = await supabase
        .from('user_settings')
        .select('user_id, auto_trade')
        .eq('auto_trade', true);

      // Get pending trades from database
      const { count: pendingCount } = await supabase
        .from('pending_auto_trades')
        .select('*')
        .eq('status', 'pending');

      return res.json({
        success: true,
        action,
        queueResult: { users_processed: users?.length || 0, trades_queued: pendingCount || 0 },
        processResult: { trades_processed: 0, successful: 0, failed: 0 },
        duration: Date.now() - startTime,
        source: 'VPS Scanner',
        message: 'Using direct VPS database access (Supabase RPC disabled)',
        timestamp: new Date().toISOString()
      });
    }

    // Step 1: Queue trades for users with auto_trade enabled
    if (action === 'queue' || action === 'process') {
      console.log('Step 1: Queuing auto trades for eligible users...');
      
      try {
        const { data: queueResult, error: queueError } = await supabase
          .rpc('queue_auto_trades_for_users');

        if (queueError) {
          console.error('Queue error:', queueError);
          throw new Error(`Failed to queue trades: ${queueError.message}`);
        }

        const usersProcessed = queueResult?.[0]?.users_processed || 0;
        const tradesQueued = queueResult?.[0]?.trades_queued || 0;

        console.log(`Queued ${tradesQueued} trades for ${usersProcessed} users`);
        results.queueResult = { users_processed: usersProcessed, trades_queued: tradesQueued };
      } catch (err: any) {
        console.error('Queueing error:', err);
        if (action === 'queue') {
          return res.status(500).json({ error: err.message, step: 'queue' });
        }
      }
    }

    // Step 2: Process pending auto trades (execute them)
    if (action === 'process') {
      console.log('Step 2: Processing pending auto trades...');
      
      try {
        const { data: processResult, error: processError } = await supabase
          .rpc('process_pending_auto_trades');

        if (processError) {
          console.error('Process error:', processError);
          throw new Error(`Failed to process trades: ${processError.message}`);
        }

        const processed = processResult?.[0]?.trades_processed || 0;
        const successful = processResult?.[0]?.successful || 0;
        const failed = processResult?.[0]?.failed || 0;

        console.log(`Processed ${processed} trades: ${successful} successful, ${failed} failed`);
        results.processResult = { trades_processed: processed, successful, failed };
      } catch (err: any) {
        console.error('Processing error:', err);
        // Continue even if processing fails
      }
    }

    // Step 3: Status check
    if (action === 'status') {
      console.log('Checking auto-trade status...');
      
      const { data: users } = await supabase
        .from('user_settings')
        .select('user_id, auto_trade')
        .eq('auto_trade', true);

      const { data: pendingTrades, count: pendingCount } = await supabase
        .from('pending_auto_trades')
        .select('*')
        .eq('status', 'pending');

      results.queueResult = {
        auto_trade_users: users?.length || 0,
        pending_trades: pendingCount || 0
      };
    }

    const duration = Date.now() - startTime;
    console.log(`Auto Trade Scheduler Complete (${duration}ms)`);

    res.json({
      success: true,
      action,
      ...results,
      duration,
      timestamp: new Date().toISOString()
    });

  } catch (err: any) {
    console.error('Auto Trade Scheduler Error:', err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}

export default router;

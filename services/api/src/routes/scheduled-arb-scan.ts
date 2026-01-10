import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';

const router = Router();

interface ScheduledScanRequest {
  action?: 'cleanup' | 'status';
  daysOld?: number;
}

/**
 * GET/POST /functions/scheduled-arb-scan
 * 
 * Scheduled cleanup and maintenance for arbitrage scanning
 * - Removes old/stale opportunities
 * - Cleanup completed trades
 * - Generate reports
 */
router.post('/functions/scheduled-arb-scan', async (req: Request, res: Response) => {
  handleScheduledScan(req, res);
});

router.get('/functions/scheduled-arb-scan', async (req: Request, res: Response) => {
  handleScheduledScan(req, res);
});

async function handleScheduledScan(req: Request, res: Response) {
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

    const { action = 'cleanup', daysOld = 1 } = req.body as ScheduledScanRequest;
    const startTime = Date.now();

    console.log(`Scheduled scan: action=${action}, daysOld=${daysOld}`);

    if (action === 'cleanup') {
      if (skipSupabase) {
        // Use VPS scanner - cleanup directly from database
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);
        
        const { count, error } = await supabase
          .from('arbitrage_opportunities')
          .delete()
          .lt('detected_at', cutoffDate.toISOString())
          .select('*');
        
        if (error) {
          console.error('VPS cleanup error:', error);
          return res.status(500).json({ error: error.message });
        }

        return res.json({
          success: true,
          action: 'cleanup',
          deleted: count || 0,
          duration: Date.now() - startTime,
          source: 'VPS Scanner',
          timestamp: new Date().toISOString()
        });
      }
      
      // Call RPC to cleanup old opportunities
      const { data: cleanupResult, error: cleanupError } = await supabase
        .rpc('cleanup_old_opportunities');

      if (cleanupError) {
        console.error('Cleanup error:', cleanupError);
        return res.status(500).json({ error: cleanupError.message });
      }

      return res.json({
        success: true,
        action: 'cleanup',
        deleted: cleanupResult || 0,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString()
      });
    }

    if (action === 'status') {
      if (skipSupabase) {
        // Use VPS scanner - query database directly
        const { count: pendingCount } = await supabase
          .from('arbitrage_opportunities')
          .select('*')
          .eq('status', 'pending');

        const { count: completedCount } = await supabase
          .from('arbitrage_opportunities')
          .select('*')
          .eq('status', 'completed');

        return res.json({
          success: true,
          action: 'status',
          pending: pendingCount || 0,
          completed: completedCount || 0,
          duration: Date.now() - startTime,
          source: 'VPS Scanner',
          timestamp: new Date().toISOString()
        });
      }
      
      // Get statistics on current opportunities
      const { data: opportunities, count } = await supabase
        .from('arbitrage_opportunities')
        .select('*')
        .eq('status', 'pending');

      const { data: completedCount } = await supabase
        .from('arbitrage_opportunities')
        .select('*')
        .eq('status', 'completed');

      return res.json({
        success: true,
        action: 'status',
        pending: count || 0,
        completed: completedCount?.[0]?.count || 0,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString()
      });
    }

    res.status(400).json({ error: 'Invalid action' });

  } catch (err: any) {
    console.error('Scheduled Scan Error:', err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}

export default router;

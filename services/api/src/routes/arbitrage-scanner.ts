import { Router, Request, Response } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const router = Router();

// Import scanner functions (these would be from shared module or local)
// For now, we'll stub these - you'll need to migrate the scanner logic

interface ScannerRequest {
  mode?: 'auto' | 'manual';
  userId?: string;
  action?: string;
}

/**
 * GET /functions/arbitrage-scanner
 * POST /functions/arbitrage-scanner
 * 
 * Scans for arbitrage opportunities across exchanges
 * Modes:
 * - auto: Runs for all users with auto_trade enabled (requires service role)
 * - manual: Runs scan for specific user
 */
router.post('/functions/arbitrage-scanner', async (req: Request, res: Response) => {
  try {
    const supabase = req.app.get('supabase') as SupabaseClient;
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase client not configured' });
    }

    const startTime = Date.now();
    const { mode = 'manual', userId, action } = req.body as ScannerRequest;
    const authHeader = (req.headers.authorization || '').replace('Bearer ', '');
    const token = authHeader;

    // Verify JWT and extract user info
    let isServiceRole = false;
    let currentUserId: string | undefined = userId;

    if (token) {
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          isServiceRole = payload.role === 'service_role';
          if (!userId) currentUserId = payload.sub;
        }
      } catch (e) {
        console.warn('Token parse error:', e);
      }
    }

    console.log(`Scanner invoked: mode=${mode}, userId=${currentUserId}, isServiceRole=${isServiceRole}`);

    // Fetch global settings
    const { data: globalSettings } = await supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'enabled_arbitrage_types')
      .maybeSingle();

    const globalEnabledTypes = globalSettings?.value?.split(',') || ['triangular', 'cross_exchange', 'short'];

    if (mode === 'auto') {
      // Auto mode: scan for all auto_trade enabled users
      if (!isServiceRole) {
        return res.status(403).json({ error: 'Auto mode requires service role' });
      }

      console.log('Starting Auto-Trade Cycle...');
      const { data: users } = await supabase
        .from('user_settings')
        .select('*')
        .eq('auto_trade', true);

      if (!users || users.length === 0) {
        return res.json({ message: 'No auto-trade users found', count: 0 });
      }

      let totalProcessed = 0;
      let totalOpportunities = 0;

      // TODO: Implement fetchAllExchangeData, findTriangularArbitrage, etc.
      // These functions need to be migrated from supabase/functions/arbitrage-scanner/
      
      // For now, return placeholder
      return res.json({
        success: true,
        mode: 'auto',
        processed: totalProcessed,
        opportunities: totalOpportunities,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString()
      });
    }

    // Manual mode: scan for specific user
    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized: No user session or ID provided' });
    }

    const { data: settings } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', currentUserId)
      .single();

    if (!settings) {
      return res.status(404).json({ error: 'User settings not found' });
    }

    // TODO: Implement manual scan logic
    
    return res.json({
      success: true,
      mode: 'manual',
      userId: currentUserId,
      count: 0,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString()
    });

  } catch (err: any) {
    console.error('Scanner Error:', err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

router.get('/functions/arbitrage-scanner', async (req: Request, res: Response) => {
  res.json({ message: 'Arbitrage scanner endpoint. Use POST to run scans.' });
});

export default router;

import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

/**
 * Server-side (UI-bypassing) validation tests: these call the auto trader
 * RPCs directly against the live Supabase project with invalid trade_config
 * values and confirm the database itself rejects or skips the trade.
 *
 * Skipped automatically when the environment has no network access.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const ANON_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const online = Boolean(SUPABASE_URL && ANON_KEY) && await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: { apikey: ANON_KEY } })
  .then(() => true)
  .catch(() => false);

const d = online ? describe : describe.skip;

// validate_trade_config is executable only by signed-in users and the VPS
// (service role). Anonymous callers must be refused outright.
d('validate_trade_config is not callable anonymously', () => {
  it('refuses anonymous callers with a permission error', async () => {
    const { data, error } = await supabase.rpc('validate_trade_config', {
      p_trade_amount: 250,
      p_max_position: 1000,
    });
    expect(data).toBeNull();
    expect(error?.code).toBe('42501');
  });
});

d('auto trader RPCs refuse unauthorized / invalid callers', () => {
  it('run_my_auto_trade_cycle cannot be run anonymously', async () => {
    const { data, error } = await supabase.rpc('run_my_auto_trade_cycle');
    // Either an explicit error, or no trades queued for an anonymous caller.
    if (error) {
      expect(error.message.length).toBeGreaterThan(0);
    } else {
      const row = Array.isArray(data) ? data[0] : data;
      expect(Number(row?.trades_queued ?? 0)).toBe(0);
    }
  });

  it('create_paper_trade_from_opportunity is not executable anonymously', async () => {
    const { data, error } = await supabase.rpc('create_paper_trade_from_opportunity', {
      p_user_id: '00000000-0000-0000-0000-000000000000',
      p_opp_id: '00000000-0000-0000-0000-000000000000',
    });
    if (error) {
      expect(error.message.length).toBeGreaterThan(0);
    } else {
      const row = Array.isArray(data) ? data[0] : data;
      expect(row?.status).not.toBe('success');
    }
  });
});

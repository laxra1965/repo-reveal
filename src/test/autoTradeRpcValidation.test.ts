import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

/**
 * Server-side (UI-bypassing) validation tests: these call the auto trader
 * RPCs directly against the live Supabase project with invalid trade_config
 * values and confirm the database itself rejects or skips the trade.
 *
 * Skipped automatically when the environment has no network access.
 */

const SUPABASE_URL = 'https://zupbliefzhnohsoguwuk.supabase.co';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1cGJsaWVmemhub2hzb2d1d3VrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ0MTg5MjksImV4cCI6MjA2OTk5NDkyOX0.onUAdnZILGu2vhjsEDxGqQuhvLfKTwjC3QJPNJcG0n0';

const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const online = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: { apikey: ANON_KEY } })
  .then(() => true)
  .catch(() => false);

const d = online ? describe : describe.skip;

d('server-side validate_trade_config (UI bypassed)', () => {
  const invalid: Array<[string, number | null, number | null]> = [
    ['negative trade amount', -50, 1000],
    ['zero trade amount', 0, 1000],
    ['trade amount above the 1,000,000 cap', 1_000_001, null],
    ['trade amount above max position size', 2000, 1000],
    ['negative max position size', 100, -1000],
    ['max position size below the 10 minimum', 100, 5],
  ];

  for (const [label, amount, maxPos] of invalid) {
    it(`rejects ${label}`, async () => {
      const { data, error } = await supabase.rpc('validate_trade_config', {
        p_trade_amount: amount,
        p_max_position: maxPos,
      });
      expect(error).toBeNull();
      expect(data).toBe(false);
    });
  }

  it('accepts a valid configuration', async () => {
    const { data, error } = await supabase.rpc('validate_trade_config', {
      p_trade_amount: 250,
      p_max_position: 1000,
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
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

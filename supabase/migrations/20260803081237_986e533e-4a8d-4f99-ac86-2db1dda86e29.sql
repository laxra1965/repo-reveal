-- 1. Admin helper
CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = _user_id);
$$;

-- 2. Scheduler run history
CREATE TABLE IF NOT EXISTS public.scheduler_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'unknown',
  triggered_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  users_processed integer NOT NULL DEFAULT 0,
  inserts_attempted integer NOT NULL DEFAULT 0,
  successes integer NOT NULL DEFAULT 0,
  failures integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.scheduler_runs TO authenticated;
GRANT ALL ON public.scheduler_runs TO service_role;

ALTER TABLE public.scheduler_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view scheduler runs"
ON public.scheduler_runs FOR SELECT TO authenticated
USING (public.is_platform_admin(auth.uid()));

CREATE POLICY "Service role manages scheduler runs"
ON public.scheduler_runs FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_scheduler_runs_started_at ON public.scheduler_runs (started_at DESC);

-- 3. Admin read access for the trade queue admin page
CREATE POLICY "Admins can view all trade history"
ON public.trade_history FOR SELECT TO authenticated
USING (public.is_platform_admin(auth.uid()));

CREATE POLICY "Admins can view all queued trades"
ON public.auto_trade_queue FOR SELECT TO authenticated
USING (public.is_platform_admin(auth.uid()));

CREATE POLICY "Admins can view all profiles"
ON public.profiles FOR SELECT TO authenticated
USING (public.is_platform_admin(auth.uid()));

-- 4. Logging helper callable by service role / definer functions
CREATE OR REPLACE FUNCTION public.log_scheduler_run(
  p_source text,
  p_started_at timestamptz,
  p_users_processed integer,
  p_inserts_attempted integer,
  p_successes integer,
  p_failures integer,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.scheduler_runs (
    source, triggered_by, started_at, finished_at, duration_ms,
    users_processed, inserts_attempted, successes, failures, details
  ) VALUES (
    p_source, auth.uid(), p_started_at, now(),
    (EXTRACT(EPOCH FROM (now() - p_started_at)) * 1000)::integer,
    COALESCE(p_users_processed, 0), COALESCE(p_inserts_attempted, 0),
    COALESCE(p_successes, 0), COALESCE(p_failures, 0), COALESCE(p_details, '{}'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_scheduler_run(text, timestamptz, integer, integer, integer, integer, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.log_scheduler_run(text, timestamptz, integer, integer, integer, integer, jsonb) TO service_role, authenticated;

-- 5. Reconciliation of duplicate / overlapping trades
CREATE OR REPLACE FUNCTION public.reconcile_duplicate_trades()
RETURNS TABLE(trades_cancelled integer, queue_cancelled integer, queue_relinked integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_trades integer := 0;
  v_queue integer := 0;
  v_relinked integer := 0;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin required';
  END IF;

  -- Cancel duplicate open trades for the same user + opportunity, keeping the oldest
  WITH ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY user_id, opportunity_id
             ORDER BY created_at, id
           ) AS rn
    FROM public.trade_history
    WHERE status IN ('pending'::public.trade_status, 'executing'::public.trade_status)
      AND opportunity_id IS NOT NULL
  ), upd AS (
    UPDATE public.trade_history th
    SET status = 'cancelled'::public.trade_status,
        completed_at = now(),
        error_message = COALESCE(th.error_message, 'Cancelled by reconciliation: duplicate open trade for the same opportunity')
    FROM ranked r
    WHERE th.id = r.id AND r.rn > 1
    RETURNING th.id
  )
  SELECT count(*)::integer INTO v_trades FROM upd;

  -- Cancel duplicate open queue rows per user, keeping the oldest
  WITH ranked AS (
    SELECT id,
           row_number() OVER (PARTITION BY user_id ORDER BY queued_at, id) AS rn
    FROM public.auto_trade_queue
    WHERE status IN ('queued', 'processing', 'executing')
  ), upd AS (
    UPDATE public.auto_trade_queue q
    SET status = 'cancelled',
        completed_at = now(),
        error_message = COALESCE(q.error_message, 'Cancelled by reconciliation: overlapping queue entry')
    FROM ranked r
    WHERE q.id = r.id AND r.rn > 1
    RETURNING q.id
  )
  SELECT count(*)::integer INTO v_queue FROM upd;

  -- Re-link queue rows whose trade already finished
  WITH upd AS (
    UPDATE public.auto_trade_queue q
    SET status = th.status::text,
        completed_at = COALESCE(th.completed_at, now()),
        error_message = th.error_message
    FROM public.trade_history th
    WHERE q.user_id = th.user_id
      AND q.opportunity_id = th.opportunity_id
      AND q.status IN ('queued', 'processing', 'executing')
      AND th.status IN ('completed'::public.trade_status, 'failed'::public.trade_status, 'cancelled'::public.trade_status)
    RETURNING q.id
  )
  SELECT count(*)::integer INTO v_relinked FROM upd;

  RETURN QUERY SELECT v_trades, v_queue, v_relinked;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_duplicate_trades() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_duplicate_trades() TO authenticated, service_role;

-- 6. Log scheduler cycles
CREATE OR REPLACE FUNCTION public.admin_run_auto_trade_cycle()
 RETURNS TABLE(users_processed integer, trades_queued integer, processed integer, succeeded integer, failed integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_elapsed integer;
  v_row record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin required';
  END IF;

  SELECT * INTO v_row FROM public.run_auto_trade_cycle();
  v_elapsed := (EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)::integer;

  PERFORM public.log_scheduler_run(
    'admin_rpc', v_started,
    COALESCE(v_row.users_processed, 0),
    COALESCE(v_row.trades_queued, 0),
    COALESCE(v_row.succeeded, 0),
    COALESCE(v_row.failed, 0),
    jsonb_build_object('trades_processed', COALESCE(v_row.processed, 0), 'manual', true)
  );

  INSERT INTO public.scanner_logs (user_id, log_type, message, details)
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    'scheduler_summary',
    'Manual auto-trade cycle triggered by admin RPC',
    jsonb_build_object(
      'manual', true,
      'fallback', 'admin_rpc',
      'triggered_by', auth.uid(),
      'execution_time_ms', v_elapsed,
      'trades_queued', COALESCE(v_row.trades_queued, 0),
      'trades_processed', COALESCE(v_row.processed, 0),
      'trades_executed', COALESCE(v_row.succeeded, 0),
      'trades_failed', COALESCE(v_row.failed, 0)
    )
  );

  RETURN QUERY SELECT
    COALESCE(v_row.users_processed, 0)::integer,
    COALESCE(v_row.trades_queued, 0)::integer,
    COALESCE(v_row.processed, 0)::integer,
    COALESCE(v_row.succeeded, 0)::integer,
    COALESCE(v_row.failed, 0)::integer;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_duplicate_trades(p_dry_run boolean DEFAULT false)
 RETURNS TABLE(trades_cancelled integer, queue_cancelled integer, queue_relinked integer, dry_run boolean, conflicts jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_trades integer := 0;
  v_queue integer := 0;
  v_relinked integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin required';
  END IF;

  IF p_dry_run THEN
    WITH ranked_trades AS (
      SELECT id, user_id, opportunity_id, created_at,
             row_number() OVER (PARTITION BY user_id, opportunity_id ORDER BY created_at, id) AS rn
      FROM public.trade_history
      WHERE status IN ('pending'::public.trade_status, 'executing'::public.trade_status)
        AND opportunity_id IS NOT NULL
    ),
    dup_trades AS (SELECT * FROM ranked_trades WHERE rn > 1),
    ranked_queue AS (
      SELECT id, user_id, opportunity_id, queued_at,
             row_number() OVER (PARTITION BY user_id ORDER BY queued_at, id) AS rn
      FROM public.auto_trade_queue
      WHERE status IN ('queued', 'processing', 'executing')
    ),
    dup_queue AS (SELECT * FROM ranked_queue WHERE rn > 1),
    relink AS (
      SELECT q.id, q.user_id, q.opportunity_id, th.status::text AS trade_status
      FROM public.auto_trade_queue q
      JOIN public.trade_history th
        ON q.user_id = th.user_id AND q.opportunity_id = th.opportunity_id
      WHERE q.status IN ('queued', 'processing', 'executing')
        AND th.status IN ('completed'::public.trade_status, 'failed'::public.trade_status, 'cancelled'::public.trade_status)
    )
    SELECT
      (SELECT count(*)::integer FROM dup_trades),
      (SELECT count(*)::integer FROM dup_queue),
      (SELECT count(*)::integer FROM relink),
      COALESCE(
        (SELECT jsonb_agg(x) FROM (
          SELECT 'trade_history' AS source, 'would_cancel' AS action, id, user_id, opportunity_id, created_at AS at, NULL::text AS trade_status FROM dup_trades
          UNION ALL
          SELECT 'auto_trade_queue', 'would_cancel', id, user_id, opportunity_id, queued_at, NULL FROM dup_queue
          UNION ALL
          SELECT 'auto_trade_queue', 'would_relink', id, user_id, opportunity_id, NULL::timestamptz, trade_status FROM relink
          LIMIT 200
        ) x),
        '[]'::jsonb
      )
    INTO v_trades, v_queue, v_relinked, v_conflicts;

    RETURN QUERY SELECT v_trades, v_queue, v_relinked, true, v_conflicts;
    RETURN;
  END IF;

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

  RETURN QUERY SELECT v_trades, v_queue, v_relinked, false, '[]'::jsonb;
END;
$function$;

DROP FUNCTION IF EXISTS public.reconcile_duplicate_trades();

REVOKE ALL ON FUNCTION public.reconcile_duplicate_trades(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_duplicate_trades(boolean) TO authenticated, service_role;
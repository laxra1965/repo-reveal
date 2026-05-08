CREATE OR REPLACE FUNCTION public.get_paper_trades_with_exchanges(p_user_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, base_symbol text, quote_symbol text, intermediate_symbol text, status trade_status, start_amount numeric, final_amount numeric, expected_profit numeric, actual_profit numeric, started_at timestamp with time zone, completed_at timestamp with time zone, completed_steps integer, total_steps integer, execution_details jsonb, opportunity_id uuid, exchanges text, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH paper AS (
    SELECT th.*
    FROM public.trade_history th
    WHERE th.user_id = p_user_id
      AND (
        (th.execution_details->>'is_paper_trade')::boolean = true
        OR th.execution_details ? 'simulated_slippage'
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(th.execution_details->'log', '[]'::jsonb)) AS l
          WHERE (l->>'isPaperTrade')::boolean = true
             OR l->>'orderId' LIKE 'PAPER_%'
        )
      )
  ),
  total AS (SELECT count(*)::bigint AS c FROM paper)
  SELECT
    p.id,
    p.base_symbol,
    p.quote_symbol,
    p.intermediate_symbol,
    p.status,
    p.start_amount,
    p.final_amount,
    p.expected_profit,
    p.actual_profit,
    p.started_at,
    p.completed_at,
    p.completed_steps,
    p.total_steps,
    p.execution_details,
    p.opportunity_id,
    COALESCE(
      NULLIF(p.execution_details->>'exchanges', ''),
      NULLIF(
        array_to_string(
          ARRAY(
            SELECT DISTINCT unnest
            FROM unnest(ARRAY[o.exchange1, o.exchange2, o.exchange3]) AS unnest
            WHERE unnest IS NOT NULL
          ),
          ' / '
        ),
        ''
      ),
      '—'
    ) AS exchanges,
    (SELECT c FROM total) AS total_count
  FROM paper p
  LEFT JOIN public.opportunities o ON o.id = p.opportunity_id
  ORDER BY p.started_at DESC
  LIMIT p_limit
  OFFSET p_offset;
$function$;
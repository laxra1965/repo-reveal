CREATE OR REPLACE FUNCTION public.get_paper_trades_with_exchanges(p_user_id uuid, p_limit int DEFAULT 50)
RETURNS TABLE (
  id uuid,
  base_symbol text,
  quote_symbol text,
  intermediate_symbol text,
  status trade_status,
  start_amount numeric,
  final_amount numeric,
  expected_profit numeric,
  actual_profit numeric,
  started_at timestamptz,
  completed_at timestamptz,
  completed_steps int,
  total_steps int,
  execution_details jsonb,
  opportunity_id uuid,
  exchanges text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    th.id,
    th.base_symbol,
    th.quote_symbol,
    th.intermediate_symbol,
    th.status,
    th.start_amount,
    th.final_amount,
    th.expected_profit,
    th.actual_profit,
    th.started_at,
    th.completed_at,
    th.completed_steps,
    th.total_steps,
    th.execution_details,
    th.opportunity_id,
    COALESCE(
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
    ) AS exchanges
  FROM public.trade_history th
  LEFT JOIN public.opportunities o ON o.id = th.opportunity_id
  WHERE th.user_id = p_user_id
    AND (
      (th.execution_details->>'is_paper_trade')::boolean = true
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(th.execution_details->'log', '[]'::jsonb)) AS l
        WHERE (l->>'isPaperTrade')::boolean = true
           OR l->>'orderId' LIKE 'PAPER_%'
      )
    )
  ORDER BY th.started_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_paper_trades_with_exchanges(uuid, int) TO authenticated;
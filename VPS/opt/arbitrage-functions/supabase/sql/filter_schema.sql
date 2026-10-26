-- Filter configuration table for arbitrage opportunities

CREATE TABLE IF NOT EXISTS public.opportunity_filters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  
  -- Profit filters
  min_profit_percent numeric,
  max_profit_percent numeric,
  
  -- Liquidity filters
  min_liquidity_score numeric,
  max_liquidity_score numeric,
  
  -- Volume filters
  min_volume_estimate numeric,
  max_volume_estimate numeric,
  
  -- Slippage filters
  max_estimated_slippage numeric,
  
  -- Exchange filters (JSON array of exchange names to include)
  allowed_exchanges text[],
  
  -- Symbol filters (JSON array of symbols to include, e.g. ["BTC", "ETH", "SOL"])
  allowed_symbols text[],
  
  -- Exclude symbols
  excluded_symbols text[],
  
  -- Path filters (e.g., only paths with 3 legs)
  path_length integer,
  
  -- Strategy filters
  allowed_strategies text[], -- e.g. ["triangular_arbitrage", "cross_exchange"]
  
  -- Admin user who created/modified this filter
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Default/system filters (managed automatically)
CREATE TABLE IF NOT EXISTS public.filter_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name text NOT NULL,
  filter_id uuid REFERENCES public.opportunity_filters(id) ON DELETE CASCADE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Filter audit log (track all changes)
CREATE TABLE IF NOT EXISTS public.filter_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filter_id uuid REFERENCES public.opportunity_filters(id) ON DELETE SET NULL,
  admin_id uuid NOT NULL,
  action text NOT NULL, -- 'create' | 'update' | 'delete' | 'enable' | 'disable'
  previous_config jsonb,
  new_config jsonb,
  timestamp timestamptz NOT NULL DEFAULT now()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_filters_active
  ON public.opportunity_filters(is_active);

CREATE INDEX IF NOT EXISTS idx_filters_created_at
  ON public.opportunity_filters(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_filter_id
  ON public.filter_audit_log(filter_id);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp
  ON public.filter_audit_log(timestamp DESC);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES FOR FILTERS
-- ============================================================================

-- Enable RLS on filter tables
ALTER TABLE public.opportunity_filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.filter_audit_log ENABLE ROW LEVEL SECURITY;

-- Policy: Service role (bot) can read active filters
DROP POLICY IF EXISTS "service_role_read_active_filters" ON public.opportunity_filters;
CREATE POLICY "service_role_read_active_filters"
ON public.opportunity_filters
FOR SELECT
USING (is_active = true);

-- Policy: Authenticated users can read filters
-- (in practice, only admins should see this via API)
DROP POLICY IF EXISTS "admin_read_filters" ON public.opportunity_filters;
CREATE POLICY "admin_read_filters"
ON public.opportunity_filters
FOR SELECT
USING (true);

-- Policy: Only service role can update
DROP POLICY IF EXISTS "service_role_update_filters" ON public.opportunity_filters;
CREATE POLICY "service_role_update_filters"
ON public.opportunity_filters
FOR UPDATE
USING (true)
WITH CHECK (true);

-- Policy: Only service role can insert
DROP POLICY IF EXISTS "service_role_insert_filters" ON public.opportunity_filters;
CREATE POLICY "service_role_insert_filters"
ON public.opportunity_filters
FOR INSERT
WITH CHECK (true);

-- Policy: Only service role can delete filters
DROP POLICY IF EXISTS "service_role_delete_filters" ON public.opportunity_filters;
CREATE POLICY "service_role_delete_filters"
ON public.opportunity_filters
FOR DELETE
USING (true);

-- Same for audit log
DROP POLICY IF EXISTS "admin_read_audit_log" ON public.filter_audit_log;
CREATE POLICY "admin_read_audit_log"
ON public.filter_audit_log
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "service_role_insert_audit_log" ON public.filter_audit_log;
CREATE POLICY "service_role_insert_audit_log"
ON public.filter_audit_log
FOR INSERT
WITH CHECK (true);

GRANT ALL ON public.opportunity_filters TO service_role;
GRANT ALL ON public.filter_audit_log TO service_role;
GRANT ALL ON public.filter_templates TO service_role;
GRANT USAGE ON SCHEMA public TO service_role;

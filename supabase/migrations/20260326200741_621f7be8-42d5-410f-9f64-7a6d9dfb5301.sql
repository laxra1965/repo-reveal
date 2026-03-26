
-- Drop the view that depends on arbitrage_opportunities
DROP VIEW IF EXISTS public.active_arbitrage_opportunities CASCADE;

-- Drop FK constraints from dependent tables
ALTER TABLE public.auto_trade_queue DROP CONSTRAINT IF EXISTS auto_trade_queue_opportunity_id_fkey;
ALTER TABLE public.ml_features DROP CONSTRAINT IF EXISTS ml_features_opportunity_id_fkey;
ALTER TABLE public.ml_predictions DROP CONSTRAINT IF EXISTS ml_predictions_opportunity_id_fkey;
ALTER TABLE public.trade_history DROP CONSTRAINT IF EXISTS trade_history_opportunity_id_fkey;

-- Drop obsolete DB functions that reference the old table
DROP FUNCTION IF EXISTS public.cleanup_expired_opportunities();
DROP FUNCTION IF EXISTS public.cleanup_expired_opportunities_full();
DROP FUNCTION IF EXISTS public.cleanup_old_opportunities();
DROP FUNCTION IF EXISTS public.cleanup_invalid_opportunities();
DROP FUNCTION IF EXISTS public.expire_stale_opportunities();
DROP FUNCTION IF EXISTS public.expire_invalid_opportunities(numeric);
DROP FUNCTION IF EXISTS public.validate_opportunity(uuid, jsonb);
DROP FUNCTION IF EXISTS public.validate_arbitrage_opportunity(uuid, jsonb);
DROP FUNCTION IF EXISTS public.validate_all_opportunities(jsonb);
DROP FUNCTION IF EXISTS public.validate_opportunities();
DROP FUNCTION IF EXISTS public.get_opportunities_needing_validation();
DROP FUNCTION IF EXISTS public.mark_opportunity_validated(uuid, boolean, numeric);
DROP FUNCTION IF EXISTS public.remove_duplicate_opportunities();
DROP FUNCTION IF EXISTS public.prevent_duplicate_opportunities() CASCADE;
DROP FUNCTION IF EXISTS public.build_path_key(text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.set_path_key() CASCADE;
DROP FUNCTION IF EXISTS public.update_opportunity_expiry() CASCADE;

-- Drop the old table
DROP TABLE IF EXISTS public.arbitrage_opportunities CASCADE;

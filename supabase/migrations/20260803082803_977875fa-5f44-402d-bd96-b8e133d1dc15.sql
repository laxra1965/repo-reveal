ALTER TABLE public.subscription_plans DROP CONSTRAINT IF EXISTS subscription_plans_duration_type_check;
ALTER TABLE public.subscription_plans ADD CONSTRAINT subscription_plans_duration_type_check
  CHECK (duration_type IN ('weekly','monthly','quarterly','semiannual','annual','lifetime'));
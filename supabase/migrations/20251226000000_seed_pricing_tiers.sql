-- Upgrade subscription plans to include 'quarterly' and seed Tier data compatible with Pricing.tsx

-- 1. Update Check Constraint to allow 'quarterly'
ALTER TABLE public.subscription_plans
DROP CONSTRAINT IF EXISTS subscription_plans_duration_type_check;

ALTER TABLE public.subscription_plans
ADD CONSTRAINT subscription_plans_duration_type_check 
CHECK (duration_type IN ('monthly', 'weekly', 'quarterly'));

-- 2. Insert Plans
-- We use a DO block to insert only if not exists to avoid duplicates if run multiple times (naive check by name)

DO $$
BEGIN
    -- Tier 1: Scanner Only
    IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE name = 'Tier 1: Scanner Only' AND duration_type = 'weekly') THEN
        INSERT INTO public.subscription_plans (name, duration_type, price, features, active) 
        VALUES ('Tier 1: Scanner Only', 'weekly', 19.00, '["Real-time opportunities", "7 days history", "Basic filters"]', true);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE name = 'Tier 1: Scanner Only' AND duration_type = 'monthly') THEN
        INSERT INTO public.subscription_plans (name, duration_type, price, features, active) 
        VALUES ('Tier 1: Scanner Only', 'monthly', 60.00, '["Real-time opportunities", "7 days history", "Basic filters"]', true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE name = 'Tier 1: Scanner Only' AND duration_type = 'quarterly') THEN
        INSERT INTO public.subscription_plans (name, duration_type, price, features, active) 
        VALUES ('Tier 1: Scanner Only', 'quarterly', 150.00, '["Real-time opportunities", "7 days history", "Basic filters"]', true);
    END IF;

    -- Tier 2: Trader Pro ($500 Max)
    IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE name = 'Tier 2: Trader Pro ($500 Max)' AND duration_type = 'weekly') THEN
        INSERT INTO public.subscription_plans (name, duration_type, price, features, active) 
        VALUES ('Tier 2: Trader Pro ($500 Max)', 'weekly', 195.00, '["Auto-trading", "$500 limit", "Basic analytics"]', true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE name = 'Tier 2: Trader Pro ($500 Max)' AND duration_type = 'monthly') THEN
        INSERT INTO public.subscription_plans (name, duration_type, price, features, active) 
        VALUES ('Tier 2: Trader Pro ($500 Max)', 'monthly', 600.00, '["Auto-trading", "$500 limit", "Basic analytics"]', true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE name = 'Tier 2: Trader Pro ($500 Max)' AND duration_type = 'quarterly') THEN
        INSERT INTO public.subscription_plans (name, duration_type, price, features, active) 
        VALUES ('Tier 2: Trader Pro ($500 Max)', 'quarterly', 1500.00, '["Auto-trading", "$500 limit", "Basic analytics"]', true);
    END IF;

    -- Tier 3: Trader Elite ($1,000 Max)
    IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE name = 'Tier 3: Trader Elite ($1,000 Max)' AND duration_type = 'weekly') THEN
        INSERT INTO public.subscription_plans (name, duration_type, price, features, active) 
        VALUES ('Tier 3: Trader Elite ($1,000 Max)', 'weekly', 395.00, '["$1000 limit", "Priority execution", "Advanced analytics"]', true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE name = 'Tier 3: Trader Elite ($1,000 Max)' AND duration_type = 'monthly') THEN
        INSERT INTO public.subscription_plans (name, duration_type, price, features, active) 
        VALUES ('Tier 3: Trader Elite ($1,000 Max)', 'monthly', 1200.00, '["$1000 limit", "Priority execution", "Advanced analytics"]', true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE name = 'Tier 3: Trader Elite ($1,000 Max)' AND duration_type = 'quarterly') THEN
        INSERT INTO public.subscription_plans (name, duration_type, price, features, active) 
        VALUES ('Tier 3: Trader Elite ($1,000 Max)', 'quarterly', 3000.00, '["$1000 limit", "Priority execution", "Advanced analytics"]', true);
    END IF;
END $$;

-- FIX Plans Data with Constraint Handling
-- Run this in Supabase SQL Editor

-- 1. Reset RLS (Safe to run always)
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view subscription plans" ON public.subscription_plans;
DROP POLICY IF EXISTS "public_read_plans" ON public.subscription_plans;
CREATE POLICY "public_read_plans" ON public.subscription_plans FOR SELECT TO public USING (true);


-- 2. DEDUPLICATION STRATEGY
-- We cannot simply delete duplicates if they are referenced by `transactions`.
-- Instead, we must:
--    a) Identifying the "Master" record (the one we keep).
--    b) Update all foreign keys (transactions, user_subscriptions) to point to the Master.
--    c) Delete the duplicates.

DO $$
DECLARE
    r RECORD;
    master_id UUID;
BEGIN
    -- Loop through all duplicate groups
    FOR r IN 
        SELECT name, duration_type, COUNT(*) 
        FROM public.subscription_plans 
        GROUP BY name, duration_type 
        HAVING COUNT(*) > 1
    LOOP
        -- Pick the oldest one as master (or newest, doesn't matter much, let's pick oldest to keep history stable)
        SELECT id INTO master_id 
        FROM public.subscription_plans 
        WHERE name = r.name AND duration_type = r.duration_type 
        ORDER BY created_at ASC 
        LIMIT 1;

        -- Update transactions to point to master
        UPDATE public.transactions 
        SET plan_id = master_id 
        WHERE plan_id IN (
            SELECT id FROM public.subscription_plans 
            WHERE name = r.name AND duration_type = r.duration_type AND id != master_id
        );

        -- Update user_subscriptions to point to master
        UPDATE public.user_subscriptions 
        SET plan_id = master_id 
        WHERE plan_id IN (
            SELECT id FROM public.subscription_plans 
            WHERE name = r.name AND duration_type = r.duration_type AND id != master_id
        );

        -- Delete the duplicates now that they are orphaned
        DELETE FROM public.subscription_plans 
        WHERE name = r.name AND duration_type = r.duration_type AND id != master_id;
        
        RAISE NOTICE 'Merged duplicates for % (%)', r.name, r.duration_type;
    END LOOP;
END $$;

-- 3. Now Safe to Add Unique Constraint
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_plans_name_duration_unique') THEN
        ALTER TABLE public.subscription_plans ADD CONSTRAINT subscription_plans_name_duration_unique UNIQUE (name, duration_type);
    END IF;
END $$;

-- 4. Upsert Plans
INSERT INTO public.subscription_plans (name, duration_type, price, features, active)
VALUES 
('Tier 1: Scanner Only', 'weekly', 19.00, '["Real-time opportunities", "7 days history", "Basic filters"]', true),
('Tier 1: Scanner Only', 'monthly', 60.00, '["Real-time opportunities", "7 days history", "Basic filters"]', true),
('Tier 1: Scanner Only', 'quarterly', 150.00, '["Real-time opportunities", "7 days history", "Basic filters"]', true),

('Tier 2: Trader Pro ($500 Max)', 'weekly', 195.00, '["Auto-trading", "$500 limit", "Basic analytics"]', true),
('Tier 2: Trader Pro ($500 Max)', 'monthly', 600.00, '["Auto-trading", "$500 limit", "Basic analytics"]', true),
('Tier 2: Trader Pro ($500 Max)', 'quarterly', 1500.00, '["Auto-trading", "$500 limit", "Basic analytics"]', true),

('Tier 3: Trader Elite ($1,000 Max)', 'weekly', 395.00, '["$1000 limit", "Priority execution", "Advanced analytics"]', true),
('Tier 3: Trader Elite ($1,000 Max)', 'monthly', 1200.00, '["$1000 limit", "Priority execution", "Advanced analytics"]', true),
('Tier 3: Trader Elite ($1,000 Max)', 'quarterly', 3000.00, '["$1000 limit", "Priority execution", "Advanced analytics"]', true)
ON CONFLICT (name, duration_type) DO UPDATE 
SET price = EXCLUDED.price, features = EXCLUDED.features, active = true;

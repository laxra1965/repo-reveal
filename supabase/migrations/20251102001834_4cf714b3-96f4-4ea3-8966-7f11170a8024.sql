-- First, drop the existing check constraint
ALTER TABLE public.subscription_plans DROP CONSTRAINT IF EXISTS subscription_plans_duration_type_check;

-- Add new check constraint that includes quarterly
ALTER TABLE public.subscription_plans 
ADD CONSTRAINT subscription_plans_duration_type_check 
CHECK (duration_type IN ('weekly', 'monthly', 'quarterly', 'annual'));

-- Now update existing annual plans to quarterly with correct pricing
UPDATE public.subscription_plans 
SET duration_type = 'quarterly', price = 150.00, active = true
WHERE name = 'Tier 1: Scanner Only' AND duration_type = 'annual';

UPDATE public.subscription_plans 
SET price = 19.00, active = true
WHERE name = 'Tier 1: Scanner Only' AND duration_type = 'weekly';

UPDATE public.subscription_plans 
SET price = 60.00, active = true
WHERE name = 'Tier 1: Scanner Only' AND duration_type = 'monthly';

UPDATE public.subscription_plans 
SET duration_type = 'quarterly', price = 1500.00, active = true
WHERE name = 'Tier 2: Trader Pro ($500 Max)' AND duration_type = 'annual';

UPDATE public.subscription_plans 
SET price = 195.00, active = true
WHERE name = 'Tier 2: Trader Pro ($500 Max)' AND duration_type = 'weekly';

UPDATE public.subscription_plans 
SET price = 600.00, active = true
WHERE name = 'Tier 2: Trader Pro ($500 Max)' AND duration_type = 'monthly';

UPDATE public.subscription_plans 
SET duration_type = 'quarterly', price = 3000.00, active = true
WHERE name = 'Tier 3: Trader Elite ($1,000 Max)' AND duration_type = 'annual';

UPDATE public.subscription_plans 
SET price = 395.00, active = true
WHERE name = 'Tier 3: Trader Elite ($1,000 Max)' AND duration_type = 'weekly';

UPDATE public.subscription_plans 
SET price = 1200.00, active = true
WHERE name = 'Tier 3: Trader Elite ($1,000 Max)' AND duration_type = 'monthly';

-- Deactivate old plans
UPDATE public.subscription_plans 
SET active = false
WHERE name IN ('Weekly Plan', 'Monthly Plan');
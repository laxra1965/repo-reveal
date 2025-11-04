-- Make user_id nullable in arbitrage_opportunities table (opportunities are now shared)
ALTER TABLE public.arbitrage_opportunities 
ALTER COLUMN user_id DROP NOT NULL;

-- Drop the old RLS policy that restricts to user's own opportunities
DROP POLICY IF EXISTS "Users can view their own opportunities" ON public.arbitrage_opportunities;

-- Create new RLS policies for shared opportunities
-- Allow everyone to read all opportunities
CREATE POLICY "Anyone can view all opportunities" 
ON public.arbitrage_opportunities 
FOR SELECT 
USING (true);

-- Only allow service role to insert/update/delete (edge functions)
CREATE POLICY "Service role can manage all opportunities" 
ON public.arbitrage_opportunities 
FOR ALL 
USING (auth.role() = 'service_role');
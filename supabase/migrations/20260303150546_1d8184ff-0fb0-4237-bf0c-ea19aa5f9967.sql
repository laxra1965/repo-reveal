-- Drop the old restrictive SELECT policy
DROP POLICY IF EXISTS "Users can view their own opportunities" ON public.arbitrage_opportunities;

-- Create new policy: authenticated users can read ALL opportunities
CREATE POLICY "Authenticated users can view all opportunities"
ON public.arbitrage_opportunities
FOR SELECT
TO authenticated
USING (true);

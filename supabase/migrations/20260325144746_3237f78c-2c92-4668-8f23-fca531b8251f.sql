ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view opportunities"
  ON public.opportunities
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage opportunities"
  ON public.opportunities
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete opportunities"
  ON public.opportunities
  FOR DELETE
  TO authenticated
  USING (true);
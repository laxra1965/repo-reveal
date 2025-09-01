-- Create policy to allow admin users to manage user subscriptions
-- Admin users can insert/update user subscriptions for any user
CREATE POLICY "Admins can manage all subscriptions" ON public.user_subscriptions
FOR ALL
USING (
  auth.email() IN ('laxracorp@gmail.com', 'admin@arbitrage.com')
)
WITH CHECK (
  auth.email() IN ('laxracorp@gmail.com', 'admin@arbitrage.com')
);

-- Create policy to allow admin users to manage all transactions  
CREATE POLICY "Admins can manage all transactions" ON public.transactions
FOR ALL
USING (
  auth.email() IN ('laxracorp@gmail.com', 'admin@arbitrage.com')
)
WITH CHECK (
  auth.email() IN ('laxracorp@gmail.com', 'admin@arbitrage.com')
);
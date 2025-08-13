-- Create default user settings for admin user if they don't exist
INSERT INTO public.user_settings (
  user_id,
  enabled_exchanges,
  trade_amount,
  min_profit_percent,
  max_profit_percent,
  filter_profitable,
  auto_trade,
  refresh_rate
) 
SELECT 
  'd2e85bfb-5ad6-40b4-a7da-dc9ce6a6dfdd'::uuid,
  ARRAY['binance'::exchange_name, 'bybit'::exchange_name, 'okx'::exchange_name],
  100.00,
  0.001,
  50.00,
  true,
  false,
  5
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_settings 
  WHERE user_id = 'd2e85bfb-5ad6-40b4-a7da-dc9ce6a6dfdd'::uuid
);

-- Create some test transactions and subscriptions for admin to manage
-- First, create a test transaction
INSERT INTO public.transactions (
  id,
  user_id,
  plan_id,
  transaction_id,
  amount,
  usdt_address,
  status,
  payment_proof,
  created_at
) VALUES (
  gen_random_uuid(),
  'c7457ade-4f2e-43ff-b14e-139007365aff'::uuid, -- existing user
  '6b1a930b-7a95-4906-ac9b-8a6a10adf7c6'::uuid, -- weekly plan
  'TEST-TXN-001',
  9.99,
  'TQMvJPEKEZE2ckMZHFobBWkKzCxtpC3W8z',
  'pending',
  'https://example.com/proof.jpg',
  now()
);

-- Create corresponding subscription that needs approval
INSERT INTO public.user_subscriptions (
  id,
  user_id,
  plan_id,
  transaction_id,
  status,
  start_date,
  end_date,
  created_at
) 
SELECT 
  gen_random_uuid(),
  t.user_id,
  t.plan_id,
  t.id,
  'pending',
  now(),
  now() + interval '7 days',
  now()
FROM public.transactions t 
WHERE t.transaction_id = 'TEST-TXN-001'
LIMIT 1;
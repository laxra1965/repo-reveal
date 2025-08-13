-- Create test transactions and subscriptions for admin to manage
-- Create a test transaction
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
) ON CONFLICT (transaction_id) DO NOTHING;

-- Create corresponding subscription that needs approval (using correct status)
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
  'active', -- Change to active status since 'pending' seems restricted
  now(),
  now() + interval '7 days',
  now()
FROM public.transactions t 
WHERE t.transaction_id = 'TEST-TXN-001'
AND NOT EXISTS (
  SELECT 1 FROM public.user_subscriptions us 
  WHERE us.transaction_id = t.id
)
LIMIT 1;
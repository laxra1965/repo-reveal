-- Update the subscription status constraint to allow more statuses for admin management
ALTER TABLE public.user_subscriptions 
DROP CONSTRAINT IF EXISTS user_subscriptions_status_check;

-- Add a more comprehensive status constraint
ALTER TABLE public.user_subscriptions 
ADD CONSTRAINT user_subscriptions_status_check 
CHECK (status = ANY (ARRAY['active'::text, 'expired'::text, 'cancelled'::text, 'pending'::text, 'suspended'::text, 'rejected'::text]));

-- Update the existing subscription to pending for admin testing
UPDATE public.user_subscriptions 
SET status = 'pending' 
WHERE EXISTS (
  SELECT 1 FROM public.transactions t 
  WHERE t.id = user_subscriptions.transaction_id 
  AND t.transaction_id = 'TEST-TXN-001'
);
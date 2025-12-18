-- Add passphrase column to exchange_credentials
ALTER TABLE public.exchange_credentials 
ADD COLUMN IF NOT EXISTS api_passphrase TEXT;

-- Update the user_settings to allow storing it in UI if needed (optional, depends on UI)
-- But for now, we need it in the credentials table.

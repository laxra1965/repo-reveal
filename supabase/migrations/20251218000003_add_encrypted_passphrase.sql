-- Migration: Add encrypted passphrase column
-- Date: 2025-12-18
-- Description: Add encrypted_api_passphrase column to exchange_credentials table

-- Add encrypted passphrase column
ALTER TABLE public.exchange_credentials 
ADD COLUMN IF NOT EXISTS encrypted_api_passphrase TEXT;

-- Add comment explaining the column
COMMENT ON COLUMN public.exchange_credentials.encrypted_api_passphrase IS 
'AES-256-GCM encrypted API passphrase (for exchanges like OKX that require it).';

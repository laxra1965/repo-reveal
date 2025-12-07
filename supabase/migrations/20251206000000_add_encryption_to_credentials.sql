-- Migration: Add encryption support to exchange_credentials
-- Date: 2025-12-06
-- Description: Add encrypted columns and encryption version tracking for API keys

-- Add new encrypted columns
ALTER TABLE public.exchange_credentials
ADD COLUMN IF NOT EXISTS encrypted_api_key TEXT,
ADD COLUMN IF NOT EXISTS encrypted_api_secret TEXT,
ADD COLUMN IF NOT EXISTS encryption_version INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS migration_status TEXT DEFAULT 'pending';

-- Create index for migration status tracking
CREATE INDEX IF NOT EXISTS idx_credentials_migration_status 
ON public.exchange_credentials(migration_status) 
WHERE migration_status != 'completed';

-- Function to check if credentials are encrypted
CREATE OR REPLACE FUNCTION public.is_credentials_encrypted(credential_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.exchange_credentials
    WHERE id = credential_id
    AND encrypted_api_key IS NOT NULL
    AND encrypted_api_secret IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comment explaining migration process
COMMENT ON COLUMN public.exchange_credentials.encrypted_api_key IS 
'AES-256-GCM encrypted API key. Use encrypt-api-keys edge function to encrypt/decrypt.';

COMMENT ON COLUMN public.exchange_credentials.encrypted_api_secret IS 
'AES-256-GCM encrypted API secret. Use encrypt-api-keys edge function to encrypt/decrypt.';

COMMENT ON COLUMN public.exchange_credentials.encryption_version IS 
'Version of encryption algorithm/key used. Allows for key rotation.';

COMMENT ON COLUMN public.exchange_credentials.migration_status IS 
'Status of encryption migration: pending, in_progress, completed, failed';

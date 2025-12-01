-- Migration: Create admin management tables
-- Date: 2025-11-29
-- Description: Add admin_users and admin_settings tables for secure admin and configuration management

-- Create admin_users table
CREATE TABLE IF NOT EXISTS public.admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id)
);

-- Create admin_settings table
CREATE TABLE IF NOT EXISTS public.admin_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(255) NOT NULL UNIQUE,
  value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_admin_users_user_id ON public.admin_users(user_id);

-- Set up RLS policies for admin_users (read-only for authenticated users, write for admins)
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_users_read" ON public.admin_users
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "admin_users_insert" ON public.admin_users
  FOR INSERT
  TO authenticated
  WITH CHECK (false); -- Only service role can insert

CREATE POLICY "admin_users_delete" ON public.admin_users
  FOR DELETE
  TO authenticated
  USING (false); -- Only service role can delete

-- Set up RLS policies for admin_settings (read for authenticated, write for admins)
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_settings_read" ON public.admin_settings
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "admin_settings_update" ON public.admin_settings
  FOR UPDATE
  TO authenticated
  USING (false); -- Only service role can update

-- Insert initial admin settings (replace with your actual USDT address)
INSERT INTO public.admin_settings (key, value) 
VALUES ('usdt_address', 'TQzjbHBa9ckat52PtVn7m2SSEM7dJXQ2uP')
ON CONFLICT (key) DO NOTHING;

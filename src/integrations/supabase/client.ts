
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { brokeredPreviewStorage } from './previewAuthStorage';

// Use Environment Variables for Security and Flexibility
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zupbliefzhnohsoguwuk.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1cGJsaWVmemhub2hzb2d1d3VrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ0MTg5MjksImV4cCI6MjA2OTk5NDkyOX0.onUAdnZILGu2vhjsEDxGqQuhvLfKTwjC3QJPNJcG0n0';

// Initialize Supabase Client
// Note: Removed custom fetch wrapper which was stripping API Key headers in some environments (Error: 'no api key found').
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: brokeredPreviewStorage(),
    persistSession: true,
    autoRefreshToken: true,
  },
});
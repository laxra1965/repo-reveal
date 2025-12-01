// Re-export the generated Supabase client for compatibility.
// Other parts of the app may import `src/supabaseClient.ts`; ensure they
// receive the same `supabase` instance exported from the generated client.
export { supabase } from "./integrations/supabase/client";

import { supabase } from '@/integrations/supabase/client';
export async function invokeFunction(name: string, options?: any) {
 const base = import.meta.env.VITE_FUNCTIONS_URL?.replace(/\/$/, '');
 if (!base) return supabase.functions.invoke(name, options);
 const { data: { session } } = await supabase.auth.getSession();
 if (!session) throw new Error('Please sign in again');
 const response = await fetch(`${base}/functions/${encodeURIComponent(name)}`, {
  method:'POST', headers:{'Content-Type':'application/json', ...options?.headers, Authorization:`Bearer ${session.access_token}`},
  body:JSON.stringify(options?.body || {}), signal:AbortSignal.timeout(30000)
 });
 const data = await response.json();
 if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
 return {data,error:null};
}

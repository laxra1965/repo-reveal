import { supabase } from '@/integrations/supabase/client';
import CryptoJS from 'crypto-js';

/**
 * Invoke a function - supports both Supabase Edge Functions and Hetzner VPS
 * If VITE_FUNCTIONS_URL is set, uses HTTP fetch to Hetzner
 * Otherwise, uses Supabase Edge Functions
 */
export async function invokeFunction(name: string, options?: any) {
  const functionsUrl = import.meta.env.VITE_FUNCTIONS_URL;
  const apiSecret = import.meta.env.VITE_API_CONTROL_SECRET || 'dev-secret-key';

  // If Hetzner URL is configured, use HTTP fetch
  if (functionsUrl) {
    try {
      const url = `${functionsUrl}/functions/${name}`;
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || options?.headers?.Authorization?.replace('Bearer ', '') || '';

      // Prepare request payload for signing
      const body = JSON.stringify(options?.body || {});
      const timestamp = Date.now().toString();
      const nonce = Math.random().toString(36).substring(2, 15);

      // Sign request (Phase 9.2)
      // Format should match RequestVerifier: timestamp + nonce + payload
      const signature = CryptoJS.HmacSHA256(`${timestamp}${nonce}${body}`, apiSecret).toString();

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'x-signature': signature,
          'x-timestamp': timestamp,
          'x-nonce': nonce,
          ...options?.headers
        },
        body
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return { data, error: null };
    } catch (e: any) {
      console.error(`Error invoking function ${name} via Hetzner:`, e);
      throw e;
    }
  }

  // Fallback to Supabase Edge Functions
  try {
    const response = await supabase.functions.invoke(name, options);
    if (response && response.error) {
      console.error(`Supabase Edge Function \`${name}\` returned non-2xx:`, response);
      const respErr: any = response.error;
      const errMessage = (respErr && (respErr.message || respErr.error || String(respErr))) || 'Edge function returned a non-2xx status code';
      const statusPart = respErr && (respErr.status || respErr.statusCode) ? ` (status: ${respErr.status || respErr.statusCode})` : '';
      throw new Error(errMessage + statusPart);
    }
    return response;
  } catch (e: any) {
    console.error(`Error invoking function ${name}:`, e);
    throw e;
  }
}

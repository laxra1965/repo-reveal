// Utility for invoking functions via HTTP (for Hetzner deployment)
// Falls back to Supabase invoke if FUNCTIONS_URL is not set

/**
 * Invoke a function via HTTP or Supabase
 * @param functionName - Name of the function to invoke
 * @param options - Request options (body, headers)
 * @param supabase - Optional Supabase client (for fallback)
 * @returns Response data
 */
export async function invokeFunction(
  functionName: string,
  options: { body?: any; headers?: Record<string, string> } = {},
  supabase?: any
): Promise<{ data?: any; error?: any }> {
  const functionsUrl = Deno.env.get('FUNCTIONS_URL');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  // If FUNCTIONS_URL is set, use HTTP fetch (Hetzner deployment)
  if (functionsUrl) {
    try {
      const url = `${functionsUrl}/functions/${functionName}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': options.headers?.Authorization || `Bearer ${supabaseServiceKey}`,
          ...options.headers
        },
        body: JSON.stringify(options.body || {})
      });

      const data = await response.json();
      
      if (!response.ok) {
        return { error: data.error || `HTTP ${response.status}` };
      }

      return { data };
    } catch (error: any) {
      console.error(`Error invoking function ${functionName} via HTTP:`, error);
      return { error: error.message || 'Function invocation failed' };
    }
  }

  // Fallback to Supabase invoke (for Supabase Edge Functions)
  if (supabase && supabase.functions) {
    try {
      const response = await supabase.functions.invoke(functionName, options);
      return response;
    } catch (error: any) {
      console.error(`Error invoking function ${functionName} via Supabase:`, error);
      return { error: error.message || 'Function invocation failed' };
    }
  }

  // Last resort: try direct HTTP to Supabase
  if (supabaseUrl && supabaseServiceKey) {
    try {
      const url = `${supabaseUrl}/functions/v1/${functionName}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
          ...options.headers
        },
        body: JSON.stringify(options.body || {})
      });

      const data = await response.json();
      
      if (!response.ok) {
        return { error: data.error || `HTTP ${response.status}` };
      }

      return { data };
    } catch (error: any) {
      console.error(`Error invoking function ${functionName} via Supabase HTTP:`, error);
      return { error: error.message || 'Function invocation failed' };
    }
  }

  return { error: 'No function invocation method available' };
}


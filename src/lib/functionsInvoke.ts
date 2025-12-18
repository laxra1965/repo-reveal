import { supabase } from '@/integrations/supabase/client';

export async function invokeFunction(name: string, options?: any) {
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

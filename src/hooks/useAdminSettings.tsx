import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export const useAdminSettings = () => {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        // Use SECURITY DEFINER RPC that returns only whitelisted public keys
        // (admin_settings table is now restricted to admin users only).
        const { data, error } = await (supabase.rpc as any)('get_public_admin_settings');
        if (error) throw error;

        const settingsMap: Record<string, string> = {};
        (data as Array<{ key: string; value: string }> | null)?.forEach(({ key, value }) => {
          settingsMap[key] = value;
        });

        setSettings(settingsMap);
      } catch (error) {
        console.error('Error fetching admin settings:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  return {
    settings,
    loading,
    getSetting: (key: string, defaultValue?: string) => settings[key] || defaultValue,
  };
};

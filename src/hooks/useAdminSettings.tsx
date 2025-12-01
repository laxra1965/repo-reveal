import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export const useAdminSettings = () => {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data, error } = await supabase
          .from('admin_settings')
          .select('key, value') as { data: Array<{ key: string; value: string }> | null; error: any };

        if (error) throw error;

        const settingsMap: Record<string, string> = {};
        data?.forEach(({ key, value }) => {
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

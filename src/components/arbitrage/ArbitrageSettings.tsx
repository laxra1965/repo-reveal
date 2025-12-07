import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Key, Shield } from 'lucide-react';

interface ArbitrageSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

type ExchangeName = Database['public']['Enums']['exchange_name'];

const AVAILABLE_EXCHANGES: ExchangeName[] = [
  'binance', 'bybit', 'okx', 'kucoin', 'gate', 'mexc'
];

export const ArbitrageSettings = ({ isOpen, onClose }: ArbitrageSettingsProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState({
    refresh_rate: 5,
    trade_amount: 10,
    min_profit_percent: 0.05,
    max_profit_percent: 50,
    filter_profitable: true,
    auto_trade: false,
    enabled_exchanges: ['binance', 'bybit', 'okx'] as ExchangeName[],
    arbitrage_types: ['triangular', 'cross_exchange'] as string[],
    custom_pairs: '' as string,
    // API Keys storage
    apiKeys: {} as Record<string, { key: string; secret: string; passphrase?: string; testMode: boolean; isExisting?: boolean }>
  });
  const [loading, setLoading] = useState(false);

  // Helper functions for API key management
  const getApiKeyStatus = (exchange: string): boolean => {
    const keys = settings.apiKeys[exchange];
    return !!(keys?.key && keys?.secret);
  };

  const getApiKeyValue = (exchange: string, field: 'key' | 'secret' | 'passphrase'): string => {
    return settings.apiKeys[exchange]?.[field] || '';
  };

  const getTestModeStatus = (exchange: string): boolean => {
    return settings.apiKeys[exchange]?.testMode || true;
  };

  const handleApiKeyChange = (exchange: string, field: 'key' | 'secret' | 'passphrase', value: string) => {
    setSettings(prev => ({
      ...prev,
      apiKeys: {
        ...prev.apiKeys,
        [exchange]: {
          ...prev.apiKeys[exchange],
          [field]: value,
          isExisting: false // Mark as modified
        }
      }
    }));
  };

  const handleTestModeChange = (exchange: string, testMode: boolean) => {
    setSettings(prev => ({
      ...prev,
      apiKeys: {
        ...prev.apiKeys,
        [exchange]: {
          ...prev.apiKeys[exchange],
          testMode
        }
      }
    }));
  };

  useEffect(() => {
    if (user && isOpen) {
      loadSettings();
    }
  }, [user, isOpen]);

  const loadSettings = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setSettings(prev => ({
          ...prev,
          refresh_rate: data.refresh_rate,
          trade_amount: parseFloat(data.trade_amount.toString()),
          min_profit_percent: parseFloat(data.min_profit_percent.toString()) * 100,
          max_profit_percent: parseFloat(data.max_profit_percent.toString()),
          filter_profitable: data.filter_profitable,
          auto_trade: data.auto_trade,
          enabled_exchanges: data.enabled_exchanges || (['binance', 'bybit', 'okx'] as ExchangeName[]),
          arbitrage_types: data.arbitrage_types || ['triangular', 'cross_exchange'],
          custom_pairs: (data.custom_pairs || []).join(', ')
        }));
      }

      // Load existing API credentials
      const { data: credentials, error: credError } = await supabase
        .from('exchange_credentials')
        .select('exchange, api_key, api_secret, test_mode, is_connected')
        .eq('user_id', user.id);

      if (credError) {
        console.error('Error loading credentials:', credError);
      } else if (credentials) {
        const apiKeys: Record<string, { key: string; secret: string; passphrase?: string; testMode: boolean; isExisting?: boolean }> = {};
        credentials.forEach((cred) => {
          // Only show credentials that have keys
          if (cred.api_key && cred.api_secret && cred.is_connected) {
            apiKeys[cred.exchange] = {
              key: '', // Don't show existing keys for security
              secret: '',
              testMode: cred.test_mode || false,
              isExisting: true // Mark as existing so we know not to update if empty
            };
          }
        });
        setSettings(prev => ({ ...prev, apiKeys }));
      }
    } catch (error: any) {
      console.error('Error loading settings:', error);
    }
  };

  const saveSettings = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const settingsData = {
        user_id: user.id,
        refresh_rate: settings.refresh_rate,
        trade_amount: settings.trade_amount,
        min_profit_percent: settings.min_profit_percent / 100,
        max_profit_percent: settings.max_profit_percent,
        filter_profitable: settings.filter_profitable,
        auto_trade: settings.auto_trade,
        enabled_exchanges: settings.enabled_exchanges,
        arbitrage_types: settings.arbitrage_types,
        custom_pairs: settings.custom_pairs
          .split(',')
          .map(p => p.trim())
          .filter(p => p.length > 0)
      };

      await supabase
        .from('user_settings')
        .upsert(settingsData, { onConflict: 'user_id' });

      // Save API keys to exchange_credentials table
      for (const exchange of settings.enabled_exchanges) {
        const apiKey = settings.apiKeys[exchange];

        // Skip if no keys entered OR if existing credential with no changes
        if (!apiKey || (apiKey.isExisting && !apiKey.key && !apiKey.secret)) {
          console.log(`Skipping ${exchange} - no changes`);
          continue;
        }

        // Only save if user actually entered new credentials
        if (apiKey.key && apiKey.secret) {
          console.log(`Saving credentials for ${exchange}...`);

          const credentialData = {
            user_id: user.id,
            exchange: exchange as any,
            api_key: apiKey.key,
            api_secret: apiKey.secret,
            test_mode: apiKey.testMode !== undefined ? apiKey.testMode : false,
            is_connected: true
          };

          // First try to find existing credential
          const { data: existing } = await supabase
            .from('exchange_credentials')
            .select('id')
            .eq('user_id', user.id)
            .eq('exchange', exchange)
            .single();

          let credError;
          if (existing) {
            // Update existing
            const { error } = await supabase
              .from('exchange_credentials')
              .update(credentialData)
              .eq('id', existing.id);
            credError = error;
          } else {
            // Insert new
            const { error } = await supabase
              .from('exchange_credentials')
              .insert(credentialData);
            credError = error;
          }

          if (credError) {
            console.error(`Error saving ${exchange} credentials:`, credError);
            toast({
              title: "Error",
              description: `Failed to save ${exchange} credentials: ${credError.message}`,
              variant: "destructive",
            });
          } else {
            console.log(`Successfully saved ${exchange} credentials`);
          }
        }
      }

      toast({
        title: "Settings Saved",
        description: "Scanner settings and API keys updated successfully",
      });

      onClose();
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to save settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Scanner Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* General Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">General Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Refresh Rate (sec)</Label>
                  <Input
                    type="number"
                    min="2"
                    max="60"
                    value={settings.refresh_rate}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      refresh_rate: parseInt(e.target.value) || 5
                    }))}
                  />
                </div>
                <div>
                  <Label>Trade Amount (USDT)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={settings.trade_amount}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      trade_amount: parseFloat(e.target.value) || 10
                    }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Min Profit (%)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={settings.min_profit_percent}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      min_profit_percent: parseFloat(e.target.value) || 0.05
                    }))}
                  />
                </div>
                <div>
                  <Label>Max Profit (%)</Label>
                  <Input
                    type="number"
                    min="0.1"
                    value={settings.max_profit_percent}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      max_profit_percent: parseFloat(e.target.value) || 50
                    }))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    checked={settings.filter_profitable}
                    onCheckedChange={(checked) => setSettings(prev => ({
                      ...prev,
                      filter_profitable: checked as boolean
                    }))}
                  />
                  <Label>Show only profitable</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    checked={settings.auto_trade}
                    onCheckedChange={(checked) => setSettings(prev => ({
                      ...prev,
                      auto_trade: checked as boolean
                    }))}
                  />
                  <Label>Auto-trade (requires API keys)</Label>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={saveSettings} disabled={loading}>
            {loading ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
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
import { Badge } from '@/components/ui/badge';
import { MultiSelect } from '@/components/ui/multi-select';
import { useToast } from '@/hooks/use-toast';

interface ArbitrageSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

type ExchangeName = Database['public']['Enums']['exchange_name'];

const EXCHANGE_OPTIONS = [
  { value: 'binance', label: 'Binance' },
  { value: 'bybit', label: 'Bybit' },
  { value: 'okx', label: 'OKX' },
  { value: 'kucoin', label: 'KuCoin' },
  { value: 'gate', label: 'Gate.io' },
  { value: 'mexc', label: 'MEXC' },
];

const ARB_TYPE_OPTIONS = [
  { value: 'triangular', label: 'Triangular', description: '3-step trades on same exchange' },
  { value: 'cross_exchange', label: 'Cross Exchange', description: 'Buy on one, sell on another' },
  { value: 'short', label: 'Short Signals', description: 'Short-selling opportunities' },
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
    enabled_exchanges: ['binance', 'bybit', 'okx'] as string[],
    arbitrage_types: ['triangular', 'cross_exchange'] as string[],
    custom_pairs: '' as string,
    enable_ml_filtering: false,
    apiKeys: {} as Record<string, { key: string; secret: string; passphrase?: string; testMode: boolean; isExisting?: boolean }>
  });
  const [loading, setLoading] = useState(false);

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
          enabled_exchanges: (data.enabled_exchanges || ['binance', 'bybit', 'okx']) as string[],
          arbitrage_types: data.arbitrage_types || ['triangular', 'cross_exchange'],
          custom_pairs: (data.custom_pairs || []).join(', '),
          enable_ml_filtering: data.enable_ml_filtering || false,
        }));
      }

      const { data: credentials, error: credError } = await supabase
        .from('exchange_credentials')
        .select('exchange, api_key, api_secret, test_mode, is_connected')
        .eq('user_id', user.id);

      if (credError) {
        console.error('Error loading credentials:', credError);
      } else if (credentials) {
        const apiKeys: Record<string, { key: string; secret: string; passphrase?: string; testMode: boolean; isExisting?: boolean }> = {};
        credentials.forEach((cred) => {
          if (cred.api_key && cred.api_secret && cred.is_connected) {
            apiKeys[cred.exchange] = {
              key: '',
              secret: '',
              testMode: cred.test_mode || false,
              isExisting: true
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
          .filter(p => p.length > 0),
        enable_ml_filtering: settings.enable_ml_filtering
      };

      await supabase
        .from('user_settings')
        .upsert(settingsData, { onConflict: 'user_id' });

      for (const exchange of settings.enabled_exchanges) {
        const apiKey = settings.apiKeys[exchange];
        if (!apiKey || (apiKey.isExisting && !apiKey.key && !apiKey.secret)) continue;

        if (apiKey.key && apiKey.secret) {
          const credentialData = {
            user_id: user.id,
            exchange: exchange as any,
            api_key: apiKey.key,
            api_secret: apiKey.secret,
            api_passphrase: apiKey.passphrase,
            test_mode: apiKey.testMode !== undefined ? apiKey.testMode : false,
            is_connected: true
          };

          const { data: existing } = await supabase
            .from('exchange_credentials')
            .select('id')
            .eq('user_id', user.id)
            .eq('exchange', exchange)
            .single();

          if (existing) {
            await supabase.from('exchange_credentials').update(credentialData).eq('id', existing.id);
          } else {
            await supabase.from('exchange_credentials').insert(credentialData);
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
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Enabled Exchanges</CardTitle>
            </CardHeader>
            <CardContent>
              <MultiSelect
                options={EXCHANGE_OPTIONS}
                selected={settings.enabled_exchanges}
                onChange={(val) => setSettings(prev => ({ ...prev, enabled_exchanges: val }))}
                placeholder="Select exchanges..."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">General Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm">Refresh Rate (sec)</Label>
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
                  <Label className="text-sm">Trade Amount (USDT)</Label>
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
                  <Label className="text-sm">Min Profit (%)</Label>
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
                  <Label className="text-sm">Max Profit (%)</Label>
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

              <div className="space-y-2 pt-2">
                <Label className="text-sm font-medium">Arbitrage Types</Label>
                <MultiSelect
                  options={ARB_TYPE_OPTIONS}
                  selected={settings.arbitrage_types}
                  onChange={(val) => setSettings(prev => ({ ...prev, arbitrage_types: val }))}
                  placeholder="Select arbitrage types..."
                />
              </div>

              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="custom-pairs" className="text-sm font-medium">Custom Pairs (Direct Search)</Label>
                  <Badge variant="secondary" className="text-[10px] h-5 opacity-70">Optional</Badge>
                </div>
                <Input
                  id="custom-pairs"
                  placeholder="e.g. BTC, ETH, PEPE, SOL"
                  value={settings.custom_pairs}
                  onChange={(e) => setSettings(prev => ({
                    ...prev,
                    custom_pairs: e.target.value
                  }))}
                  className="h-9"
                />
                <p className="text-[10px] text-muted-foreground italic">
                  Focus scan on specific assets (comma separated). Ideal for exotic triangles.
                </p>
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <Checkbox
                  id="show-only-profitable"
                  checked={settings.filter_profitable}
                  onCheckedChange={(checked) => setSettings(prev => ({
                    ...prev,
                    filter_profitable: checked as boolean
                  }))}
                />
                <Label htmlFor="show-only-profitable" className="text-sm">Show only profitable</Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="auto-trade-enable"
                  checked={settings.auto_trade}
                  onCheckedChange={(checked) => setSettings(prev => ({
                    ...prev,
                    auto_trade: checked as boolean
                  }))}
                />
                <Label htmlFor="auto-trade-enable" className="text-sm">Auto-trade (requires API keys)</Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="ml-enable"
                  checked={settings.enable_ml_filtering}
                  onCheckedChange={(checked) => setSettings(prev => ({
                    ...prev,
                    enable_ml_filtering: checked as boolean
                  }))}
                />
                <Label htmlFor="ml-enable" className="flex items-center gap-2 text-sm">
                  <span className="bg-gradient-to-r from-purple-400 to-pink-600 bg-clip-text text-transparent font-bold">
                    AI Enhanced Filtering
                  </span>
                  <Badge variant="outline" className="text-[10px] h-5 px-1 border-purple-500/50 text-purple-500">BETA</Badge>
                </Label>
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

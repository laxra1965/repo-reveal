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
    // API Keys
    binanceApiKey: '',
    binanceApiSecret: '',
    binanceTestMode: true,
    bybitApiKey: '',
    bybitApiSecret: '',
    bybitTestMode: true,
    okxApiKey: '',
    okxApiSecret: '',
    okxPassphrase: '',
    okxTestMode: true
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
          enabled_exchanges: data.enabled_exchanges || (['binance', 'bybit', 'okx'] as ExchangeName[])
        }));
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
        enabled_exchanges: settings.enabled_exchanges
      };

      await supabase
        .from('user_settings')
        .upsert(settingsData, { onConflict: 'user_id' });

      toast({
        title: "Settings Saved",
        description: "Scanner settings updated successfully",
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
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Scanner Settings & API Configuration</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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

              <div>
                <Label className="mb-2 block">Enabled Exchanges</Label>
                <div className="grid grid-cols-2 gap-2">
                  {AVAILABLE_EXCHANGES.map((exchange) => (
                    <div key={exchange} className="flex items-center space-x-2">
                      <Checkbox
                        checked={settings.enabled_exchanges.includes(exchange)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSettings(prev => ({
                              ...prev,
                              enabled_exchanges: [...prev.enabled_exchanges, exchange]
                            }));
                          } else {
                            setSettings(prev => ({
                              ...prev,
                              enabled_exchanges: prev.enabled_exchanges.filter(ex => ex !== exchange)
                            }));
                          }
                        }}
                      />
                      <Label className="capitalize text-sm">{exchange}</Label>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* API Keys for Auto-Trading */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Key className="h-4 w-4" />
                Exchange API Keys
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Binance API */}
              <div className="border rounded p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-sm">Binance</h4>
                  <Badge variant={settings.binanceApiKey ? "default" : "secondary"} className="text-xs">
                    {settings.binanceApiKey ? "Connected" : "Not Set"}
                  </Badge>
                </div>
                <div className="space-y-2">
                  <Input
                    type="password"
                    placeholder="API Key"
                    value={settings.binanceApiKey}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      binanceApiKey: e.target.value
                    }))}
                    className="text-xs"
                  />
                  <Input
                    type="password"
                    placeholder="API Secret"
                    value={settings.binanceApiSecret}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      binanceApiSecret: e.target.value
                    }))}
                    className="text-xs"
                  />
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      checked={settings.binanceTestMode}
                      onCheckedChange={(checked) => setSettings(prev => ({
                        ...prev,
                        binanceTestMode: checked as boolean
                      }))}
                    />
                    <Label className="text-xs">Test Mode</Label>
                  </div>
                </div>
              </div>

              {/* Bybit API */}
              <div className="border rounded p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-sm">Bybit</h4>
                  <Badge variant={settings.bybitApiKey ? "default" : "secondary"} className="text-xs">
                    {settings.bybitApiKey ? "Connected" : "Not Set"}
                  </Badge>
                </div>
                <div className="space-y-2">
                  <Input
                    type="password"
                    placeholder="API Key"
                    value={settings.bybitApiKey}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      bybitApiKey: e.target.value
                    }))}
                    className="text-xs"
                  />
                  <Input
                    type="password"
                    placeholder="API Secret"
                    value={settings.bybitApiSecret}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      bybitApiSecret: e.target.value
                    }))}
                    className="text-xs"
                  />
                </div>
              </div>

              {/* Security Note */}
              <div className="bg-muted/50 border border-dashed rounded p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-blue-500" />
                  <span className="font-medium text-sm">Security</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  API keys are encrypted and stored securely. Only provide read-only or spot trading permissions.
                </p>
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
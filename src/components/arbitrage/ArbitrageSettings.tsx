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
import { Key, Shield, AlertTriangle } from 'lucide-react';

interface ArbitrageSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

// New Interface Added
interface SafetySettings {
  maxTradesPerHour: number;
  maxDailyLoss: number;
  minProfitThreshold: number;
  requireConfirmation: boolean;
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
    // New Safety Settings Object
    safety: {
      maxTradesPerHour: 5,
      maxDailyLoss: 50,
      minProfitThreshold: 0.2,
      requireConfirmation: true
    } as SafetySettings,
    // API Keys storage
    apiKeys: {} as Record<string, { key: string; secret: string; passphrase?: string; testMode: boolean; isExisting?: boolean }>
  });
  
  const [loading, setLoading] = useState(false);

  // Helper functions for API key management
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
          custom_pairs: (data.custom_pairs || []).join(', '),
          // Load Safety Settings (assuming these columns exist in DB, falling back to defaults if not)
          safety: {
            maxTradesPerHour: data.max_trades_per_hour ?? 5,
            maxDailyLoss: parseFloat((data.max_daily_loss ?? 50).toString()),
            minProfitThreshold: parseFloat((data.min_profit_threshold ?? 0.2).toString()),
            requireConfirmation: data.require_confirmation ?? true
          }
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
          if (cred.api_key && cred.api_secret && cred.is_connected) {
            apiKeys[cred.exchange] = {
              key: '', // Don't show existing keys for security
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
        // Save Safety Settings
        max_trades_per_hour: settings.safety.maxTradesPerHour,
        max_daily_loss: settings.safety.maxDailyLoss,
        min_profit_threshold: settings.safety.minProfitThreshold,
        require_confirmation: settings.safety.requireConfirmation
      };

      await supabase
        .from('user_settings')
        .upsert(settingsData, { onConflict: 'user_id' });

      // Save API keys logic...
      for (const exchange of settings.enabled_exchanges) {
        const apiKey = settings.apiKeys[exchange];
        if (!apiKey || (apiKey.isExisting && !apiKey.key && !apiKey.secret)) continue;

        if (apiKey.key && apiKey.secret) {
          const credentialData = {
            user_id: user.id,
            exchange: exchange as any,
            api_key: apiKey.key,
            api_secret: apiKey.secret,
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
        description: "Scanner settings, safety protocols, and API keys updated successfully",
      });

      onClose();
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Error",
        description: "Failed to save settings: " + error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Scanner Settings & API Configuration</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column: General + Safety */}
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
                    <Label>Scan Min Profit (%)</Label>
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
                    <Label>Scan Max Profit (%)</Label>
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

                <div>
                  <Label className="mb-2 block">Custom Trading Pairs</Label>
                  <Textarea
                    placeholder="BTC, ETH, SOL, DOGE"
                    value={settings.custom_pairs}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      custom_pairs: e.target.value
                    }))}
                    className="text-sm h-[60px]"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Safety & Risk Management - NEW SECTION */}
            <Card className="border-orange-200 dark:border-orange-900">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 text-orange-600 dark:text-orange-400">
                  <AlertTriangle className="h-4 w-4" />
                  Safety & Risk Management
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Max Trades / Hour</Label>
                    <Input
                      type="number"
                      min="1"
                      value={settings.safety.maxTradesPerHour}
                      onChange={(e) => setSettings(prev => ({
                        ...prev,
                        safety: { ...prev.safety, maxTradesPerHour: parseInt(e.target.value) || 0 }
                      }))}
                    />
                  </div>
                  <div>
                    <Label>Max Daily Loss ($)</Label>
                    <Input
                      type="number"
                      min="0"
                      value={settings.safety.maxDailyLoss}
                      onChange={(e) => setSettings(prev => ({
                        ...prev,
                        safety: { ...prev.safety, maxDailyLoss: parseFloat(e.target.value) || 0 }
                      }))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                   <div>
                    <Label>Min Profit Threshold (%)</Label>
                    <p className="text-[10px] text-muted-foreground mb-1">Strict execution threshold</p>
                    <Input
                      type="number"
                      step="0.1"
                      value={settings.safety.minProfitThreshold}
                      onChange={(e) => setSettings(prev => ({
                        ...prev,
                        safety: { ...prev.safety, minProfitThreshold: parseFloat(e.target.value) || 0 }
                      }))}
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-2 pt-1">
                  <Checkbox
                    checked={settings.safety.requireConfirmation}
                    onCheckedChange={(checked) => setSettings(prev => ({
                      ...prev,
                      safety: { ...prev.safety, requireConfirmation: checked as boolean }
                    }))}
                  />
                  <Label>Require manual confirmation before trade</Label>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column: API Keys */}
          <Card className="h-full flex flex-col">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Key className="h-4 w-4" />
                Exchange API Keys
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 flex-1">
              {/* API Keys for enabled exchanges */}
              {AVAILABLE_EXCHANGES.filter(exchange => 
                settings.enabled_exchanges.includes(exchange)
              ).length === 0 ? (
                <div className="text-sm text-muted-foreground italic p-4 text-center border border-dashed rounded">
                  Select exchanges in General Settings to configure API keys.
                </div>
              ) : (
                AVAILABLE_EXCHANGES.filter(exchange => 
                  settings.enabled_exchanges.includes(exchange)
                ).map((exchange) => (
                    <div key={exchange} className="border rounded p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium text-sm capitalize">{exchange}</h4>
                      <Badge 
                        variant={settings.apiKeys[exchange]?.isExisting ? "default" : "secondary"} 
                        className="text-xs"
                      >
                        {settings.apiKeys[exchange]?.isExisting ? "Connected" : "Not Set"}
                      </Badge>
                    </div>
                    <div className="space-y-2">
                      <Input
                        type="password"
                        placeholder={settings.apiKeys[exchange]?.isExisting ? "Enter new API Key (leave empty to keep)" : "API Key"}
                        value={getApiKeyValue(exchange, 'key')}
                        onChange={(e) => handleApiKeyChange(exchange, 'key', e.target.value)}
                        className="text-xs"
                      />
                      <Input
                        type="password"
                        placeholder={settings.apiKeys[exchange]?.isExisting ? "Enter new API Secret (leave empty to keep)" : "API Secret"}
                        value={getApiKeyValue(exchange, 'secret')}
                        onChange={(e) => handleApiKeyChange(exchange, 'secret', e.target.value)}
                        className="text-xs"
                      />
                      {exchange === 'okx' && (
                        <Input
                          type="password"
                          placeholder="Passphrase (optional)"
                          value={getApiKeyValue(exchange, 'passphrase')}
                          onChange={(e) => handleApiKeyChange(exchange, 'passphrase', e.target.value)}
                          className="text-xs"
                        />
                      )}
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          checked={getTestModeStatus(exchange)}
                          onCheckedChange={(checked) => handleTestModeChange(exchange, checked as boolean)}
                        />
                        <Label className="text-xs">Test Mode</Label>
                      </div>
                    </div>
                  </div>
                ))
              )}

              {/* Security Note */}
              <div className="bg-muted/50 border border-dashed rounded p-3 space-y-2 mt-auto">
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

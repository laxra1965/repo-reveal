import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

interface ArbitrageSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Settings {
  refresh_rate: number;
  trade_amount: number;
  min_profit_percent: number;
  max_profit_percent: number;
  filter_profitable: boolean;
  auto_trade: boolean;
  enabled_exchanges: string[];
}

const AVAILABLE_EXCHANGES = [
  'binance', 'bybit', 'okx', 'bitget', 'mexc', 'gate', 'htx', 'kucoin'
];

export const ArbitrageSettings = ({ isOpen, onClose }: ArbitrageSettingsProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings>({
    refresh_rate: 5,
    trade_amount: 10,
    min_profit_percent: 0.05,
    max_profit_percent: 50,
    filter_profitable: true,
    auto_trade: false,
    enabled_exchanges: ['binance', 'bybit', 'okx']
  });
  const [loading, setLoading] = useState(false);

  // Load settings on mount
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
        .single();

      if (error && error.code !== 'PGRST116') { // Not found error
        throw error;
      }

      if (data) {
        setSettings({
          refresh_rate: data.refresh_rate,
          trade_amount: parseFloat(data.trade_amount.toString()),
          min_profit_percent: parseFloat(data.min_profit_percent.toString()) * 100, // Convert to percentage
          max_profit_percent: parseFloat(data.max_profit_percent.toString()),
          filter_profitable: data.filter_profitable,
          auto_trade: data.auto_trade,
          enabled_exchanges: data.enabled_exchanges || ['binance', 'bybit', 'okx']
        });
      }
    } catch (error: any) {
      console.error('Error loading settings:', error);
      toast({
        title: "Error",
        description: "Failed to load settings",
        variant: "destructive",
      });
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
        min_profit_percent: settings.min_profit_percent / 100, // Convert to decimal
        max_profit_percent: settings.max_profit_percent,
        filter_profitable: settings.filter_profitable,
        auto_trade: settings.auto_trade,
        enabled_exchanges: settings.enabled_exchanges as ("binance" | "bybit" | "okx" | "bitget" | "mexc" | "gate" | "htx" | "kucoin" | "bitfinex" | "bingx" | "coinbase" | "upbit" | "cryptocom" | "kraken")[]
      };

      const { error } = await supabase
        .from('user_settings')
        .upsert(settingsData, { onConflict: 'user_id' });

      if (error) throw error;

      toast({
        title: "Settings Saved",
        description: "Your scanner settings have been updated",
      });

      onClose();
    } catch (error: any) {
      console.error('Error saving settings:', error);
      toast({
        title: "Error",
        description: "Failed to save settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleExchangeToggle = (exchange: string, checked: boolean) => {
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
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Arbitrage Scanner Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* General Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">General Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="refresh_rate">Refresh Rate (seconds)</Label>
                  <Input
                    id="refresh_rate"
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
                  <Label htmlFor="trade_amount">Trade Amount (USDT)</Label>
                  <Input
                    id="trade_amount"
                    type="number"
                    min="1"
                    step="0.01"
                    value={settings.trade_amount}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      trade_amount: parseFloat(e.target.value) || 10
                    }))}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Profit Filters */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Profit Filters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="min_profit">Min Profit (%)</Label>
                  <Input
                    id="min_profit"
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
                  <Label htmlFor="max_profit">Max Profit (%)</Label>
                  <Input
                    id="max_profit"
                    type="number"
                    min="0.1"
                    step="0.1"
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
                    id="filter_profitable"
                    checked={settings.filter_profitable}
                    onCheckedChange={(checked) => setSettings(prev => ({
                      ...prev,
                      filter_profitable: checked as boolean
                    }))}
                  />
                  <Label htmlFor="filter_profitable">Show only profitable opportunities</Label>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="auto_trade"
                    checked={settings.auto_trade}
                    onCheckedChange={(checked) => setSettings(prev => ({
                      ...prev,
                      auto_trade: checked as boolean
                    }))}
                  />
                  <Label htmlFor="auto_trade">Auto-trade (requires API credentials)</Label>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Enabled Exchanges */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Enabled Exchanges</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {AVAILABLE_EXCHANGES.map((exchange) => (
                  <div key={exchange} className="flex items-center space-x-2">
                    <Checkbox
                      id={exchange}
                      checked={settings.enabled_exchanges.includes(exchange)}
                      onCheckedChange={(checked) => handleExchangeToggle(exchange, checked as boolean)}
                    />
                    <Label htmlFor={exchange} className="capitalize">
                      {exchange}
                    </Label>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={saveSettings} disabled={loading}>
              {loading ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
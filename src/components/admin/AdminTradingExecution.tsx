import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Play,
  Settings as SettingsIcon,
  History,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { AdminApiKeyManager } from './AdminApiKeyManager';

interface UserSettings {
  auto_trade: boolean;
  trade_amount: number;
  max_position_size: number;
  min_profit_percent: number;
}

interface TradeHistoryRow {
  id: string;
  created_at: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  actual_profit: number | null;
  base_symbol: string;
  intermediate_symbol: string;
  quote_symbol: string;
}

export const AdminTradingExecution = () => {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [trades, setTrades] = useState<TradeHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSettings = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('user_settings')
      .select('auto_trade, trade_amount, max_position_size, min_profit_percent')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!error && data) {
      setSettings(data as UserSettings);
    }
  }, []);

  const fetchTrades = useCallback(async () => {
    setRefreshing(true);
    const { data, error } = await supabase
      .from('trade_history')
      .select('id, created_at, status, actual_profit, base_symbol, intermediate_symbol, quote_symbol')
      .order('created_at', { ascending: false })
      .limit(20);

    if (!error && data) {
      setTrades(data as unknown as TradeHistoryRow[]);
    }
    setRefreshing(false);
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchSettings(), fetchTrades()]);
      setLoading(false);
    };
    init();

    const channel = supabase
      .channel('admin_trade_updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trade_history' },
        () => {
          fetchTrades();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchSettings, fetchTrades]);

  const handleUpdateSettings = async (updates: Partial<UserSettings>) => {
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    const { error } = await supabase
      .from('user_settings')
      .update(updates)
      .eq('user_id', user.id);

    if (!error) {
      setSettings((prev) => (prev ? { ...prev, ...updates } : null));
      toast.success('Settings updated');
    } else {
      toast.error('Failed to update settings');
    }
    setSaving(false);
  };

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Loading execution data...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-primary" />
            Trading Execution
          </h2>
          <p className="text-xs text-muted-foreground">
            Manage automated trading and monitor execution status.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchTrades} disabled={refreshing}>
          <RefreshCw className={cn('w-3.5 h-3.5 mr-2', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Bot Controls */}
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Play className="w-4 h-4 text-green-500" />
              Bot Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border">
              <div>
                <Label className="text-sm font-bold">Auto Trading</Label>
                <p className="text-xs text-muted-foreground">Enable automated execution</p>
              </div>
              <Switch
                checked={settings?.auto_trade || false}
                onCheckedChange={(checked) => handleUpdateSettings({ auto_trade: checked })}
                disabled={saving}
              />
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase text-muted-foreground">Trade Amount (USDT)</Label>
                <Input
                  type="number"
                  value={settings?.trade_amount ?? 0}
                  onChange={(e) =>
                    handleUpdateSettings({ trade_amount: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase text-muted-foreground">Min Profit %</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={settings?.min_profit_percent ?? 0}
                  onChange={(e) =>
                    handleUpdateSettings({
                      min_profit_percent: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
            </div>

            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <div className="flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Paper trading is forced globally for safety. Real-money execution requires admin approval.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Execution Monitor */}
        <Card className="md:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <History className="w-4 h-4 text-primary" />
                Execution History
              </CardTitle>
              <CardDescription className="text-xs">Recent trading activity (live).</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/30">
                  <tr>
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Path</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {trades.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground italic">
                        No recent trades found.
                      </td>
                    </tr>
                  ) : (
                    trades.map((trade) => (
                      <tr key={trade.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {new Date(trade.created_at).toLocaleTimeString()}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs bg-muted px-2 py-1 rounded border">
                            {trade.base_symbol}→{trade.intermediate_symbol}→{trade.quote_symbol}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {trade.status === 'completed' && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                            )}
                            {trade.status === 'failed' && (
                              <XCircle className="w-3.5 h-3.5 text-destructive" />
                            )}
                            {trade.status === 'executing' && (
                              <RefreshCw className="w-3.5 h-3.5 text-primary animate-spin" />
                            )}
                            {trade.status === 'pending' && (
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                            )}
                            <span
                              className={cn(
                                'text-xs font-medium',
                                trade.status === 'completed' && 'text-green-500',
                                trade.status === 'failed' && 'text-destructive',
                                trade.status === 'executing' && 'text-primary',
                                trade.status === 'pending' && 'text-amber-500',
                              )}
                            >
                              {trade.status.toUpperCase()}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {trade.actual_profit !== null ? (
                            <span
                              className={cn(
                                'text-xs font-bold',
                                trade.actual_profit >= 0 ? 'text-green-500' : 'text-destructive',
                              )}
                            >
                              {trade.actual_profit >= 0 ? '+' : ''}
                              {Number(trade.actual_profit).toFixed(4)} USDT
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* API Key Management */}
      <div className="pt-4 border-t">
        <AdminApiKeyManager />
      </div>
    </div>
  );
};

export default AdminTradingExecution;

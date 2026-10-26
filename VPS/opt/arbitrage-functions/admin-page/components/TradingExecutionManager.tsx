import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { Badge } from './ui/badge';
import { ApiKeyManager } from './ApiKeyManager';
import { 
  Play, 
  Settings, 
  History, 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle,
  RefreshCw
} from 'lucide-react';
import { cn } from '../lib/utils';

interface UserSettings {
  auto_trade: boolean;
  trade_amount: number;
  max_position_size: number;
  min_profit_percent: number;
  trading_mode: 'paper' | 'real';
}

interface TradeHistory {
  id: string;
  created_at: string;
  strategy: string;
  path: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  actual_profit: number | null;
  error_message: string | null;
  execution_details: any;
}

export const TradingExecutionManager = () => {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [trades, setTrades] = useState<TradeHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSettings = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('user_settings')
      .select('auto_trade, trade_amount, max_position_size, min_profit_percent')
      .eq('user_id', user.id)
      .single();

    if (!error && data) {
      setSettings(data as UserSettings);
    }
  }, []);

  const fetchTrades = useCallback(async () => {
    setRefreshing(true);
    const { data, error } = await supabase
      .from('trade_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (!error && data) {
      setTrades(data as TradeHistory[]);
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

    // Subscribe to trade history changes
    const channel = supabase
      .channel('trade_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trade_history' }, () => {
        fetchTrades();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchSettings, fetchTrades]);

  const handleUpdateSettings = async (updates: Partial<UserSettings>) => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('user_settings')
      .update(updates)
      .eq('user_id', user.id);

    if (!error) {
      setSettings(prev => prev ? { ...prev, ...updates } : null);
    }
    setSaving(false);
  };

  if (loading) return <div className="p-8 text-center text-slate-400">Loading execution data...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-400" />
            Trading Execution
          </h2>
          <p className="text-sm text-slate-400">Manage automated trading and monitor execution status.</p>
        </div>
        <div className="flex gap-2">
           <Button 
            variant="outline" 
            size="sm" 
            onClick={fetchTrades} 
            disabled={refreshing}
            className="bg-slate-800 border-slate-700"
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Bot Controls */}
        <Card className="bg-slate-800 border-slate-700 md:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Play className="w-4 h-4 text-green-400" />
              Bot Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-slate-700">
              <div>
                <Label className="text-sm font-bold">Auto Trading</Label>
                <p className="text-xs text-slate-400">Enable automated execution</p>
              </div>
              <Switch 
                checked={settings?.auto_trade || false}
                onCheckedChange={(checked) => handleUpdateSettings({ auto_trade: checked })}
                disabled={saving}
              />
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs text-slate-400 uppercase">Trade Amount (USDT)</Label>
                <Input 
                  type="number" 
                  value={settings?.trade_amount || 0}
                  onChange={(e) => handleUpdateSettings({ trade_amount: parseFloat(e.target.value) })}
                  className="bg-slate-900 border-slate-700"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-slate-400 uppercase">Min Profit %</Label>
                <Input 
                  type="number" 
                  step="0.01"
                  value={settings?.min_profit_percent || 0}
                  onChange={(e) => handleUpdateSettings({ min_profit_percent: parseFloat(e.target.value) })}
                  className="bg-slate-900 border-slate-700"
                />
              </div>
            </div>

            <div className="p-3 bg-amber-900/20 border border-amber-700/50 rounded-lg">
              <div className="flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-500 mt-0.5" />
                <p className="text-xs text-amber-200">
                  Paper trading is currently forced globally for safety. Real money execution requires admin approval.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Execution Monitor */}
        <Card className="bg-slate-800 border-slate-700 md:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <History className="w-4 h-4 text-blue-400" />
                Execution History
              </CardTitle>
              <CardDescription className="text-xs">Recent trading activity and results.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-400 uppercase bg-slate-900/50">
                  <tr>
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Path</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {trades.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500 italic">
                        No recent trades found.
                      </td>
                    </tr>
                  ) : (
                    trades.map((trade) => (
                      <tr key={trade.id} className="hover:bg-slate-700/30 transition-colors">
                        <td className="px-4 py-3 text-xs text-slate-300">
                          {new Date(trade.created_at).toLocaleTimeString()}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs bg-slate-900 px-2 py-1 rounded border border-slate-700">
                            {trade.path}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {trade.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />}
                            {trade.status === 'failed' && <XCircle className="w-3.5 h-3.5 text-red-400" />}
                            {trade.status === 'executing' && <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />}
                            {trade.status === 'pending' && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                            <span className={cn(
                              "text-xs font-medium",
                              trade.status === 'completed' && "text-green-400",
                              trade.status === 'failed' && "text-red-400",
                              trade.status === 'executing' && "text-blue-400",
                              trade.status === 'pending' && "text-amber-400"
                            )}>
                              {trade.status.toUpperCase()}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {trade.actual_profit !== null ? (
                            <span className={cn(
                              "text-xs font-bold",
                              trade.actual_profit >= 0 ? "text-green-400" : "text-red-400"
                            )}>
                              {trade.actual_profit >= 0 ? '+' : ''}{trade.actual_profit.toFixed(4)} USDT
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
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
      <div className="pt-4">
        <ApiKeyManager />
      </div>
    </div>
  );
};

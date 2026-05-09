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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
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
import { MultiSelect } from '@/components/ui/multi-select';

interface TradeHistoryRow {
  id: string;
  created_at: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  actual_profit: number | null;
  base_symbol: string;
  intermediate_symbol: string;
  quote_symbol: string;
}

const EXCHANGE_OPTIONS = [
  { value: 'binance', label: 'Binance' },
  { value: 'bybit', label: 'Bybit' },
  { value: 'okx', label: 'OKX' },
  { value: 'gate', label: 'Gate.io' },
  { value: 'kucoin', label: 'KuCoin' },
  { value: 'mexc', label: 'MEXC' },
];

export const AdminTradingExecution = () => {
  const [approved, setApproved] = useState(false);
  const [allowedExchanges, setAllowedExchanges] = useState<string[]>([]);
  const [trades, setTrades] = useState<TradeHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAdminFlags = useCallback(async () => {
    const { data, error } = await supabase
      .from('admin_settings')
      .select('key, value')
      .in('key', ['real_money_approved', 'real_money_allowed_exchanges']);
    if (!error && data) {
      const map = Object.fromEntries(data.map((r) => [r.key, r.value]));
      setApproved(String(map['real_money_approved'] ?? 'false').toLowerCase() === 'true');
      try {
        setAllowedExchanges(JSON.parse(map['real_money_allowed_exchanges'] || '[]'));
      } catch {
        setAllowedExchanges([]);
      }
    }
  }, []);

  const fetchTrades = useCallback(async () => {
    setRefreshing(true);
    const { data, error } = await supabase
      .from('trade_history')
      .select('id, created_at, status, actual_profit, base_symbol, intermediate_symbol, quote_symbol')
      .order('created_at', { ascending: false })
      .limit(20);
    if (!error && data) setTrades(data as unknown as TradeHistoryRow[]);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchAdminFlags(), fetchTrades()]);
      setLoading(false);
    };
    init();

    const channel = supabase
      .channel('admin_trade_updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trade_history' },
        () => fetchTrades(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAdminFlags, fetchTrades]);

  const upsertSetting = async (key: string, value: string) => {
    const { error } = await supabase
      .from('admin_settings')
      .upsert({ key, value }, { onConflict: 'key' });
    if (error) throw error;
  };

  const handleToggleApproved = async (checked: boolean) => {
    if (checked && allowedExchanges.length === 0) {
      toast.error('Select at least one allowed exchange before enabling real-money trading.');
      return;
    }
    setSaving(true);
    try {
      await upsertSetting('real_money_approved', checked ? 'true' : 'false');
      setApproved(checked);
      toast.success(checked ? 'Real-money trading APPROVED' : 'Real-money trading disabled');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update approval flag');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveExchanges = async () => {
    setSaving(true);
    try {
      await upsertSetting('real_money_allowed_exchanges', JSON.stringify(allowedExchanges));
      // DB trigger will auto-disable approval if list became empty — reflect locally.
      if (allowedExchanges.length === 0 && approved) {
        await upsertSetting('real_money_approved', 'false');
        setApproved(false);
        toast.warning('Allowed exchanges cleared — real-money trading was automatically disabled.');
      } else {
        toast.success('Allowed exchanges saved');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save allowed exchanges');
    } finally {
      setSaving(false);
    }
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
            Real-Money Execution Approval
          </h2>
          <p className="text-xs text-muted-foreground">
            Decide when the system is ready for real-money trading and which exchanges are allowed.
            Trade amounts, min profit and API keys are configured by each user on their dashboard.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchTrades} disabled={refreshing}>
          <RefreshCw className={cn('w-3.5 h-3.5 mr-2', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Approval controls */}
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-500" />
              Approval
            </CardTitle>
            <CardDescription className="text-xs">
              Controls live execution globally across all users.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border">
              <div>
                <Label className="text-sm font-bold">Real-Money Trading</Label>
                <p className="text-xs text-muted-foreground">
                  When OFF, only paper trades are allowed.
                </p>
              </div>
              <Switch
                checked={approved}
                onCheckedChange={handleToggleApproved}
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase text-muted-foreground">
                Allowed Exchanges (real money)
              </Label>
              <MultiSelect
                options={EXCHANGE_OPTIONS}
                selected={allowedExchanges}
                onChange={setAllowedExchanges}
                placeholder="Select exchanges..."
              />
              <Button
                size="sm"
                className="w-full"
                onClick={handleSaveExchanges}
                disabled={saving}
              >
                Save Allowed Exchanges
              </Button>
            </div>

            <div
              className={cn(
                'p-3 rounded-lg border text-xs',
                approved
                  ? 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400',
              )}
            >
              {approved
                ? `Live trading is APPROVED for: ${allowedExchanges.join(', ') || 'no exchanges yet'}`
                : 'Live trading is currently DISABLED. Users can only run paper trades.'}
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
    </div>
  );
};

export default AdminTradingExecution;

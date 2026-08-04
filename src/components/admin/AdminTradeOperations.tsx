import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, ListChecks, History, Wrench, Download } from 'lucide-react';


interface QueueRow {
  id: string;
  user_id: string;
  opportunity_id: string;
  status: string | null;
  priority: number | null;
  actual_trade_amount: number;
  error_message: string | null;
  queued_at: string | null;
  completed_at: string | null;
}

interface TradeRow {
  id: string;
  user_id: string;
  opportunity_id: string | null;
  status: string | null;
  base_symbol: string;
  intermediate_symbol: string;
  quote_symbol: string;
  start_amount: number;
  actual_profit: number | null;
  error_message: string | null;
  created_at: string | null;
  execution_details: any;
}

interface RunRow {
  id: string;
  source: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  users_processed: number;
  inserts_attempted: number;
  successes: number;
  failures: number;
  details: any;
}

const statusVariant = (status?: string | null) => {
  switch (status) {
    case 'completed':
      return 'default' as const;
    case 'failed':
      return 'destructive' as const;
    case 'cancelled':
      return 'outline' as const;
    default:
      return 'secondary' as const;
  }
};

export const AdminTradeOperations = () => {
  const { toast } = useToast();
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [search, setSearch] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [queueRes, tradesRes, runsRes, profilesRes] = await Promise.all([
        supabase.from('auto_trade_queue').select('*').order('queued_at', { ascending: false }).limit(100),
        supabase.from('trade_history').select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('scheduler_runs').select('*').order('started_at', { ascending: false }).limit(25),
        supabase.from('profiles').select('user_id, email').limit(1000),
      ]);

      if (queueRes.error) throw queueRes.error;
      if (tradesRes.error) throw tradesRes.error;

      setQueue((queueRes.data || []) as QueueRow[]);
      setTrades((tradesRes.data || []) as unknown as TradeRow[]);
      setRuns((runsRes.data || []) as RunRow[]);

      const map: Record<string, string> = {};
      (profilesRes.data || []).forEach((p: any) => { map[p.user_id] = p.email; });
      setEmails(map);
    } catch (err: any) {
      toast({ title: 'Failed to load trade operations', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const runReconciliation = async () => {
    setReconciling(true);
    try {
      const { data, error } = await supabase.rpc('reconcile_duplicate_trades');
      if (error) throw error;
      const row: any = Array.isArray(data) ? data[0] : data;
      toast({
        title: 'Reconciliation complete',
        description: `Cancelled ${row?.trades_cancelled ?? 0} duplicate trades, ${row?.queue_cancelled ?? 0} queue entries, re-linked ${row?.queue_relinked ?? 0}.`,
      });
      fetchAll();
    } catch (err: any) {
      toast({ title: 'Reconciliation failed', description: err.message, variant: 'destructive' });
    } finally {
      setReconciling(false);
    }
  };

  const label = (userId: string) => emails[userId] || `${userId.slice(0, 8)}…`;
  const matches = (userId: string) => !search || label(userId).toLowerCase().includes(search.toLowerCase());

  const filteredQueue = queue.filter(q => matches(q.user_id));
  const filteredTrades = trades.filter(t => matches(t.user_id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Trade Operations</h2>
          <p className="text-xs text-muted-foreground">Per-user queue, trades, scheduler runs and duplicate reconciliation.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Filter by user email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-56"
          />
          <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading} className="gap-2">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={runReconciliation} disabled={reconciling} className="gap-2">
            <Wrench className="h-3.5 w-3.5" />
            {reconciling ? 'Reconciling…' : 'Reconcile duplicates'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4" /> Auto-Trade Queue ({filteredQueue.length})
          </CardTitle>
          <CardDescription>Most recent 100 queue entries across all users.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {filteredQueue.length === 0 ? (
            <p className="text-sm text-muted-foreground">No queue entries.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left py-2">User</th>
                  <th className="text-left">Status</th>
                  <th className="text-left">Amount</th>
                  <th className="text-left">Opportunity</th>
                  <th className="text-left">Queued</th>
                  <th className="text-left">Error</th>
                </tr>
              </thead>
              <tbody>
                {filteredQueue.map(q => (
                  <tr key={q.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{label(q.user_id)}</td>
                    <td className="pr-3"><Badge variant={statusVariant(q.status)}>{q.status}</Badge></td>
                    <td className="pr-3">${Number(q.actual_trade_amount).toFixed(2)}</td>
                    <td className="pr-3 font-mono text-xs">{q.opportunity_id?.slice(0, 8)}…</td>
                    <td className="pr-3 text-xs">{q.queued_at ? new Date(q.queued_at).toLocaleString() : '—'}</td>
                    <td className="text-xs text-destructive max-w-[240px] truncate">{q.error_message || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4" /> Trades ({filteredTrades.length})
          </CardTitle>
          <CardDescription>Most recent 100 trades, live and paper.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {filteredTrades.length === 0 ? (
            <p className="text-sm text-muted-foreground">No trades.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left py-2">User</th>
                  <th className="text-left">Mode</th>
                  <th className="text-left">Path</th>
                  <th className="text-left">Status</th>
                  <th className="text-left">Amount</th>
                  <th className="text-left">P&amp;L</th>
                  <th className="text-left">Created</th>
                  <th className="text-left">Error</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrades.map(t => {
                  const isPaper = !!t.execution_details?.is_paper_trade;
                  return (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">{label(t.user_id)}</td>
                      <td className="pr-3">
                        <Badge variant={isPaper ? 'outline' : 'secondary'}>{isPaper ? 'Paper' : 'Live'}</Badge>
                      </td>
                      <td className="pr-3 text-xs">{t.base_symbol}→{t.intermediate_symbol}→{t.quote_symbol}</td>
                      <td className="pr-3"><Badge variant={statusVariant(t.status)}>{t.status}</Badge></td>
                      <td className="pr-3">${Number(t.start_amount).toFixed(2)}</td>
                      <td className="pr-3">{t.actual_profit != null ? `$${Number(t.actual_profit).toFixed(2)}` : '—'}</td>
                      <td className="pr-3 text-xs">{t.created_at ? new Date(t.created_at).toLocaleString() : '—'}</td>
                      <td className="text-xs text-destructive max-w-[240px] truncate">{t.error_message || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> Scheduler Run History
          </CardTitle>
          <CardDescription>Start/end time, users processed, inserts attempted, successes and failures.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scheduler runs recorded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left py-2">Source</th>
                  <th className="text-left">Started</th>
                  <th className="text-left">Finished</th>
                  <th className="text-left">Duration</th>
                  <th className="text-left">Users</th>
                  <th className="text-left">Attempted</th>
                  <th className="text-left">Success</th>
                  <th className="text-left">Failed</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{r.source}</td>
                    <td className="pr-3 text-xs">{new Date(r.started_at).toLocaleString()}</td>
                    <td className="pr-3 text-xs">{r.finished_at ? new Date(r.finished_at).toLocaleTimeString() : '—'}</td>
                    <td className="pr-3 text-xs">{r.duration_ms != null ? `${r.duration_ms} ms` : '—'}</td>
                    <td className="pr-3">{r.users_processed}</td>
                    <td className="pr-3">{r.inserts_attempted}</td>
                    <td className="pr-3 text-green-500">{r.successes}</td>
                    <td className="pr-3 text-destructive">{r.failures}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

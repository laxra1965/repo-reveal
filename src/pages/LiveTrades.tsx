import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, CheckCircle2, Circle, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { parseTradeLegs, asRecord } from '@/lib/tradeTimeline';
import type { Tables } from '@/integrations/supabase/types';

type Trade = Tables<'trade_history'>;
type Queue = Tables<'auto_trade_queue'>;
const amount = (n: number | null | undefined) => n == null ? 'Not recorded' : n.toLocaleString(undefined, { maximumFractionDigits: 8 });
const time = (t: string | null | undefined) => t && Number.isFinite(Date.parse(t)) ? new Date(t).toLocaleString() : 'Time not recorded';

export default function LiveTrades() {
  const { user } = useAuth();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [queue, setQueue] = useState<Queue[]>([]);
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const load = useCallback(async () => {
    if (!user) return;
    const [history, queued] = await Promise.all([
      supabase.from('trade_history').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).range(page * 20, page * 20 + 20),
      supabase.from('auto_trade_queue').select('*').eq('user_id', user.id).in('status', ['queued', 'processing', 'executing']).order('queued_at', { ascending: false }).limit(100),
    ]);
    if (history.error || queued.error) { setError(history.error?.message || queued.error?.message || 'Could not load trades'); setLoading(false); return; }
    setError(null); setTrades((history.data || []).slice(0, 20)); setHasMore((history.data || []).length > 20); setQueue(queued.data || []); setLoading(false);
    const ids = [...new Set((queued.data || []).map((q) => q.opportunity_id))];
    if (ids.length) {
      const opportunities = await supabase.from('opportunities').select('id,path,exchange1').in('id', ids);
      setPaths(Object.fromEntries((opportunities.data || []).map((o) => [o.id, `${o.path} (${o.exchange1 || 'Exchange not recorded'})`])));
    }
  }, [user?.id, page]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, 5_000);
    return () => clearInterval(timer);
  }, [load]);
  return <main className="container mx-auto px-4 py-6 space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Button asChild variant="ghost" size="icon"><Link to="/dashboard" aria-label="Back to dashboard"><ArrowLeft className="h-5 w-5" /></Link></Button><h1 className="text-2xl font-bold">Live trades</h1></div><Button variant="outline" size="icon" onClick={() => { void load(); }} aria-label="Refresh trades"><RefreshCw className="h-4 w-4" /></Button></header>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {loading && <p className="text-muted-foreground">Loading trades...</p>}
    <section className="space-y-3" aria-label="Trade queue"><h2 className="text-lg font-semibold">Queue ({queue.length})</h2>{!loading && !queue.length && <p className="text-muted-foreground">No trades waiting.</p>}{queue.map((q) => <article key={q.id} className="border rounded-md p-4 space-y-2"><div className="flex flex-wrap justify-between gap-2"><span className="break-all">{paths[q.opportunity_id] || `Opportunity ${q.opportunity_id}`}</span><Badge variant="secondary">{q.status}</Badge></div><p>{amount(q.actual_trade_amount)} USDT</p><p className="text-sm text-muted-foreground">Queued {time(q.queued_at)}</p>{q.started_at && <p className="text-sm">Processing started {time(q.started_at)}</p>}{q.error_message && <p className="text-destructive">{q.error_message}</p>}</article>)}</section>
    <section className="space-y-4" aria-label="Trade timelines"><h2 className="text-lg font-semibold">Execution timelines</h2>{!loading && !trades.length && <p className="text-muted-foreground">No executions recorded.</p>}{trades.map((trade) => {
      const details = asRecord(trade.execution_details);
      const legs = parseTradeLegs(trade.execution_details);
      const simulated = details.is_paper_trade === true || details.mode === 'dry_run' || legs.some((leg) => leg.simulated);
      const steps = Math.max(trade.total_steps || 3, legs.length);
      return <article key={trade.id} className="border rounded-md p-4 sm:p-5 space-y-4">
        <header className="flex flex-wrap justify-between gap-3"><div><h3 className="font-semibold break-words">{trade.base_symbol} &gt; {trade.intermediate_symbol} &gt; {trade.quote_symbol}</h3><p className="text-xs text-muted-foreground break-all">{trade.id}</p></div><div className="flex gap-2 items-start"><Badge variant="outline">{simulated ? 'Simulation' : details.mode === 'live' ? 'Live' : 'Mode not recorded'}</Badge><Badge variant={trade.status === 'failed' ? 'destructive' : 'secondary'}>{trade.status}</Badge></div></header>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">{[['Start', `${amount(trade.start_amount)} USDT`], ['Final', trade.final_amount == null ? 'Pending' : `${amount(trade.final_amount)} USDT`], ['Expected profit', `${amount(trade.expected_profit)} USDT`], ['Recorded profit', trade.actual_profit == null ? 'Pending' : `${amount(trade.actual_profit)} USDT`]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-mono break-words">{value}</dd></div>)}</dl>
        <ol className="border-l ml-2 space-y-5 pl-5 text-sm"><li><p className="font-medium">Trade created</p><p className="text-muted-foreground">{time(trade.created_at)}</p></li>{Array.from({ length: steps }, (_, index) => {
          const leg = legs[index];
          const Icon = leg?.failed ? XCircle : leg ? CheckCircle2 : Circle;
          return <li key={index} className="space-y-2"><div className="flex gap-2 items-center"><Icon className={`h-4 w-4 shrink-0 ${leg?.failed ? 'text-destructive' : 'text-muted-foreground'}`} /><h4 className="font-semibold">Leg {index + 1}{leg?.exchange ? ` · ${leg.exchange}` : ''}{leg?.pair ? ` · ${leg.pair}` : ''}</h4></div>{leg ? <><p className="text-muted-foreground">{time(leg.time)}{leg.simulated ? ' · Simulated' : ''}</p>{leg.from && leg.to && <p>{leg.from} &gt; {leg.to} {leg.side}</p>}<dl className="grid grid-cols-2 sm:grid-cols-4 gap-2"><div><dt className="text-muted-foreground">Input</dt><dd>{amount(leg.amountIn)}</dd></div><div><dt className="text-muted-foreground">Filled quantity</dt><dd>{amount(leg.filled)}</dd></div><div><dt className="text-muted-foreground">Fill price</dt><dd>{amount(leg.price)}</dd></div><div><dt className="text-muted-foreground">Fee</dt><dd>{amount(leg.fee)}{leg.fee != null ? ` ${leg.feeAsset || '(asset not recorded)'}` : ''}</dd></div></dl>{leg.orderId && <p className="break-all text-xs">Order {leg.orderId}</p>}{leg.error && <p className="text-destructive">{leg.error}</p>}</> : <p className="text-muted-foreground">{trade.status === 'failed' || trade.status === 'cancelled' ? 'No fill recorded' : index < (trade.completed_steps || 0) ? 'Step marked complete; fill details not recorded' : 'Awaiting execution'}</p>}</li>;
        })}{trade.completed_at && <li><p className="font-medium">{trade.status}</p><p className="text-muted-foreground">{time(trade.completed_at)}</p></li>}</ol>
        {trade.error_message && <p className="text-destructive">{trade.error_message}</p>}
      </article>;
    })}</section>
    <div className="flex justify-between items-center"><Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button><span>Page {page + 1}</span><Button variant="outline" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>Next</Button></div>
  </main>;
}
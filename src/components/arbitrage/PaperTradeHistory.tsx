import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TrendingUp, TrendingDown, TestTube, RefreshCw, Percent } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

interface PaperTrade {
  id: string;
  base_symbol: string;
  quote_symbol: string;
  intermediate_symbol: string;
  status: string;
  start_amount: number;
  final_amount: number | null;
  expected_profit: number;
  actual_profit: number | null;
  started_at: string;
  completed_at: string | null;
  completed_steps: number;
  total_steps: number;
  execution_details: Record<string, unknown> | null;
  opportunity_id: string | null;
  exchanges?: string;
}

interface PaperTradeStats {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalSimulatedProfit: number;
  avgProfitPercent: number;
  winRate: number;
}

const PAGE_SIZE = 50;

export const PaperTradeHistory = () => {
  const { user } = useAuth();
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [stats, setStats] = useState<PaperTradeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    if (user) fetchPaperTrades(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, page]);

  const fetchPaperTrades = async (pageIndex: number) => {
    if (!user) return;

    setIsRefreshing(true);
    try {
      const { data, error } = await supabase
        .rpc('get_paper_trades_with_exchanges', {
          p_user_id: user.id,
          p_limit: PAGE_SIZE,
          p_offset: pageIndex * PAGE_SIZE,
        });

      if (error) throw error;

      const rows = (data || []) as (PaperTrade & { total_count?: number })[];
      const trades = rows as PaperTrade[];
      setTrades(trades);
      setTotalCount(rows[0]?.total_count ?? trades.length);
      calculateStats(trades);
    } catch (error) {
      console.error('Error fetching paper trades:', error);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const calculateStats = (trades: PaperTrade[]) => {
    const successful = trades.filter(t => t.status === 'completed');
    const failed = trades.filter(t => t.status === 'failed');

    const totalSimulatedProfit = successful.reduce((sum, t) => sum + (t.actual_profit || 0), 0);
    
    const profitPercentages = successful
      .filter(t => t.actual_profit != null && t.start_amount > 0)
      .map(t => ((t.actual_profit || 0) / t.start_amount) * 100);
    
    const avgProfitPercent = profitPercentages.length > 0 
      ? profitPercentages.reduce((a, b) => a + b, 0) / profitPercentages.length 
      : 0;

    setStats({
      totalTrades: trades.length,
      successfulTrades: successful.length,
      failedTrades: failed.length,
      totalSimulatedProfit,
      avgProfitPercent,
      winRate: trades.length > 0 ? (successful.length / trades.length) * 100 : 0,
    });
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      completed: 'default',
      pending: 'secondary',
      executing: 'secondary',
      failed: 'destructive',
    };

    return (
      <Badge variant={variants[status] || 'outline'} className="text-xs">
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Loading paper trades...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TestTube className="h-5 w-5 text-yellow-500" />
            <div>
              <CardTitle>Paper Trading Results</CardTitle>
              <CardDescription>Simulated trades for testing strategies</CardDescription>
            </div>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={fetchPaperTrades}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats Summary */}
        {stats && stats.totalTrades > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 bg-muted/50 rounded-lg text-center">
              <div className="text-2xl font-bold">{stats.totalTrades}</div>
              <div className="text-xs text-muted-foreground">Total Paper Trades</div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg text-center">
              <div className={`text-2xl font-bold flex items-center justify-center gap-1 ${stats.totalSimulatedProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {stats.totalSimulatedProfit >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                ${Math.abs(stats.totalSimulatedProfit).toFixed(4)}
              </div>
              <div className="text-xs text-muted-foreground">Simulated P&L</div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg text-center">
              <div className="text-2xl font-bold flex items-center justify-center gap-1">
                <Percent className="h-5 w-5" />
                {stats.winRate.toFixed(1)}%
              </div>
              <div className="text-xs text-muted-foreground">Win Rate</div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg text-center">
              <div className={`text-2xl font-bold ${stats.avgProfitPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {stats.avgProfitPercent >= 0 ? '+' : ''}{stats.avgProfitPercent.toFixed(4)}%
              </div>
              <div className="text-xs text-muted-foreground">Avg Profit %</div>
            </div>
          </div>
        )}

        {/* Trade History Table */}
        {trades.length === 0 ? (
          <div className="text-center py-8">
            <TestTube className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-50" />
            <p className="text-muted-foreground">No paper trades yet</p>
            <p className="text-sm text-muted-foreground mt-2">
              Click "Paper Trade" on any arbitrage opportunity to test your strategy
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Exchange</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Start</TableHead>
                  <TableHead className="text-right">Final</TableHead>
                  <TableHead className="text-right">P&L</TableHead>
                  <TableHead>Progress</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map((trade) => (
                  <TableRow key={trade.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {format(new Date(trade.started_at), 'MMM dd, HH:mm')}
                    </TableCell>
                    <TableCell className="text-xs capitalize">
                      <Badge variant="outline">{trade.exchanges || '—'}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {trade.quote_symbol} → {trade.base_symbol} → {trade.intermediate_symbol}
                    </TableCell>
                    <TableCell>{getStatusBadge(trade.status)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      ${trade.start_amount.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {trade.final_amount ? `$${trade.final_amount.toFixed(4)}` : '-'}
                    </TableCell>
                    <TableCell className={`text-right font-mono text-xs ${
                      trade.actual_profit 
                        ? trade.actual_profit >= 0 
                          ? 'text-green-500' 
                          : 'text-red-500'
                        : 'text-muted-foreground'
                    }`}>
                      {trade.actual_profit != null 
                        ? `${trade.actual_profit >= 0 ? '+' : ''}$${trade.actual_profit.toFixed(4)}`
                        : 'Pending'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${trade.status === 'completed' ? 'bg-green-500' : trade.status === 'failed' ? 'bg-red-500' : 'bg-yellow-500'}`}
                            style={{ width: `${(trade.completed_steps / trade.total_steps) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {trade.completed_steps}/{trade.total_steps}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

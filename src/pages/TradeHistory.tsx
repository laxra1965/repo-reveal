import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, TrendingUp, TrendingDown, DollarSign, Percent } from 'lucide-react';
import { format } from 'date-fns';

interface TradeHistory {
  id: string;
  user_id: string;
  opportunity_id: string | null;
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
  error_message: string | null;
  completed_steps: number;
  total_steps: number;
}

interface TradeStats {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  pendingTrades: number;
  totalProfit: number;
  totalExpectedProfit: number;
  successRate: number;
}

const TradeHistory = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [trades, setTrades] = useState<TradeHistory[]>([]);
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      fetchTradeHistory();
    }
  }, [user]);

  const fetchTradeHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('trade_history')
        .select('*')
        .eq('user_id', user!.id)
        .order('started_at', { ascending: false });

      if (error) throw error;

      setTrades(data || []);
      calculateStats(data || []);
    } catch (error) {
      console.error('Error fetching trade history:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (trades: TradeHistory[]) => {
    const successful = trades.filter(t => t.status === 'completed');
    const failed = trades.filter(t => t.status === 'failed');
    const pending = trades.filter(t => t.status === 'pending' || t.status === 'processing');

    const totalProfit = successful.reduce((sum, t) => sum + (t.actual_profit || 0), 0);
    const totalExpectedProfit = trades.reduce((sum, t) => sum + t.expected_profit, 0);

    setStats({
      totalTrades: trades.length,
      successfulTrades: successful.length,
      failedTrades: failed.length,
      pendingTrades: pending.length,
      totalProfit,
      totalExpectedProfit,
      successRate: trades.length > 0 ? (successful.length / trades.length) * 100 : 0,
    });
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      completed: 'default',
      pending: 'secondary',
      processing: 'secondary',
      failed: 'destructive',
    };

    return (
      <Badge variant={variants[status] || 'outline'}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-xl text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold">Trade History</h1>
              <p className="text-muted-foreground">Monitor your automated trading performance</p>
            </div>
          </div>
          <Button variant="outline" onClick={signOut}>
            Sign Out
          </Button>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Trades</CardDescription>
                <CardTitle className="text-3xl">{stats.totalTrades}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground">
                  <span className="text-green-500">{stats.successfulTrades} successful</span>
                  {' • '}
                  <span className="text-red-500">{stats.failedTrades} failed</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total P&L</CardDescription>
                <CardTitle className={`text-3xl flex items-center gap-2 ${stats.totalProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {stats.totalProfit >= 0 ? <TrendingUp className="h-6 w-6" /> : <TrendingDown className="h-6 w-6" />}
                  ${stats.totalProfit.toFixed(2)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground">
                  Expected: ${stats.totalExpectedProfit.toFixed(2)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Success Rate</CardDescription>
                <CardTitle className="text-3xl flex items-center gap-2">
                  <Percent className="h-6 w-6" />
                  {stats.successRate.toFixed(1)}%
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground">
                  {stats.successfulTrades} of {stats.totalTrades} trades
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Pending Trades</CardDescription>
                <CardTitle className="text-3xl">{stats.pendingTrades}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground">
                  Currently processing
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Trade History Table */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Trades</CardTitle>
            <CardDescription>Detailed history of all executed trades</CardDescription>
          </CardHeader>
          <CardContent>
            {trades.length === 0 ? (
              <div className="text-center py-12">
                <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-lg text-muted-foreground">No trades yet</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Enable auto-trade in settings to start executing opportunities
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Path</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Start Amount</TableHead>
                      <TableHead className="text-right">Final Amount</TableHead>
                      <TableHead className="text-right">Expected Profit</TableHead>
                      <TableHead className="text-right">Actual Profit</TableHead>
                      <TableHead>Progress</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trades.map((trade) => (
                      <TableRow key={trade.id}>
                        <TableCell className="whitespace-nowrap">
                          {format(new Date(trade.started_at), 'MMM dd, HH:mm:ss')}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {trade.quote_symbol} → {trade.base_symbol} → {trade.intermediate_symbol} → {trade.quote_symbol}
                        </TableCell>
                        <TableCell>{getStatusBadge(trade.status)}</TableCell>
                        <TableCell className="text-right font-mono">
                          ${trade.start_amount.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {trade.final_amount ? `$${trade.final_amount.toFixed(2)}` : '-'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          ${trade.expected_profit.toFixed(2)}
                        </TableCell>
                        <TableCell className={`text-right font-mono ${
                          trade.actual_profit 
                            ? trade.actual_profit >= 0 
                              ? 'text-green-500' 
                              : 'text-red-500'
                            : ''
                        }`}>
                          {trade.actual_profit ? `$${trade.actual_profit.toFixed(2)}` : '-'}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">
                            {trade.completed_steps}/{trade.total_steps} steps
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default TradeHistory;

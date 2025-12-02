import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Activity, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Loader2, 
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Zap
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface QueuedTrade {
  id: string;
  user_id: string;
  opportunity_id: string;
  status: string;
  priority: number;
  tier_max_amount: number;
  actual_trade_amount: number;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

interface TradeHistory {
  id: string;
  status: string;
  base_symbol: string;
  quote_symbol: string;
  intermediate_symbol: string;
  start_amount: number;
  final_amount: number | null;
  expected_profit: number;
  actual_profit: number | null;
  completed_steps: number;
  total_steps: number;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  execution_details: any;
}

interface AutoTradeStats {
  total_users_with_auto_trade: number;
  queued_trades: number;
  processing_trades: number;
  trades_last_hour: number;
  failed_trades_last_hour: number;
  avg_trade_time_seconds: number;
}

export const AutoTradeMonitor = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [queuedTrades, setQueuedTrades] = useState<QueuedTrade[]>([]);
  const [tradeHistory, setTradeHistory] = useState<TradeHistory[]>([]);
  const [stats, setStats] = useState<AutoTradeStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = async () => {
    if (!user) return;

    try {
      // Fetch queued trades
      const { data: queue, error: queueError } = await supabase
        .from('auto_trade_queue')
        .select('*')
        .eq('user_id', user.id)
        .order('queued_at', { ascending: false })
        .limit(50);

      if (queueError) throw queueError;
      setQueuedTrades(queue || []);

      // Fetch trade history
      const { data: history, error: historyError } = await supabase
        .from('trade_history')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100);

      if (historyError) throw historyError;
      setTradeHistory(history || []);

      // Fetch stats
      const { data: statsData, error: statsError } = await supabase
        .rpc('get_auto_trade_status');

      if (!statsError && statsData?.[0]) {
        setStats(statsData[0]);
      }
    } catch (error) {
      console.error('Error fetching auto trade data:', error);
      toast({
        title: "Error",
        description: "Failed to fetch auto trade data",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Set up real-time subscriptions
    const queueChannel = supabase
      .channel('auto-trade-queue')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'auto_trade_queue',
          filter: `user_id=eq.${user?.id}`
        },
        () => fetchData()
      )
      .subscribe();

    const historyChannel = supabase
      .channel('trade-history-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trade_history',
          filter: `user_id=eq.${user?.id}`
        },
        () => fetchData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(queueChannel);
      supabase.removeChannel(historyChannel);
    };
  }, [user]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchData();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'queued':
        return <Badge variant="secondary" className="flex items-center gap-1"><Clock className="h-3 w-3" /> Queued</Badge>;
      case 'processing':
        return <Badge variant="default" className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Processing</Badge>;
      case 'executing':
        return <Badge className="bg-blue-500 flex items-center gap-1"><Zap className="h-3 w-3" /> Executing</Badge>;
      case 'completed':
        return <Badge className="bg-green-500 flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Completed</Badge>;
      case 'failed':
        return <Badge variant="destructive" className="flex items-center gap-1"><XCircle className="h-3 w-3" /> Failed</Badge>;
      case 'pending':
        return <Badge variant="outline" className="flex items-center gap-1"><Clock className="h-3 w-3" /> Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatTime = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString();
  };

  const queuedCount = queuedTrades.filter(t => t.status === 'queued').length;
  const processingCount = queuedTrades.filter(t => t.status === 'processing').length;
  const completedCount = tradeHistory.filter(t => t.status === 'completed').length;
  const failedCount = tradeHistory.filter(t => t.status === 'failed').length;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Queued</p>
                <p className="text-2xl font-bold">{queuedCount}</p>
              </div>
              <Clock className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Processing</p>
                <p className="text-2xl font-bold">{processingCount}</p>
              </div>
              <Activity className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Completed</p>
                <p className="text-2xl font-bold text-green-500">{completedCount}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Failed</p>
                <p className="text-2xl font-bold text-red-500">{failedCount}</p>
              </div>
              <XCircle className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Auto Trade Monitor
            </CardTitle>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="queue">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="queue">
                Queue ({queuedCount + processingCount})
              </TabsTrigger>
              <TabsTrigger value="completed">
                Completed ({completedCount})
              </TabsTrigger>
              <TabsTrigger value="failed">
                Failed ({failedCount})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="queue" className="mt-4">
              <ScrollArea className="h-[400px]">
                {queuedTrades.filter(t => ['queued', 'processing'].includes(t.status)).length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No trades in queue
                  </div>
                ) : (
                  <div className="space-y-2">
                    {queuedTrades
                      .filter(t => ['queued', 'processing'].includes(t.status))
                      .map(trade => (
                        <div key={trade.id} className="p-3 border rounded-lg">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {getStatusBadge(trade.status)}
                              <span className="text-sm font-medium">
                                ${trade.actual_trade_amount.toFixed(2)}
                              </span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              Priority: {trade.priority}
                            </span>
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            <span>Queued: {formatTime(trade.queued_at)}</span>
                            {trade.started_at && (
                              <span className="ml-4">Started: {formatTime(trade.started_at)}</span>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="completed" className="mt-4">
              <ScrollArea className="h-[400px]">
                {tradeHistory.filter(t => t.status === 'completed').length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No completed trades
                  </div>
                ) : (
                  <div className="space-y-2">
                    {tradeHistory
                      .filter(t => t.status === 'completed')
                      .map(trade => (
                        <div key={trade.id} className="p-3 border rounded-lg">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {getStatusBadge(trade.status)}
                              <span className="font-medium">
                                {trade.base_symbol}/{trade.intermediate_symbol}/{trade.quote_symbol}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              {(trade.actual_profit || 0) >= 0 ? (
                                <TrendingUp className="h-4 w-4 text-green-500" />
                              ) : (
                                <TrendingDown className="h-4 w-4 text-red-500" />
                              )}
                              <span className={`font-bold ${(trade.actual_profit || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                ${(trade.actual_profit || 0).toFixed(4)}
                              </span>
                            </div>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                            <span>Start: ${trade.start_amount.toFixed(2)}</span>
                            <span>Final: ${(trade.final_amount || 0).toFixed(2)}</span>
                            <span>Steps: {trade.completed_steps}/{trade.total_steps}</span>
                            <span>Completed: {formatTime(trade.completed_at)}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="failed" className="mt-4">
              <ScrollArea className="h-[400px]">
                {tradeHistory.filter(t => t.status === 'failed').length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No failed trades
                  </div>
                ) : (
                  <div className="space-y-2">
                    {tradeHistory
                      .filter(t => t.status === 'failed')
                      .map(trade => (
                        <div key={trade.id} className="p-3 border rounded-lg border-red-200">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {getStatusBadge(trade.status)}
                              <span className="font-medium">
                                {trade.base_symbol}/{trade.intermediate_symbol}/{trade.quote_symbol}
                              </span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              Steps: {trade.completed_steps}/{trade.total_steps}
                            </span>
                          </div>
                          {trade.error_message && (
                            <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs text-red-600 dark:text-red-400">
                              {trade.error_message}
                            </div>
                          )}
                          <div className="mt-2 text-xs text-muted-foreground">
                            <span>Amount: ${trade.start_amount.toFixed(2)}</span>
                            <span className="ml-4">Failed: {formatTime(trade.completed_at)}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* System Stats */}
      {stats && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">System Statistics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Users with Auto-Trade:</span>
                <span className="ml-2 font-medium">{stats.total_users_with_auto_trade}</span>
              </div>
              <div>
                <span className="text-muted-foreground">System Queue:</span>
                <span className="ml-2 font-medium">{stats.queued_trades}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Trades Last Hour:</span>
                <span className="ml-2 font-medium">{stats.trades_last_hour}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Failed Last Hour:</span>
                <span className="ml-2 font-medium text-red-500">{stats.failed_trades_last_hour}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Avg Trade Time:</span>
                <span className="ml-2 font-medium">
                  {stats.avg_trade_time_seconds ? `${stats.avg_trade_time_seconds.toFixed(1)}s` : 'N/A'}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

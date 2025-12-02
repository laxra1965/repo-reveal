import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  LineChart, 
  Line, 
  AreaChart, 
  Area,
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Clock, 
  Target,
  BarChart3,
  Activity,
  Percent
} from 'lucide-react';

interface TradeRecord {
  id: string;
  status: string;
  start_amount: number;
  final_amount: number | null;
  expected_profit: number;
  actual_profit: number | null;
  completed_steps: number;
  total_steps: number;
  created_at: string;
  completed_at: string | null;
  base_symbol: string;
  quote_symbol: string;
  intermediate_symbol: string;
  execution_details: any;
}

interface AnalyticsSummary {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  successRate: number;
  totalProfit: number;
  totalVolume: number;
  avgProfit: number;
  avgExecutionTime: number;
  bestTrade: number;
  worstTrade: number;
}

const COLORS = ['#22c55e', '#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6'];

export const AutoTradeAnalytics = () => {
  const { user } = useAuth();
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [timeRange, setTimeRange] = useState('7d');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchTrades = async () => {
      if (!user) return;

      setIsLoading(true);

      let startDate = new Date();
      switch (timeRange) {
        case '24h':
          startDate.setHours(startDate.getHours() - 24);
          break;
        case '7d':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(startDate.getDate() - 30);
          break;
        case 'all':
          startDate = new Date(0);
          break;
      }

      try {
        const { data, error } = await supabase
          .from('trade_history')
          .select('*')
          .eq('user_id', user.id)
          .gte('created_at', startDate.toISOString())
          .order('created_at', { ascending: true });

        if (error) throw error;
        setTrades(data || []);
      } catch (error) {
        console.error('Error fetching trades:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTrades();
  }, [user, timeRange]);

  const summary: AnalyticsSummary = useMemo(() => {
    const completedTrades = trades.filter(t => t.status === 'completed');
    const failedTrades = trades.filter(t => t.status === 'failed');
    
    const totalProfit = completedTrades.reduce((sum, t) => sum + (t.actual_profit || 0), 0);
    const totalVolume = trades.reduce((sum, t) => sum + t.start_amount, 0);
    
    const profits = completedTrades.map(t => t.actual_profit || 0);
    const bestTrade = profits.length > 0 ? Math.max(...profits) : 0;
    const worstTrade = profits.length > 0 ? Math.min(...profits) : 0;
    
    const executionTimes = completedTrades
      .filter(t => t.created_at && t.completed_at)
      .map(t => {
        const start = new Date(t.created_at).getTime();
        const end = new Date(t.completed_at!).getTime();
        return (end - start) / 1000; // seconds
      });
    
    const avgExecutionTime = executionTimes.length > 0 
      ? executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length 
      : 0;

    return {
      totalTrades: trades.length,
      successfulTrades: completedTrades.length,
      failedTrades: failedTrades.length,
      successRate: trades.length > 0 ? (completedTrades.length / trades.length) * 100 : 0,
      totalProfit,
      totalVolume,
      avgProfit: completedTrades.length > 0 ? totalProfit / completedTrades.length : 0,
      avgExecutionTime,
      bestTrade,
      worstTrade
    };
  }, [trades]);

  const profitOverTime = useMemo(() => {
    const completedTrades = trades.filter(t => t.status === 'completed' && t.completed_at);
    
    // Group by day
    const dailyProfits: Record<string, { date: string; profit: number; volume: number; count: number }> = {};
    
    completedTrades.forEach(trade => {
      const date = new Date(trade.completed_at!).toLocaleDateString();
      if (!dailyProfits[date]) {
        dailyProfits[date] = { date, profit: 0, volume: 0, count: 0 };
      }
      dailyProfits[date].profit += trade.actual_profit || 0;
      dailyProfits[date].volume += trade.start_amount;
      dailyProfits[date].count += 1;
    });

    return Object.values(dailyProfits).sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
  }, [trades]);

  const cumulativeProfit = useMemo(() => {
    let cumulative = 0;
    return profitOverTime.map(day => {
      cumulative += day.profit;
      return { ...day, cumulative };
    });
  }, [profitOverTime]);

  const statusDistribution = useMemo(() => {
    const distribution: Record<string, number> = {};
    trades.forEach(trade => {
      distribution[trade.status] = (distribution[trade.status] || 0) + 1;
    });
    return Object.entries(distribution).map(([name, value]) => ({ name, value }));
  }, [trades]);

  const symbolPerformance = useMemo(() => {
    const performance: Record<string, { symbol: string; trades: number; profit: number }> = {};
    
    trades.filter(t => t.status === 'completed').forEach(trade => {
      const symbol = `${trade.base_symbol}/${trade.intermediate_symbol}`;
      if (!performance[symbol]) {
        performance[symbol] = { symbol, trades: 0, profit: 0 };
      }
      performance[symbol].trades += 1;
      performance[symbol].profit += trade.actual_profit || 0;
    });

    return Object.values(performance)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 10);
  }, [trades]);

  const executionTimeData = useMemo(() => {
    return trades
      .filter(t => t.status === 'completed' && t.created_at && t.completed_at)
      .map(trade => {
        const start = new Date(trade.created_at).getTime();
        const end = new Date(trade.completed_at!).getTime();
        return {
          date: new Date(trade.completed_at!).toLocaleDateString(),
          time: (end - start) / 1000
        };
      })
      .slice(-30);
  }, [trades]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Activity className="h-8 w-8 animate-pulse text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Time Range Selector */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Trade Analytics
        </h2>
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24h">Last 24h</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Profit</p>
                <p className={`text-2xl font-bold ${summary.totalProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  ${summary.totalProfit.toFixed(4)}
                </p>
              </div>
              {summary.totalProfit >= 0 ? (
                <TrendingUp className="h-8 w-8 text-green-500" />
              ) : (
                <TrendingDown className="h-8 w-8 text-red-500" />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Success Rate</p>
                <p className="text-2xl font-bold">{summary.successRate.toFixed(1)}%</p>
              </div>
              <Target className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Volume</p>
                <p className="text-2xl font-bold">${summary.totalVolume.toFixed(2)}</p>
              </div>
              <DollarSign className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Avg Execution</p>
                <p className="text-2xl font-bold">{summary.avgExecutionTime.toFixed(1)}s</p>
              </div>
              <Clock className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="col-span-1">
          <CardContent className="pt-4 text-center">
            <p className="text-sm text-muted-foreground">Total Trades</p>
            <p className="text-xl font-bold">{summary.totalTrades}</p>
          </CardContent>
        </Card>
        <Card className="col-span-1">
          <CardContent className="pt-4 text-center">
            <p className="text-sm text-muted-foreground">Avg Profit/Trade</p>
            <p className={`text-xl font-bold ${summary.avgProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              ${summary.avgProfit.toFixed(4)}
            </p>
          </CardContent>
        </Card>
        <Card className="col-span-1">
          <CardContent className="pt-4 text-center">
            <p className="text-sm text-muted-foreground">Best Trade</p>
            <p className="text-xl font-bold text-green-500">${summary.bestTrade.toFixed(4)}</p>
          </CardContent>
        </Card>
        <Card className="col-span-1">
          <CardContent className="pt-4 text-center">
            <p className="text-sm text-muted-foreground">Worst Trade</p>
            <p className="text-xl font-bold text-red-500">${summary.worstTrade.toFixed(4)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Cumulative Profit Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Cumulative Profit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              {cumulativeProfit.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={cumulativeProfit}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="date" 
                      tick={{ fontSize: 10 }} 
                      className="text-muted-foreground"
                    />
                    <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))', 
                        border: '1px solid hsl(var(--border))' 
                      }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="cumulative" 
                      stroke="hsl(var(--primary))" 
                      fill="hsl(var(--primary) / 0.2)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No data available
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Trade Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              {statusDistribution.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {statusDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No data available
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Daily Profit */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Daily Profit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              {profitOverTime.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={profitOverTime}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))', 
                        border: '1px solid hsl(var(--border))' 
                      }}
                    />
                    <Bar 
                      dataKey="profit" 
                      fill="hsl(var(--primary))"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No data available
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Execution Time */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Execution Time (seconds)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              {executionTimeData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={executionTimeData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))', 
                        border: '1px solid hsl(var(--border))' 
                      }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="time" 
                      stroke="hsl(var(--primary))" 
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No data available
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Performing Symbols */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Top Performing Trading Pairs</CardTitle>
          <CardDescription>Based on total profit</CardDescription>
        </CardHeader>
        <CardContent>
          {symbolPerformance.length > 0 ? (
            <div className="space-y-2">
              {symbolPerformance.map((item, index) => (
                <div key={item.symbol} className="flex items-center justify-between p-2 rounded bg-muted/50">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{index + 1}</Badge>
                    <span className="font-medium">{item.symbol}</span>
                    <span className="text-sm text-muted-foreground">({item.trades} trades)</span>
                  </div>
                  <span className={`font-bold ${item.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    ${item.profit.toFixed(4)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground">
              No completed trades to analyze
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

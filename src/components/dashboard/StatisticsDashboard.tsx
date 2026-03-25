import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, DollarSign, Activity, BarChart3, ChevronDown, ChevronUp, Trash2, AlertTriangle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { invokeFunction } from "@/lib/functionsInvoke";

interface ExchangeStats {
  exchange: string;
  totalOpportunities: number;
  avgProfit: number;
  totalVolume: number;
  successRate: number;
  avgQualityScore: number;
  maxProfit: number;
}

export const StatisticsDashboard = () => {
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const { toast } = useToast();
  const [stats, setStats] = useState<ExchangeStats[]>([]);
  const [totalStats, setTotalStats] = useState({
    totalOpportunities: 0,
    avgProfit: 0,
    totalVolume: 0,
    successRate: 0,
    maxProfit: 0
  });
  const [loading, setLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearDays, setClearDays] = useState(30);

  // Fetch stats function (extracted for reuse)
  const fetchStats = async () => {
    if (!user) return;

    try {
      setLoading(true);

      // Fetch all opportunities
      const { data: opportunities, error } = await supabase
        .from('opportunities')
        .select('*');

      if (error) throw error;

      if (!opportunities || opportunities.length === 0) {
        setStats([]);
        setTotalStats({
          totalOpportunities: 0,
          avgProfit: 0,
          totalVolume: 0,
          successRate: 0,
          maxProfit: 0
        });
        setLoading(false);
        return;
      }

      // Calculate statistics by exchange
      const exchangeMap = new Map<string, {
        count: number;
        totalProfit: number;
        totalVolume: number;
        profitableCount: number;
        totalQualityScore: number;
        maxProfit: number;
      }>();

      let totalOpps = 0;
      let totalProfitSum = 0;
      let totalVolumeSum = 0;
      let totalProfitable = 0;
      let globalMaxProfit = 0;

      opportunities.forEach(opp => {
        const exchanges = [opp.exchange1, opp.exchange2, opp.exchange3]
          .filter((val, idx, arr) => arr.indexOf(val) === idx);

        const profit = Number(opp.profit_percent) || 0;
        const volume = Number(opp.volume_estimate) || 0;
        const isProfitable = profit > 0;
        const qualityScore = Number(opp.liquidity_score ?? 0);

        totalOpps++;
        totalProfitSum += profit;
        totalVolumeSum += volume;
        if (isProfitable) totalProfitable++;

        // Track global max profit
        if (Math.abs(profit) > globalMaxProfit) {
          globalMaxProfit = Math.abs(profit);
        }

        exchanges.forEach(exchange => {
          if (!exchange) return;

          if (!exchangeMap.has(exchange)) {
            exchangeMap.set(exchange, {
              count: 0,
              totalProfit: 0,
              totalVolume: 0,
              profitableCount: 0,
              totalQualityScore: 0,
              maxProfit: 0
            });
          }

          const stat = exchangeMap.get(exchange)!;
          stat.count++;
          stat.totalProfit += profit;
          stat.totalVolume += volume;
          if (isProfitable) stat.profitableCount++;
          stat.totalQualityScore += qualityScore;

          // Track exchange-specific max profit
          if (Math.abs(profit) > stat.maxProfit) {
            stat.maxProfit = Math.abs(profit);
          }
        });
      });

      // Convert to array and calculate averages
      const exchangeStats: ExchangeStats[] = Array.from(exchangeMap.entries()).map(([exchange, data]) => ({
        exchange: exchange.toUpperCase(),
        totalOpportunities: data.count,
        avgProfit: data.count > 0 ? data.totalProfit / data.count : 0,
        totalVolume: data.totalVolume,
        successRate: data.count > 0 ? (data.profitableCount / data.count) * 100 : 0,
        avgQualityScore: data.count > 0 ? data.totalQualityScore / data.count : 0,
        maxProfit: data.maxProfit
      })).sort((a, b) => b.totalOpportunities - a.totalOpportunities);

      setStats(exchangeStats);
      setTotalStats({
        totalOpportunities: totalOpps,
        avgProfit: totalOpps > 0 ? totalProfitSum / totalOpps : 0,
        totalVolume: totalVolumeSum,
        successRate: totalOpps > 0 ? (totalProfitable / totalOpps) * 100 : 0,
        maxProfit: globalMaxProfit
      });
    } catch (error) {
      console.error('Error fetching statistics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;

    fetchStats();

    // Set up real-time subscription
    const channel = supabase
      .channel('stats-updates')
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'opportunities'
        },
        () => {
          fetchStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Clear data function - tries Edge Function first, falls back to direct queries
  const clearData = async (action: string, days?: number) => {
    if (!user) return;

    setClearing(true);
    try {
      // Map action names to function format
      let functionAction: string;
      switch (action) {
        case 'clear_opportunities_all':
          functionAction = 'clear_opportunities';
          break;
        case 'clear_scan_logs_all':
          functionAction = 'clear_scan_logs';
          break;
        case 'clear_all':
          functionAction = 'clear_all';
          break;
        default:
          functionAction = action;
      }

      let deletedCount = 0;
      let details: Record<string, number> = {};

      // Try using the Edge Function first
      try {
        const { invokeFunction } = await import('@/lib/functionsInvoke');
        const response = await invokeFunction('clear-user-data', {
          body: {
            action: functionAction,
            daysOld: days || clearDays
          }
        });

        if (response.error) {
          throw new Error(response.error.message || response.error || 'Function returned error');
        }

        // Handle both response formats (data wrapper or direct response)
        const result = response.data || response;
        deletedCount = result?.deletedCount || 0;
        details = result?.details || {};
      } catch (functionError: any) {
        // If function fails (not deployed or network error), fall back to direct Supabase queries
        console.warn('Function invocation failed, using direct Supabase queries:', functionError);
        
        switch (action) {
          case 'clear_opportunities_all': {
            let countQuery = supabase.from('opportunities').select('id', { count: 'exact', head: true });
            const { count } = await countQuery;
            const recordsToDelete = count || 0;

            let deleteQuery = supabase.from('opportunities').delete().neq('id', '00000000-0000-0000-0000-000000000000');
            const { error } = await deleteQuery;

            if (error) throw error;
            deletedCount = recordsToDelete;
            details.opportunities = deletedCount;
            break;
          }

          case 'clear_scan_logs_all': {
            let countQuery = supabase.from('scanner_logs').select('id', { count: 'exact', head: true });
            if (!isAdmin) {
              countQuery = countQuery.eq('user_id', user.id);
            }
            const { count } = await countQuery;
            const recordsToDelete = count || 0;

            let deleteQuery = supabase.from('scanner_logs').delete();
            if (!isAdmin) {
              deleteQuery = deleteQuery.eq('user_id', user.id);
            }
            const { error } = await deleteQuery;

            if (error) throw error;
            deletedCount = recordsToDelete;
            details.scan_logs = deletedCount;
            break;
          }

          case 'clear_all': {
            // Count opportunities
            let oppCountQuery = supabase.from('opportunities').select('id', { count: 'exact', head: true });
            const { count: oppCount } = await oppCountQuery;

            // Count logs
            let logCountQuery = supabase.from('scanner_logs').select('id', { count: 'exact', head: true });
            if (!isAdmin) logCountQuery = logCountQuery.eq('user_id', user.id);
            const { count: logCount } = await logCountQuery;

            // Delete opportunities
            let delOppQuery = supabase.from('opportunities').delete().neq('id', '00000000-0000-0000-0000-000000000000');
            const { error: oppError } = await delOppQuery;
            if (oppError) throw oppError;

            // Delete logs
            let delLogQuery = supabase.from('scanner_logs').delete();
            if (!isAdmin) delLogQuery = delLogQuery.eq('user_id', user.id);
            const { error: logError } = await delLogQuery;
            if (logError) throw logError;

            deletedCount = (oppCount || 0) + (logCount || 0);
            details.opportunities = oppCount || 0;
            details.scan_logs = logCount || 0;
            break;
          }

          default:
            throw new Error('Invalid action');
        }
      }

      // Immediately reset stats to show cleared state
      setStats([]);
      setTotalStats({
        totalOpportunities: 0,
        avgProfit: 0,
        totalVolume: 0,
        successRate: 0,
        maxProfit: 0
      });

      // Then refresh stats after clearing
      await fetchStats();

      toast({
        title: "Data Cleared",
        description: `Successfully deleted ${deletedCount} item(s). ${details.opportunities ? `Opportunities: ${details.opportunities}` : ''} ${details.scan_logs ? `Logs: ${details.scan_logs}` : ''}`,
      });
    } catch (error: any) {
      console.error('Clear data error:', error);
      let errorMessage = error.message || "Failed to clear data. Please try again.";
      
      // Provide more specific error messages
      if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError')) {
        errorMessage = "Network error: Unable to reach the server. Please check your connection or ensure the function is deployed.";
      } else if (errorMessage.includes('404') || errorMessage.includes('not found')) {
        errorMessage = "Function not found. Please ensure the clear-user-data function is deployed.";
      } else if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
        errorMessage = "Authentication failed. Please sign in again.";
      }
      
      toast({
        title: "Clear Data Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setClearing(false);
    }
  };

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {[...Array(5)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 bg-muted rounded w-24"></div>
              <div className="h-4 w-4 bg-muted rounded"></div>
            </CardHeader>
            <CardContent>
              <div className="h-8 bg-muted rounded w-32 mb-1"></div>
              <div className="h-3 bg-muted rounded w-40"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Clear Data Controls */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              Data Management
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-muted-foreground">Quick Actions:</span>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={clearing || totalStats.totalOpportunities === 0}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear Opportunities
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear All Opportunities</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete ALL opportunities ({totalStats.totalOpportunities}).
                    This action cannot be undone. Are you sure you want to continue?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => clearData('clear_opportunities_all')}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Clear All
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={clearing}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear Scan Logs
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear All Scan Logs</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all scan logs.
                    This action cannot be undone. Are you sure you want to continue?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => clearData('clear_scan_logs_all')}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Clear
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={clearing || totalStats.totalOpportunities === 0}>
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  Clear All Data
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-5 w-5" />
                    Clear All Data
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    <div className="space-y-2">
                      <p>This will permanently delete:</p>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li>All opportunities ({totalStats.totalOpportunities})</li>
                        <li>All scan logs</li>
                      </ul>
                      <p className="font-semibold text-destructive mt-2">
                        This action cannot be undone!
                      </p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => clearData('clear_all')}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Clear All
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {/* Overall Statistics - Always Visible */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card className="glass-card border-primary/10">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Opportunities</CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tighter">{totalStats.totalOpportunities}</div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Live scan depth
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-primary/10">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Success Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tighter text-green-500">{totalStats.successRate.toFixed(1)}%</div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Profitable hit rate
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-primary/10">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Avg Profit</CardTitle>
            <Zap className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tighter text-blue-500">{totalStats.avgProfit.toFixed(3)}%</div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Mean yield per loop
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-primary/10">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Max Profit</CardTitle>
            <DollarSign className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tighter text-purple-600">{totalStats.maxProfit.toFixed(3)}%</div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Peak arbitrage spread
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-primary/10 overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Market Volume</CardTitle>
            <BarChart3 className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tighter">${totalStats.totalVolume > 1000 ? (totalStats.totalVolume / 1000).toFixed(1) + 'k' : totalStats.totalVolume.toFixed(0)}</div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Total scanned liquidity
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Expandable Detailed Statistics */}
      {stats.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>Detailed Statistics</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-2"
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="h-4 w-4" />
                    Hide Details
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4" />
                    Show Details
                  </>
                )}
              </Button>
            </div>
          </CardHeader>
          {isExpanded && (
            <CardContent>
              {/* Quality Metrics */}
              <div className="mb-6 p-4 bg-muted/30 rounded-lg">
                <h3 className="font-semibold mb-3">Quality Metrics</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Premium Opportunities</p>
                    <p className="text-2xl font-bold text-purple-500">
                      {stats.filter(s => s.avgQualityScore >= 50).length}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">High Quality</p>
                    <p className="text-2xl font-bold text-blue-500">
                      {stats.filter(s => s.avgQualityScore >= 35 && s.avgQualityScore < 50).length}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Average Quality Score</p>
                    <p className="text-2xl font-bold">
                      {(stats.reduce((sum, s) => sum + (s.avgQualityScore || 0), 0) / stats.length).toFixed(0)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Exchange Statistics */}
              <div className="space-y-4">
                <h3 className="font-semibold">Statistics by Exchange</h3>
                {stats.map((stat) => (
                  <div key={stat.exchange} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{stat.exchange}</span>
                        <span className="text-xs text-muted-foreground">
                          {stat.totalOpportunities} opportunities
                        </span>
                      </div>
                      <span className="text-sm font-medium">
                        {stat.successRate.toFixed(1)}% success
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">Avg Profit</p>
                        <p className="font-medium">{stat.avgProfit.toFixed(4)}%</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Max Profit</p>
                        <p className="font-medium text-green-500">{stat.maxProfit.toFixed(4)}%</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Volume</p>
                        <p className="font-medium">${stat.totalVolume.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Opportunities</p>
                        <p className="font-medium">{stat.totalOpportunities}</p>
                      </div>
                    </div>

                    <div className="w-full bg-secondary rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all"
                        style={{ width: `${Math.min(stat.successRate, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {stats.length === 0 && !loading && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <BarChart3 className="h-12 w-12 text-muted-foreground mb-2" />
            <p className="text-muted-foreground text-center">
              No statistics available yet. Start scanning for arbitrage opportunities to see your stats!
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

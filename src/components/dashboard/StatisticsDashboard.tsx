import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, DollarSign, Activity, BarChart3 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface ExchangeStats {
  exchange: string;
  totalOpportunities: number;
  avgProfit: number;
  totalVolume: number;
  successRate: number;
  avgQualityScore: number;
}

export const StatisticsDashboard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState<ExchangeStats[]>([]);
  const [totalStats, setTotalStats] = useState({
    totalOpportunities: 0,
    avgProfit: 0,
    totalVolume: 0,
    successRate: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    
    const fetchStats = async () => {
      try {
        setLoading(true);
        
        // FIXED: Fetch ALL active opportunities (not just user's)
        // Opportunities are now shared across all users
        const { data: opportunities, error } = await supabase
          .from('arbitrage_opportunities')
          .select('*')
          .gt('expires_at', new Date().toISOString()); // Only active opportunities

        if (error) throw error;

        if (!opportunities || opportunities.length === 0) {
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
        }>();

        let totalOpps = 0;
        let totalProfitSum = 0;
        let totalVolumeSum = 0;
        let totalProfitable = 0;

        opportunities.forEach(opp => {
          const exchanges = [opp.exchange1, opp.exchange2, opp.exchange3]
            .filter((val, idx, arr) => arr.indexOf(val) === idx); // unique exchanges
          
          const profit = Number(opp.profit_percent) || 0;
          const volume = Number(opp.start_amount) || 0;
          const isProfitable = profit > 0;
          const qualityScore = Number(opp.quality_score) || 0;

          totalOpps++;
          totalProfitSum += profit;
          totalVolumeSum += volume;
          if (isProfitable) totalProfitable++;

          exchanges.forEach(exchange => {
            if (!exchange) return;
            
            if (!exchangeMap.has(exchange)) {
              exchangeMap.set(exchange, {
                count: 0,
                totalProfit: 0,
                totalVolume: 0,
                profitableCount: 0,
                totalQualityScore: 0,
              });
            }

            const stat = exchangeMap.get(exchange)!;
            stat.count++;
            stat.totalProfit += profit;
            stat.totalVolume += volume;
            if (isProfitable) stat.profitableCount++;
            stat.totalQualityScore += qualityScore;
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
        })).sort((a, b) => b.totalOpportunities - a.totalOpportunities);

        setStats(exchangeStats);
        setTotalStats({
          totalOpportunities: totalOpps,
          avgProfit: totalOpps > 0 ? totalProfitSum / totalOpps : 0,
          totalVolume: totalVolumeSum,
          successRate: totalOpps > 0 ? (totalProfitable / totalOpps) * 100 : 0
        });
      } catch (error) {
        console.error('Error fetching statistics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
    
    // Set up real-time subscription for ALL opportunities
    const channel = supabase
      .channel('stats-updates')
      .on('postgres_changes', 
        { 
          event: '*', 
          schema: 'public', 
          table: 'arbitrage_opportunities'
          // REMOVED user_id filter - we want all opportunities
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

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
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
      {/* Overall Statistics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Opportunities</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalStats.totalOpportunities}</div>
            <p className="text-xs text-muted-foreground">
              Active arbitrage opportunities
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalStats.successRate.toFixed(2)}%</div>
            <p className="text-xs text-muted-foreground">
              Profitable opportunities
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Profit</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalStats.avgProfit.toFixed(4)}%</div>
            <p className="text-xs text-muted-foreground">
              Per opportunity
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Volume</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalStats.totalVolume.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
              Scanned trading volume
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quality Metrics */}
      {stats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Quality Metrics</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      )}

      {/* Exchange Statistics */}
      {stats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Statistics by Exchange</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
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
                  
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">Avg Profit</p>
                      <p className="font-medium">{stat.avgProfit.toFixed(4)}%</p>
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

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { 
  Bug, 
  ChevronDown, 
  ChevronUp, 
  BarChart3, 
  Clock, 
  Layers, 
  TrendingUp,
  Activity,
  Zap,
  Database,
  RefreshCw
} from 'lucide-react';

interface ScanDebugData {
  tickerCounts: Record<string, number>;
  pathsEvaluated: number;
  opportunitiesFound: number;
  scanDuration: number;
  lastScanTime: Date | null;
  exchangeLatencies: Record<string, number>;
  errorsCount: number;
  lastError: string | null;
}

interface ScannerMetrics {
  totalScans: number;
  avgDuration: number;
  avgOpportunities: number;
  successRate: number;
}

export const ScannerDebugPanel = () => {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [debugData, setDebugData] = useState<ScanDebugData>({
    tickerCounts: {},
    pathsEvaluated: 0,
    opportunitiesFound: 0,
    scanDuration: 0,
    lastScanTime: null,
    exchangeLatencies: {},
    errorsCount: 0,
    lastError: null
  });
  const [metrics, setMetrics] = useState<ScannerMetrics>({
    totalScans: 0,
    avgDuration: 0,
    avgOpportunities: 0,
    successRate: 100
  });
  const [loading, setLoading] = useState(false);

  const fetchDebugData = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      // Fetch recent scanner logs for debug info
      const { data: logs, error } = await supabase
        .from('scanner_logs')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      // Parse logs to extract debug data
      let totalDuration = 0;
      let totalOpportunities = 0;
      let scanCount = 0;
      let errorCount = 0;
      let lastError: string | null = null;
      const tickerCounts: Record<string, number> = {};
      const latencies: Record<string, number[]> = {};

      for (const log of logs || []) {
        const details = log.details as any;
        
        if (log.log_type === 'scan' || log.log_type === 'scan_complete') {
          scanCount++;
          
          if (details?.duration_ms) {
            totalDuration += details.duration_ms;
          }
          
          if (details?.opportunities_count !== undefined) {
            totalOpportunities += details.opportunities_count;
          }
          
          // Extract exchange ticker counts
          if (details?.exchange_data) {
            for (const [exchange, data] of Object.entries(details.exchange_data as Record<string, any>)) {
              tickerCounts[exchange] = data?.ticker_count || 0;
              if (data?.latency_ms) {
                if (!latencies[exchange]) latencies[exchange] = [];
                latencies[exchange].push(data.latency_ms);
              }
            }
          }
          
          if (details?.ticker_counts) {
            for (const [exchange, count] of Object.entries(details.ticker_counts as Record<string, number>)) {
              tickerCounts[exchange] = count;
            }
          }
        }
        
        if (log.log_type === 'error') {
          errorCount++;
          if (!lastError) {
            lastError = log.message || details?.error || 'Unknown error';
          }
        }
      }

      // Calculate average latencies
      const avgLatencies: Record<string, number> = {};
      for (const [exchange, values] of Object.entries(latencies)) {
        avgLatencies[exchange] = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
      }

      // Get the most recent scan info
      const recentScan = logs?.find(l => l.log_type === 'scan' || l.log_type === 'scan_complete');
      const recentDetails = recentScan?.details as any;

      setDebugData({
        tickerCounts: Object.keys(tickerCounts).length > 0 ? tickerCounts : { binance: 0, bybit: 0, okx: 0 },
        pathsEvaluated: recentDetails?.paths_evaluated || recentDetails?.paths_count || 0,
        opportunitiesFound: recentDetails?.opportunities_count || 0,
        scanDuration: recentDetails?.duration_ms || 0,
        lastScanTime: recentScan ? new Date(recentScan.created_at || '') : null,
        exchangeLatencies: avgLatencies,
        errorsCount: errorCount,
        lastError
      });

      setMetrics({
        totalScans: scanCount,
        avgDuration: scanCount > 0 ? Math.round(totalDuration / scanCount) : 0,
        avgOpportunities: scanCount > 0 ? Math.round((totalOpportunities / scanCount) * 10) / 10 : 0,
        successRate: scanCount > 0 ? Math.round(((scanCount - errorCount) / scanCount) * 100) : 100
      });

    } catch (err) {
      console.error('Failed to fetch debug data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && user) {
      fetchDebugData();
    }
  }, [isOpen, user]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!user || !isOpen) return;

    const channel = supabase
      .channel('scanner-debug')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'scanner_logs',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          fetchDebugData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isOpen]);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getLatencyColor = (ms: number) => {
    if (ms < 100) return 'text-green-500';
    if (ms < 300) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="border-primary/10 bg-card/50 backdrop-blur">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/20 transition-colors pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/10">
                  <Bug className="h-5 w-5 text-purple-500" />
                </div>
                <div>
                  <CardTitle className="text-base font-bold">Scanner Debug</CardTitle>
                  <CardDescription className="text-xs">
                    Ticker counts, paths, and scan metrics
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {debugData.lastScanTime && (
                  <Badge variant="outline" className="text-[10px] hidden sm:flex">
                    Last: {debugData.lastScanTime.toLocaleTimeString()}
                  </Badge>
                )}
                {isOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="space-y-4 pt-0">
            {/* Quick Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-muted/30 border border-primary/5">
                <div className="flex items-center gap-2 mb-1">
                  <Layers className="h-3 w-3 text-blue-500" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">Paths</span>
                </div>
                <span className="text-xl font-bold">{debugData.pathsEvaluated.toLocaleString()}</span>
              </div>
              
              <div className="p-3 rounded-lg bg-muted/30 border border-primary/5">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="h-3 w-3 text-green-500" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">Opportunities</span>
                </div>
                <span className="text-xl font-bold">{debugData.opportunitiesFound}</span>
              </div>
              
              <div className="p-3 rounded-lg bg-muted/30 border border-primary/5">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="h-3 w-3 text-yellow-500" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">Duration</span>
                </div>
                <span className="text-xl font-bold">{formatDuration(debugData.scanDuration)}</span>
              </div>
              
              <div className="p-3 rounded-lg bg-muted/30 border border-primary/5">
                <div className="flex items-center gap-2 mb-1">
                  <Activity className="h-3 w-3 text-purple-500" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase">Success Rate</span>
                </div>
                <span className="text-xl font-bold">{metrics.successRate}%</span>
              </div>
            </div>

            {/* Ticker Counts by Exchange */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Tickers per Exchange
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={fetchDebugData}
                  disabled={loading}
                  className="h-6 px-2"
                >
                  <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(debugData.tickerCounts).map(([exchange, count]) => (
                  <div 
                    key={exchange}
                    className="flex items-center justify-between p-2 rounded-lg bg-muted/20 border border-primary/5"
                  >
                    <span className="text-xs font-medium capitalize">{exchange}</span>
                    <Badge variant="secondary" className="text-[10px]">{count}</Badge>
                  </div>
                ))}
              </div>
            </div>

            {/* Exchange Latencies */}
            {Object.keys(debugData.exchangeLatencies).length > 0 && (
              <div>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
                  Avg Exchange Latency
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(debugData.exchangeLatencies).map(([exchange, latency]) => (
                    <div 
                      key={exchange}
                      className="flex items-center justify-between p-2 rounded-lg bg-muted/20 border border-primary/5"
                    >
                      <span className="text-xs font-medium capitalize">{exchange}</span>
                      <span className={`text-xs font-mono ${getLatencyColor(latency)}`}>
                        {latency}ms
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Aggregate Metrics */}
            <div className="p-3 rounded-lg bg-muted/20 border border-primary/5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 block">
                Session Metrics
              </span>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-lg font-bold">{metrics.totalScans}</div>
                  <div className="text-[10px] text-muted-foreground">Total Scans</div>
                </div>
                <div>
                  <div className="text-lg font-bold">{formatDuration(metrics.avgDuration)}</div>
                  <div className="text-[10px] text-muted-foreground">Avg Duration</div>
                </div>
                <div>
                  <div className="text-lg font-bold">{metrics.avgOpportunities}</div>
                  <div className="text-[10px] text-muted-foreground">Avg Opportunities</div>
                </div>
              </div>
            </div>

            {/* Errors */}
            {debugData.errorsCount > 0 && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-red-400">Recent Errors</span>
                  <Badge variant="outline" className="text-[10px] text-red-400 border-red-400/30">
                    {debugData.errorsCount}
                  </Badge>
                </div>
                {debugData.lastError && (
                  <p className="text-xs text-red-400/80 truncate">{debugData.lastError}</p>
                )}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};

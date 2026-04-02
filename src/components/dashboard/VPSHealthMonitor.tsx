import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  Server, 
  Activity, 
  Zap, 
  Wifi, 
  WifiOff,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Database,
  Radio
} from 'lucide-react';

interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'degraded' | 'unknown';
  uptime?: string;
  lastCheck: Date;
  description: string;
  icon: React.ReactNode;
}

interface VPSMetrics {
  connected: boolean;
  services: ServiceStatus[];
  lastUpdate: Date;
  vpsUrl: string;
  lastOpportunity: string | null;
}

export const VPSHealthMonitor = () => {
  const vpsUrl = import.meta.env.VITE_FUNCTIONS_URL || 'https://16.16.143.35/functions';
  const [metrics, setMetrics] = useState<VPSMetrics>({
    connected: false,
    services: [],
    lastUpdate: new Date(),
    vpsUrl,
    lastOpportunity: null
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [directFetchFailed, setDirectFetchFailed] = useState(false);

  const checkVPSHealth = useCallback(async () => {
    setLoading(true);
    setError(null);

    let directSuccess = false;

    // 1. Try direct VPS health endpoint (works with proper domain + SSL)
    if (vpsUrl && !vpsUrl.match(/\d+\.\d+\.\d+\.\d+/)) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`${vpsUrl}/health`, {
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' }
        });
        clearTimeout(timeout);

        if (response.ok) {
          const data = await response.json();
          const services: ServiceStatus[] = [
            { name: 'API Gateway', status: data.status === 'healthy' ? 'running' : 'degraded', lastCheck: new Date(), description: 'HTTP API routing and authentication', icon: <Server className="h-4 w-4" /> },
            { name: 'Database', status: data.database === 'connected' ? 'running' : 'stopped', lastCheck: new Date(), description: 'Supabase PostgreSQL connection', icon: <Database className="h-4 w-4" /> },
            { name: 'Scanner Service', status: 'running', lastCheck: new Date(), description: 'Arbitrage opportunity detection', icon: <Radio className="h-4 w-4" /> },
            { name: 'Market Data', status: 'running', lastCheck: new Date(), description: 'WebSocket price feeds', icon: <Activity className="h-4 w-4" /> },
            { name: 'Executor', status: 'running', lastCheck: new Date(), description: 'Trade execution engine', icon: <Zap className="h-4 w-4" /> },
          ];
          setMetrics({ connected: true, services, lastUpdate: new Date(), vpsUrl, lastOpportunity: null });
          directSuccess = true;
        }
      } catch {
        // Fall through to indirect check
      }
    }

    if (directSuccess) {
      setLoading(false);
      return;
    }

    // 2. Indirect check: infer VPS health from recent Supabase data
    setDirectFetchFailed(true);
    try {
      const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      const [oppResult, metricsResult] = await Promise.all([
        supabase.from('opportunities').select('detected_at').gte('detected_at', tenMinAgo).order('detected_at', { ascending: false }).limit(1),
        supabase.from('scanner_health_metrics').select('metric_name, metric_value, created_at').gte('created_at', tenMinAgo).order('created_at', { ascending: false }).limit(5),
      ]);

      const latestOpp = oppResult.data?.[0];
      const hasRecentOpps = latestOpp && new Date(latestOpp.detected_at) > new Date(twoMinAgo);
      const hasRecentMetrics = (metricsResult.data?.length || 0) > 0;

      const scannerStatus: 'running' | 'degraded' | 'stopped' = hasRecentOpps ? 'running' : (latestOpp ? 'degraded' : 'stopped');
      const overallConnected = hasRecentOpps || hasRecentMetrics;

      const services: ServiceStatus[] = [
        { name: 'Scanner Service', status: scannerStatus, lastCheck: new Date(), description: hasRecentOpps ? `Last opportunity: ${new Date(latestOpp!.detected_at).toLocaleTimeString()}` : 'No recent opportunities detected', icon: <Radio className="h-4 w-4" /> },
        { name: 'Database Writer', status: overallConnected ? 'running' : 'stopped', lastCheck: new Date(), description: 'Supabase write pipeline', icon: <Database className="h-4 w-4" /> },
        { name: 'Market Data', status: hasRecentOpps ? 'running' : 'unknown', lastCheck: new Date(), description: 'Inferred from scanner activity', icon: <Activity className="h-4 w-4" /> },
        { name: 'Executor', status: 'unknown', lastCheck: new Date(), description: 'Cannot verify without direct VPS access', icon: <Zap className="h-4 w-4" /> },
        { name: 'API Gateway', status: 'unknown', lastCheck: new Date(), description: 'Direct health check blocked (raw IP / SSL)', icon: <Server className="h-4 w-4" /> },
      ];

      setMetrics({
        connected: overallConnected,
        services,
        lastUpdate: new Date(),
        vpsUrl,
        lastOpportunity: latestOpp ? latestOpp.detected_at : null
      });

      if (!overallConnected) {
        setError('No recent VPS activity detected in the last 10 minutes');
      } else if (!hasRecentOpps) {
        setError('Scanner may be idle — no opportunities in the last 2 minutes');
      }
    } catch (err: any) {
      setMetrics(prev => ({ ...prev, connected: false, services: getDefaultServices('unknown'), lastUpdate: new Date() }));
      setError('Failed to check VPS status via Supabase');
    } finally {
      setLoading(false);
    }
  }, [vpsUrl]);

  const getDefaultServices = (status: 'running' | 'stopped' | 'unknown'): ServiceStatus[] => [
    { name: 'API Gateway', status, lastCheck: new Date(), description: 'HTTP API routing', icon: <Server className="h-4 w-4" /> },
    { name: 'Scanner Service', status, lastCheck: new Date(), description: 'Arbitrage detection', icon: <Radio className="h-4 w-4" /> },
    { name: 'Market Data', status, lastCheck: new Date(), description: 'WebSocket feeds', icon: <Activity className="h-4 w-4" /> },
    { name: 'Executor', status, lastCheck: new Date(), description: 'Trade execution', icon: <Zap className="h-4 w-4" /> },
    { name: 'Database', status, lastCheck: new Date(), description: 'Supabase connection', icon: <Database className="h-4 w-4" /> },
  ];

  useEffect(() => {
    checkVPSHealth();
    const interval = setInterval(checkVPSHealth, 30000);
    return () => clearInterval(interval);
  }, [checkVPSHealth]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'text-green-500';
      case 'stopped': return 'text-red-500';
      case 'degraded': return 'text-yellow-500';
      default: return 'text-muted-foreground';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running': return <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30 text-[10px]">RUNNING</Badge>;
      case 'stopped': return <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/30 text-[10px]">STOPPED</Badge>;
      case 'degraded': return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/30 text-[10px]">DEGRADED</Badge>;
      default: return <Badge variant="outline" className="text-[10px]">UNKNOWN</Badge>;
    }
  };

  const runningCount = metrics.services.filter(s => s.status === 'running').length;
  const totalCount = metrics.services.length;
  const healthPercentage = totalCount > 0 ? (runningCount / totalCount) * 100 : 0;

  return (
    <Card className="border-primary/10 bg-card/50 backdrop-blur">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${metrics.connected ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
              {metrics.connected ? <Wifi className="h-5 w-5 text-green-500" /> : <WifiOff className="h-5 w-5 text-red-500" />}
            </div>
            <div>
              <CardTitle className="text-base font-bold">VPS Health Monitor</CardTitle>
              <CardDescription className="text-xs">
                {directFetchFailed ? 'Indirect mode (via Supabase data)' : metrics.vpsUrl}
              </CardDescription>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={checkVPSHealth} disabled={loading} className="h-8 w-8 p-0">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overall Status */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-primary/5">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${metrics.connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-sm font-medium">
              {metrics.connected ? 'VPS Active' : 'VPS Inactive'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{runningCount}/{totalCount} services</span>
            <div className="w-24">
              <Progress value={healthPercentage} className="h-2" />
            </div>
          </div>
        </div>

        {directFetchFailed && (
          <div className="p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
            ⚠️ Direct VPS health check unavailable (raw IP / no SSL). Status inferred from recent Supabase data.
            {vpsUrl.match(/\d+\.\d+\.\d+\.\d+/) && (
              <span className="block mt-1 text-muted-foreground">
                Tip: Set up a domain with SSL for {vpsUrl.replace(/https?:\/\//, '').replace(/\/.*/, '')} for direct monitoring.
              </span>
            )}
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Service Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <TooltipProvider>
            {metrics.services.map((service) => (
              <Tooltip key={service.name}>
                <TooltipTrigger asChild>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-primary/5 hover:border-primary/20 transition-colors cursor-default">
                    <div className="flex items-center gap-2">
                      <span className={getStatusColor(service.status)}>{service.icon}</span>
                      <span className="text-sm font-medium">{service.name}</span>
                    </div>
                    {getStatusBadge(service.status)}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[200px]">
                  <p className="text-xs">{service.description}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </TooltipProvider>
        </div>

        {/* Last Update */}
        <div className="flex items-center justify-between pt-2 border-t border-primary/5">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Last check: {metrics.lastUpdate.toLocaleTimeString()}
          </span>
          <span className="text-xs text-muted-foreground">Auto-refresh: 30s</span>
        </div>
      </CardContent>
    </Card>
  );
};

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, TrendingUp, Zap, AlertCircle, CheckCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface LiveMetrics {
    activeOpportunities: number;
    avgProfitPercent: number;
    topExchange: string;
    scanFrequency: number;
    lastUpdate: Date;
}

export const LiveMetricsPanel = () => {
    const { user } = useAuth();
    const [metrics, setMetrics] = useState<LiveMetrics>({
        activeOpportunities: 0,
        avgProfitPercent: 0,
        topExchange: 'N/A',
        scanFrequency: 0,
        lastUpdate: new Date()
    });

    useEffect(() => {
        if (!user) return;

        const fetchMetrics = async () => {
            try {
                const { data: opportunities } = await supabase
                    .from('opportunities')
                    .select('*')
                    .eq('status', 'active');

                if (opportunities && opportunities.length > 0) {
                    const avgProfit = opportunities.reduce((sum, opp) => sum + (opp.profit_percent || 0), 0) / opportunities.length;

                    // Find most common exchange
                    const exchangeCounts: Record<string, number> = {};
                    opportunities.forEach(opp => {
                        [opp.exchange1, opp.exchange2, opp.exchange3].forEach(ex => {
                            if (ex) exchangeCounts[ex] = (exchangeCounts[ex] || 0) + 1;
                        });
                    });
                    const topEx = Object.entries(exchangeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

                    setMetrics({
                        activeOpportunities: opportunities.length,
                        avgProfitPercent: avgProfit,
                        topExchange: topEx.toUpperCase(),
                        scanFrequency: 30, // 30 seconds
                        lastUpdate: new Date()
                    });
                }
            } catch (error) {
                console.error('Error fetching live metrics:', error);
            }
        };

        fetchMetrics();
        const interval = setInterval(fetchMetrics, 10000); // Update every 10s

        return () => clearInterval(interval);
    }, [user]);

    return (
        <Card className="glass-card border-primary/20 overflow-hidden relative">
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl -translate-y-16 translate-x-16" />

            <CardHeader className="border-b border-primary/5 pb-3">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                        <Activity className="h-4 w-4 text-primary animate-pulse" />
                        Live Metrics
                    </CardTitle>
                    <Badge variant="outline" className="text-[9px] border-green-500/30 text-green-500 bg-green-500/5 uppercase font-bold">
                        <CheckCircle className="h-2 w-2 mr-1" />
                        Real-time
                    </Badge>
                </div>
            </CardHeader>

            <CardContent className="pt-6">
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <TrendingUp className="h-3 w-3 text-green-500" />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-70">Hot Loops</span>
                        </div>
                        <div className="text-2xl font-black tracking-tighter tabular-nums text-primary">
                            {metrics.activeOpportunities}
                        </div>
                    </div>

                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <Zap className="h-3 w-3 text-blue-500" />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-70">Avg Yield</span>
                        </div>
                        <div className="text-2xl font-black tracking-tighter tabular-nums text-blue-500">
                            {metrics.avgProfitPercent.toFixed(3)}%
                        </div>
                    </div>

                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <Activity className="h-3 w-3 text-purple-500" />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-70">Top Node</span>
                        </div>
                        <div className="text-sm font-black tracking-tight text-purple-500">
                            {metrics.topExchange}
                        </div>
                    </div>

                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <AlertCircle className="h-3 w-3 text-orange-500" />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-70">Scan Rate</span>
                        </div>
                        <div className="text-sm font-black tracking-tight text-orange-500">
                            {metrics.scanFrequency}s
                        </div>
                    </div>
                </div>

                <div className="mt-4 pt-4 border-t border-primary/5">
                    <div className="flex items-center justify-between text-[9px] text-muted-foreground opacity-50">
                        <span className="font-mono">LAST SYNC</span>
                        <span className="font-mono">{metrics.lastUpdate.toLocaleTimeString()}</span>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

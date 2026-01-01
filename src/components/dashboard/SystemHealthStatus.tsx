
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, ShieldAlert, Zap, Clock } from 'lucide-react';

export const SystemHealthStatus = () => {
    const [metrics, setMetrics] = useState({
        scanner: { status: 'alive', lastSeen: Date.now(), latency: 45 },
        executor: { status: 'alive', lastSeen: Date.now(), latency: 12 },
        exchanges: {
            binance: { status: 'active', failures: 0 },
            bybit: { status: 'active', failures: 0 },
            okx: { status: 'active', failures: 0 }
        }
    });

    // Simulation of real-time updates
    useEffect(() => {
        const interval = setInterval(() => {
            setMetrics(prev => ({
                ...prev,
                scanner: {
                    ...prev.scanner,
                    lastSeen: Date.now(),
                    latency: 40 + Math.random() * 20
                },
                executor: {
                    ...prev.executor,
                    lastSeen: Date.now(),
                    latency: 10 + Math.random() * 5
                }
            }));
        }, 5000);
        return () => clearInterval(interval);
    }, []);

    const getStatusColor = (lastSeen: number) => {
        const diff = (Date.now() - lastSeen) / 1000;
        if (diff < 10) return 'bg-green-500';
        if (diff < 30) return 'bg-yellow-500';
        return 'bg-red-500';
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-card/50 backdrop-blur-md border-primary/20">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center justify-between">
                        Service Heartbeats
                        <Activity className="h-4 w-4 text-primary" />
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <span className="text-xs text-muted-foreground flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${getStatusColor(metrics.scanner.lastSeen)}`} />
                                Scanner Service
                            </span>
                            <Badge variant="outline" className="text-[10px]">{metrics.scanner.latency.toFixed(0)}ms</Badge>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-xs text-muted-foreground flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${getStatusColor(metrics.executor.lastSeen)}`} />
                                Executor Service
                            </span>
                            <Badge variant="outline" className="text-[10px]">{metrics.executor.latency.toFixed(0)}ms</Badge>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-card/50 backdrop-blur-md border-primary/20">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center justify-between">
                        Circuit Breakers
                        <ShieldAlert className="h-4 w-4 text-orange-500" />
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-2 flex-wrap">
                        {Object.entries(metrics.exchanges).map(([ex, data]) => (
                            <Badge key={ex} variant={data.status === 'active' ? "default" : "destructive"} className="gap-1 uppercase text-[10px]">
                                <Zap className="h-3 w-3" />
                                {ex}: {data.status}
                            </Badge>
                        ))}
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-card/50 backdrop-blur-md border-primary/20 text-primary-foreground bg-gradient-to-br from-primary/10 to-primary/5">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center justify-between text-foreground">
                        System Uptime
                        <Clock className="h-4 w-4 text-primary" />
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold tracking-tight text-foreground">
                        99.98%
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1 uppercase">Production Loop Healthy</p>
                </CardContent>
            </Card>
        </div>
    );
};

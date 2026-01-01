import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Download, RefreshCw } from 'lucide-react';

interface LogEntry {
  id: string;
  log_type: string;
  message: string;
  details: any;
  created_at: string;
}

export const ArbitrageLogPanel = () => {
  const { user } = useAuth();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const loadLogs = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('scanner_logs')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setLogs(data || []);
    } catch (error: any) {
      console.error('Error loading logs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      loadLogs();
    }
  }, [user]);

  // Set up real-time updates for logs
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('scanner-logs')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'scanner_logs',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          setLogs(current => [payload.new as LogEntry, ...current].slice(0, 50));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const downloadLogs = () => {
    const csvContent = [
      ['Timestamp', 'Type', 'Message', 'Details'],
      ...logs.map(log => [
        new Date(log.created_at).toISOString(),
        log.log_type,
        log.message,
        JSON.stringify(log.details)
      ])
    ].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arbitrage-logs-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getLogBadgeVariant = (type: string) => {
    switch (type) {
      case 'error': return 'destructive';
      case 'warning': return 'secondary';
      case 'trade': return 'default';
      default: return 'outline';
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const [isExpanded, setIsExpanded] = useState(false);
  const latestLog = logs.length > 0 ? logs[0] : null;

  return (
    <Card className="glass-card border-primary/20 bg-black/40">
      <CardHeader className="border-b border-primary/10">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <CardTitle className="text-sm font-black uppercase tracking-widest opacity-80">Real-time Terminal</CardTitle>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={loadLogs}
              disabled={loading}
              className="h-7 text-[10px] font-bold uppercase tracking-wider"
            >
              <RefreshCw className={`h-3 w-3 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Sync
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={downloadLogs}
              disabled={logs.length === 0}
              className="h-7 text-[10px] font-bold uppercase tracking-wider"
            >
              <Download className="h-3 w-3 mr-2" />
              Export
            </Button>
            {logs.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="h-7 text-[10px] font-bold uppercase tracking-wider"
              >
                {isExpanded ? 'Minimize' : `Expand (${logs.length})`}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <p className="text-center text-muted-foreground py-4">
            No logs available. Start the scanner to see activity.
          </p>
        ) : (
          <div className="space-y-2">
            {/* Latest log always visible */}
            {latestLog && (
              <div className="flex justify-between items-start p-4 bg-primary/5 rounded border border-primary/10">
                <div className="flex-1 font-mono">
                  <div className="flex items-center gap-3 mb-2">
                    <Badge variant={getLogBadgeVariant(latestLog.log_type)} className="text-[9px] font-bold h-4">
                      {latestLog.log_type.toUpperCase()}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground opacity-50">
                      [{formatTime(latestLog.created_at)}]
                    </span>
                    <span className="text-[9px] font-black text-primary px-1.5 border border-primary/30 rounded">STDOUT</span>
                  </div>
                  <p className="text-xs font-bold tracking-tight text-foreground/90">{latestLog.message}</p>
                  {latestLog.details && Object.keys(latestLog.details).length > 0 && (
                    <div className="mt-3 bg-black/40 p-3 rounded border border-white/5 text-[10px] text-primary/70 overflow-x-auto">
                      <pre>{JSON.stringify(latestLog.details, null, 2)}</pre>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Expandable older logs */}
            {isExpanded && logs.length > 1 && (
              <div className="space-y-2 max-h-60 overflow-y-auto border-t pt-2">
                <h4 className="text-sm font-medium text-muted-foreground">Previous Logs</h4>
                {logs.slice(1).map((log) => (
                  <div
                    key={log.id}
                    className="flex justify-between items-start p-2 bg-muted/50 rounded text-sm"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={getLogBadgeVariant(log.log_type)} className="text-xs">
                          {log.log_type.toUpperCase()}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatTime(log.created_at)}
                        </span>
                      </div>
                      <p className="text-xs">{log.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ArbitrageSettings } from './ArbitrageSettings';
import { ArbitrageOpportunityCard } from './ArbitrageOpportunityCard';
import { ArbitrageLogPanel } from './ArbitrageLogPanel';
import { PlansSection } from '@/components/plans/PlansSection';
import { Play, Pause, Settings, TrendingUp, Lock, Crown } from 'lucide-react';

interface Opportunity {
  id: string;
  base_symbol: string;
  quote_symbol: string;
  intermediate_symbol: string;
  exchange1: string;
  exchange2: string;
  exchange3: string;
  step1_action: string;
  step1_price: number;
  step1_amount: number;
  step2_action: string;
  step2_price: number;
  step2_amount: number;
  step3_action: string;
  step3_price: number;
  step3_amount: number;
  start_amount: number;
  end_amount: number;
  profit_amount: number;
  profit_percent: number;
  detected_at: string;
  expires_at: string;
  type?: string;
}

export const ArbitrageScanner = () => {
  const { user } = useAuth();
  const { hasActiveSubscription, subscription, loading: subscriptionLoading } = useSubscription();
  const { toast } = useToast();
  const [isScanning, setIsScanning] = useState(false);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [scanInterval, setScanInterval] = useState<NodeJS.Timeout | null>(null);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [arbitrageMode, setArbitrageMode] = useState<string[]>([]);

  // Fetch user settings on mount
  useEffect(() => {
    const fetchSettings = async () => {
      if (!user) return;

      const { data, error } = await supabase
        .from('user_settings')
        .select('arbitrage_types')
        .eq('user_id', user.id)
        .single();

      if (!error && data) {
        setArbitrageMode(data.arbitrage_types || ['triangular']);
      }
    };

    fetchSettings();
  }, [user]);

  const startScanning = useCallback(async () => {
    if (!user || !hasActiveSubscription) {
      toast({
        title: "Subscription Required",
        description: "Please subscribe to a plan to use the arbitrage scanner",
        variant: "destructive",
      });
      return;
    }

    setIsScanning(true);

    // Perform initial scan
    await performScan();

    // Set up recurring scans every 60 seconds (60000 ms)
    const interval = setInterval(async () => {
      await performScan();
    }, 60000);

    setScanInterval(interval);

    toast({
      title: "Scanner Started",
      description: "Arbitrage scanner is now monitoring opportunities",
    });
  }, [user, hasActiveSubscription]);

  const stopScanning = useCallback(() => {
    setIsScanning(false);
    if (scanInterval) {
      clearInterval(scanInterval);
      setScanInterval(null);
    }

    toast({
      title: "Scanner Stopped",
      description: "Arbitrage scanner has been stopped",
    });
  }, [scanInterval]);

  // performScan: calls the edge function, filters by threshold, saves qualifying opportunities to Supabase
  const performScan = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase.functions.invoke('arbitrage-scanner', {
        body: { action: 'scan' }
      });

      if (error) throw error;

      // scanner results (expected to be an array of opportunity objects)
      const scannerResults: any[] = (data && data.data) || [];

      // Apply threshold: only store opportunities with profit_percent >= 1%
      const threshold = 1; // percent
      const now = new Date();

      const toInsert = scannerResults
        .filter(r => typeof r.profit_percent === 'number' && r.profit_percent >= threshold)
        .map(r => ({
          // Do not assign client-side UUIDs; prefer server-provided ids.
          // Include user ownership and timestamps.
          ...r,
          user_id: user.id,
          detected_at: r.detected_at || now.toISOString(),
          expires_at: r.expires_at || new Date(now.getTime() + 60_000).toISOString(),
        }));

      if (toInsert.length > 0) {
        const { data: insertData, error: insertError } = await supabase
          .from('arbitrage_opportunities')
          .upsert(toInsert, {
            onConflict: 'user_id,exchange1,exchange2,exchange3,base_symbol,quote_symbol,intermediate_symbol,type',
            ignoreDuplicates: false
          });

        if (insertError) {
          console.error('Insert error:', insertError);
          toast({
            title: 'DB Insert Error',
            description: insertError.message || 'Failed to save opportunities',
            variant: 'destructive',
          });
        } else {
          console.log(`Saved ${toInsert.length} opportunities to DB`);
        }
      }

      // Fetch updated opportunities from database (top 10)
      const { data: freshOpportunities, error: fetchError } = await supabase
        .from('arbitrage_opportunities')
        .select('*')
        .eq('user_id', user.id)
        .gt('expires_at', new Date().toISOString())
        .order('profit_percent', { ascending: false })
        .limit(10);

      if (fetchError) throw fetchError;

      setOpportunities(freshOpportunities || []);
      setLastScanTime(new Date());
      setScanCount(prev => prev + 1);

    } catch (error: any) {
      console.error('Scan error:', error);
      toast({
        title: "Scan Error",
        description: error.message || "Failed to perform arbitrage scan",
        variant: "destructive",
      });
    }
  };

  // Set up real-time updates from Postgres for the user's opportunities
  useEffect(() => {
    if (!user) return;

    const handleOpportunityUpdate = (payload: any) => {
      const newOpportunity = payload.new as Opportunity;
      setOpportunities(prev => {
        // Remove duplicates and add new opportunity
        const filtered = prev.filter(op => op.id !== newOpportunity.id);
        return [newOpportunity, ...filtered].slice(0, 20); // Keep last 20
      });
    };

    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'arbitrage_opportunities',
        filter: `user_id=eq.${user.id}`
      }, handleOpportunityUpdate)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // WebSocket connection for real-time Binance data
  // We keep this for immediate UI updates but we no longer generate client-side UUIDs or persist directly from the socket.
  useEffect(() => {
    if (!user || !hasActiveSubscription) return;

    let ws: WebSocket | null = null;

    const connectWebSocket = () => {
      console.log('Connecting to Binance WebSocket stream...');
      ws = new WebSocket('wss://zupbliefzhnohsoguwuk.functions.supabase.co/binance-websocket');

      ws.onopen = () => {
        console.log('Connected to Binance WebSocket');
        setLastScanTime(new Date());
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'arbitrage_opportunities') {
            console.log(`Received ${data.data.length} real-time arbitrage opportunities`);

            // Map through incoming opportunities and show them temporarily in UI
            const userOpportunities = data.data.map((opp: any) => ({
              ...opp,
              user_id: user.id,
              detected_at: opp.detected_at || new Date().toISOString(),
              expires_at: opp.expires_at || new Date(Date.now() + 30000).toISOString()
            }));

            // Merge into state (UI only). DB persistence is handled by performScan (every 60s).
            setOpportunities(prev => {
              const combined = [...userOpportunities, ...prev];
              return combined.slice(0, 20); // Keep last 20
            });
          } else if (data.type === 'price_update') {
            console.log(`Received price update for ${data.data.length} BNB pairs`);
            setLastScanTime(new Date());
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket connection closed, reconnecting...');
        setTimeout(connectWebSocket, 5000);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    };

    connectWebSocket();

    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, [user, hasActiveSubscription]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scanInterval) {
        clearInterval(scanInterval);
      }
    };
  }, [scanInterval]);

  if (!user) {
    return (
      <Card className="max-w-md mx-auto">
        <CardContent className="pt-6 text-center">
          <p>Please log in to access the arbitrage scanner</p>
        </CardContent>
      </Card>
    );
  }

  // Show subscription gate if no active subscription
  if (!subscriptionLoading && !hasActiveSubscription) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Subscription Required
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center space-y-4">
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Crown className="h-4 w-4" />
                <p>Access to the Arbitrage Scanner requires an active subscription</p>
              </div>
              <div className="bg-muted/50 p-4 rounded-lg">
                <h4 className="font-semibold mb-2">Premium Features Include:</h4>
                <ul className="text-sm text-muted-foreground space-y-1 text-left max-w-md mx-auto">
                  <li>• Real-time triangular arbitrage scanning</li>
                  <li>• Multi-exchange opportunity detection</li>
                  <li>• Automated profit calculations</li>
                  <li>• Custom trading parameters</li>
                  <li>• Detailed execution logs</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        <PlansSection />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Triangular Arbitrage Scanner
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Real-time monitoring of arbitrage opportunities across multiple exchanges
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSettings(true)}
              >
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Button>

              {isScanning ? (
                <Button onClick={stopScanning} variant="destructive" size="sm">
                  <Pause className="h-4 w-4 mr-2" />
                  Stop
                </Button>
              ) : (
                <Button onClick={startScanning} size="sm">
                  <Play className="h-4 w-4 mr-2" />
                  Start
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-center text-sm text-muted-foreground">
            <div className="flex gap-4">
              <span>Status: <Badge variant={isScanning ? "default" : "secondary"}>
                {isScanning ? "Scanning" : "Stopped"}
              </Badge></span>
              <span>Scans: {scanCount}</span>
              <span>Opportunities: {opportunities.length}</span>
              <span>Mode: <Badge variant="outline">
                {arbitrageMode.length === 0 ? 'Loading...' : 
                 (() => {
                   const modes = [];
                   if (arbitrageMode.includes('triangular')) modes.push('Triangular');
                   if (arbitrageMode.includes('cross_exchange')) modes.push('Cross-Exchange');
                   if (arbitrageMode.includes('short_signal')) modes.push('Short Signal');
                   return modes.length > 0 ? modes.join(' + ') : 'None';
                 })()}
              </Badge></span>
            </div>
            {lastScanTime && (
              <span>Last update: {lastScanTime.toLocaleTimeString()}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Opportunities */}
      <div className="grid gap-4">
        {opportunities.length === 0 && isScanning && (
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="animate-pulse">
                <p>Scanning for arbitrage opportunities...</p>
              </div>
            </CardContent>
          </Card>
        )}

        {opportunities.length === 0 && !isScanning && (
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-muted-foreground">
                No opportunities found. Click "Start" to begin scanning.
              </p>
            </CardContent>
          </Card>
        )}

        {opportunities.map((opportunity, index) => (
          <ArbitrageOpportunityCard 
            key={opportunity.id} 
            opportunity={opportunity}
            rank={index + 1}
          />
        ))}
      </div>

      {/* Log Panel */}
      <ArbitrageLogPanel />

      {/* Settings Modal */}
      {showSettings && (
        <ArbitrageSettings 
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
};

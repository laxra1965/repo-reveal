import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ArbitrageSettings } from './ArbitrageSettings';
import { ArbitrageOpportunity } from './ArbitrageOpportunity';
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
    
    // Set up recurring scans every 5 seconds
    const interval = setInterval(async () => {
      await performScan();
    }, 5000);
    
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

  const performScan = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase.functions.invoke('arbitrage-scanner', {
        body: { action: 'scan' }
      });
      
      if (error) throw error;
      
      // Fetch updated opportunities from database
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

  // Set up real-time updates
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('arbitrage-updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'arbitrage_opportunities',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          setOpportunities(current => [payload.new as Opportunity, ...current].slice(0, 10));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

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
            </div>
            {lastScanTime && (
              <span>Last scan: {lastScanTime.toLocaleTimeString()}</span>
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
        
        {opportunities.map((opportunity) => (
          <ArbitrageOpportunity 
            key={opportunity.id} 
            opportunity={opportunity}
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
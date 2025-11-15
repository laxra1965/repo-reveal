import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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

// Debounce utility
function useDebounce<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<NodeJS.Timeout>();

  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      callback(...args);
    }, delay);
  }, [callback, delay]);
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
  const [isInitializing, setIsInitializing] = useState(false);

  // Use ref to prevent multiple simultaneous scans
  const isScanningRef = useRef(false);
  const mountedRef = useRef(true);

  // Fetch user settings on mount
  useEffect(() => {
    mountedRef.current = true;
    const fetchSettings = async () => {
      if (!user) return;

      const { data, error } = await supabase
        .from('user_settings')
        .select('arbitrage_types')
        .eq('user_id', user.id)
        .single();

      if (!error && data && mountedRef.current) {
        setArbitrageMode(data.arbitrage_types || ['triangular']);
      }
    };

    fetchSettings();

    return () => {
      mountedRef.current = false;
    };
  }, [user]);

  // Memoized filtered and sorted opportunities
  const sortedOpportunities = useMemo(() => {
    return [...opportunities]
      .filter(opp => new Date(opp.expires_at) > new Date())
      .sort((a, b) => Math.abs(b.profit_percent) - Math.abs(a.profit_percent))
      .slice(0, 50); // Limit to top 50
  }, [opportunities]);

  // Optimized scan function with debouncing
  const performScan = useCallback(async () => {
    if (!user || isScanningRef.current) return;

    isScanningRef.current = true;

    try {
      const { data, error } = await supabase.functions.invoke('arbitrage-scanner', {
        body: { action: 'scan' }
      });

      if (error) throw error;

      const scannerResults: any[] = (data && data.data) || [];
      const threshold = 1; // 1% minimum profit
      const now = new Date();

      const toInsert = scannerResults
        .filter(r => typeof r.profit_percent === 'number' && r.profit_percent >= threshold)
        .map(r => ({
          ...r,
          detected_at: r.detected_at || now.toISOString(),
          expires_at: r.expires_at || new Date(now.getTime() + 60_000).toISOString(),
        }));

      if (toInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('arbitrage_opportunities')
          .upsert(toInsert, {
            onConflict: 'exchange1,exchange2,exchange3,base_symbol,quote_symbol,intermediate_symbol,type',
            ignoreDuplicates: false
          });

        if (insertError) {
          console.error('Insert error:', insertError);
        }
      }

      // Fetch updated opportunities from database (top 50)
      const { data: freshOpportunities, error: fetchError } = await supabase
        .from('arbitrage_opportunities')
        .select('*')
        .gt('expires_at', new Date().toISOString())
        .order('profit_percent', { ascending: false })
        .limit(50);

      if (fetchError) throw fetchError;

      if (mountedRef.current) {
        setOpportunities(freshOpportunities || []);
        setLastScanTime(new Date());
        setScanCount(prev => prev + 1);
      }

    } catch (error: any) {
      console.error('Scan error:', error);
      if (mountedRef.current) {
        toast({
          title: "Scan Error",
          description: error.message || "Failed to perform arbitrage scan",
          variant: "destructive",
        });
      }
    } finally {
      isScanningRef.current = false;
    }
  }, [user, toast]);

  // Debounced scan to prevent rapid-fire calls
  const debouncedScan = useDebounce(performScan, 1000);

  const startScanning = useCallback(async () => {
    if (!user || !hasActiveSubscription || isInitializing) {
      toast({
        title: "Subscription Required",
        description: "Please subscribe to a plan to use the arbitrage scanner",
        variant: "destructive",
      });
      return;
    }

    setIsInitializing(true);
    setIsScanning(true);

    // Perform initial scan
    await performScan();

    // Set up recurring scans every 20 seconds
    const interval = setInterval(() => {
      performScan();
    }, 20000);

    setScanInterval(interval);
    setIsInitializing(false);

    toast({
      title: "Scanner Started",
      description: "Arbitrage scanner is now monitoring opportunities",
    });
  }, [user, hasActiveSubscription, performScan, toast, isInitializing]);

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
  }, [scanInterval, toast]);

  // Auto-start with delay to prevent race conditions
  useEffect(() => {
    if (user && hasActiveSubscription && !isScanning && !subscriptionLoading && !scanInterval && !isInitializing) {
      const timer = setTimeout(() => {
        if (mountedRef.current) {
          startScanning();
        }
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [user, hasActiveSubscription, subscriptionLoading, isScanning, scanInterval, startScanning, isInitializing]);

  // Set up real-time updates with optimized filtering
  useEffect(() => {
    if (!user) return;

    const handleOpportunityUpdate = (payload: any) => {
      const newOpportunity = payload.new as Opportunity;
      
      // Only add if not expired and meets minimum profit threshold
      if (new Date(newOpportunity.expires_at) > new Date() && 
          Math.abs(newOpportunity.profit_percent) >= 0.1) {
        
        setOpportunities(prev => {
          // Remove duplicates and add new opportunity
          const filtered = prev.filter(op => op.id !== newOpportunity.id);
          return [newOpportunity, ...filtered].slice(0, 100); // Keep max 100 in memory
        });
      }
    };

    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'arbitrage_opportunities'
      }, handleOpportunityUpdate)
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

  // Loading state
  if (!user) {
    return (
      <Card className="max-w-md mx-auto">
        <CardContent className="pt-6 text-center">
          <p>Please log in to access the arbitrage scanner</p>
        </CardContent>
      </Card>
    );
  }

  // Subscription gate
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
                <Button onClick={startScanning} size="sm" disabled={isInitializing}>
                  <Play className="h-4 w-4 mr-2" />
                  {isInitializing ? 'Starting...' : 'Start'}
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
              <span>Opportunities: {sortedOpportunities.length}</span>
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
        {sortedOpportunities.length === 0 && isScanning && (
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="animate-pulse">
                <p>Scanning for arbitrage opportunities...</p>
              </div>
            </CardContent>
          </Card>
        )}

        {sortedOpportunities.length === 0 && !isScanning && (
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-muted-foreground">
                No opportunities found. Click "Start" to begin scanning.
              </p>
            </CardContent>
          </Card>
        )}

        {sortedOpportunities.map((opportunity, index) => (
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

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
  signal_type?: 'arbitrage' | 'short' | 'none';
  arb_factor?: number;
  overpriced_leg?: string | null;
  price_deviation?: number | null;
  liquidity_score?: number;
  estimated_slippage?: number;
}

export const ArbitrageScanner = () => {
  const { user } = useAuth();
  const { hasActiveSubscription, subscription, loading: subscriptionLoading } = useSubscription();
  const { toast } = useToast();
  
  const [isScanning, setIsScanning] = useState(false);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [arbitrageMode, setArbitrageMode] = useState<string[]>([]);
  
  // Use refs to prevent stale closures
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isScanningRef = useRef(false);
  const mountedRef = useRef(true);
  
  // Debounce settings for auto-start
  const autoStartTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  // Memoized sort for opportunities
  const sortedOpportunities = useMemo(() => {
    return [...opportunities].sort((a, b) => 
      Math.abs(b.profit_percent) - Math.abs(a.profit_percent)
    );
  }, [opportunities]);

  // Optimized scan function with error handling
  const performScan = useCallback(async () => {
    if (!user || !hasActiveSubscription || !mountedRef.current) return;

    // Prevent concurrent scans
    if (isScanningRef.current) {
      console.log('Scan already in progress, skipping...');
      return;
    }

    isScanningRef.current = true;

    try {
      const { data, error } = await supabase.functions.invoke('arbitrage-scanner', {
        body: { action: 'scan' }
      });

      if (error) throw error;

      // Only update if component is still mounted
      if (!mountedRef.current) return;

      const scannerResults: any[] = (data && data.data) || [];

      // Apply client-side filtering for immediate feedback
      const threshold = 0.1; // 0.1% minimum
      const filteredResults = scannerResults.filter(r => 
        typeof r.profit_percent === 'number' && Math.abs(r.profit_percent) >= threshold
      );

      // Fetch latest from database (includes shared opportunities)
      const { data: freshOpportunities, error: fetchError } = await supabase
        .from('arbitrage_opportunities')
        .select('*')
        .gt('expires_at', new Date().toISOString())
        .order('profit_percent', { ascending: false })
        .limit(20); // Increased to 20 for better coverage

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
  }, [user, hasActiveSubscription, toast]);

  // Start scanning with proper cleanup
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

    // Initial scan
    await performScan();

    // Clear any existing interval
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
    }

    // Set up recurring scans every 20 seconds
    scanIntervalRef.current = setInterval(async () => {
      if (mountedRef.current) {
        await performScan();
      }
    }, 20000);

    toast({
      title: "Scanner Started",
      description: "Arbitrage scanner is now monitoring opportunities",
    });
  }, [user, hasActiveSubscription, performScan, toast]);

  // Stop scanning with proper cleanup
  const stopScanning = useCallback(() => {
    console.log('Stopping scanner...');
    setIsScanning(false);
    
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }

    toast({
      title: "Scanner Stopped",
      description: "Arbitrage scanner has been stopped",
    });
  }, [toast]);

  // Auto-start with debounce (delayed to prevent overwhelming server)
  useEffect(() => {
    if (user && hasActiveSubscription && !subscriptionLoading && !isScanning) {
      // Clear any pending auto-start
      if (autoStartTimeoutRef.current) {
        clearTimeout(autoStartTimeoutRef.current);
      }

      // Debounce auto-start by 2 seconds
      autoStartTimeoutRef.current = setTimeout(() => {
        if (mountedRef.current && !isScanning) {
          console.log('Auto-starting scanner...');
          startScanning();
        }
      }, 2000);
    }

    return () => {
      if (autoStartTimeoutRef.current) {
        clearTimeout(autoStartTimeoutRef.current);
      }
    };
  }, [user, hasActiveSubscription, subscriptionLoading, isScanning, startScanning]);

  // Real-time subscription for new opportunities
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('arbitrage-opportunities-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'arbitrage_opportunities'
      }, (payload) => {
        if (mountedRef.current) {
          const newOpportunity = payload.new as Opportunity;
          setOpportunities(prev => {
            // Remove duplicates and add new opportunity
            const filtered = prev.filter(op => op.id !== newOpportunity.id);
            return [newOpportunity, ...filtered]
              .sort((a, b) => Math.abs(b.profit_percent) - Math.abs(a.profit_percent))
              .slice(0, 20);
          });
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
      }
      if (autoStartTimeoutRef.current) {
        clearTimeout(autoStartTimeoutRef.current);
      }
    };
  }, []);

  // Subscription gate
  if (!user) {
    return (
      <Card className="max-w-md mx-auto">
        <CardContent className="pt-6 text-center">
          <p>Please log in to access the arbitrage scanner</p>
        </CardContent>
      </Card>
    );
  }

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

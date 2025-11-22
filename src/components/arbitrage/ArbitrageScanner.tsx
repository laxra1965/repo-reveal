import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { useTradeExecution } from '@/hooks/useTradeExecution';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ArbitrageSettings } from './ArbitrageSettings';
import { ArbitrageOpportunityCard } from './ArbitrageOpportunityCard';
import { ArbitrageLogPanel } from './ArbitrageLogPanel';
import { PlansSection } from '@/components/plans/PlansSection';
import { Play, Pause, Settings, TrendingUp, Lock, Crown, ChevronLeft, ChevronRight } from 'lucide-react';

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
  quality_score?: number;
}

const OPPORTUNITIES_PER_PAGE = 10;
const AUTO_TRADE_MIN_PROFIT = 0.5; // Extracted constant for easier adjustment

export const ArbitrageScanner = () => {
  const { user } = useAuth();
  const { hasActiveSubscription, subscription, loading: subscriptionLoading } = useSubscription();
  const { executeTrade } = useTradeExecution();
  const { toast } = useToast();
  
  const [isScanning, setIsScanning] = useState(false);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [scanInterval, setScanInterval] = useState<NodeJS.Timeout | null>(null);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [isInitializing, setIsInitializing] = useState(false);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const isScanningRef = useRef(false);
  const mountedRef = useRef(true);
  
  // OPTIMIZATION: Track processed IDs to prevent double-execution
  const processedTradeIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (scanInterval) {
        clearInterval(scanInterval);
      }
    };
  }, [scanInterval]);

  // Load auto-trade setting
  useEffect(() => {
    const loadAutoTradeSetting = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('user_settings')
        .select('auto_trade')
        .eq('user_id', user.id)
        .single();
      
      setAutoTradeEnabled(data?.auto_trade || false);
    };
    
    loadAutoTradeSetting();
  }, [user]);

  // OPTIMIZED: Auto-execute when new opportunities arrive
  useEffect(() => {
    if (!autoTradeEnabled || !opportunities.length) return;
    
    const executeTopOpportunity = async () => {
      // 1. Sort logic aligned with UI (Quality Score -> Profit)
      const topOpp = opportunities
        .filter(o => o.profit_percent > AUTO_TRADE_MIN_PROFIT)
        .sort((a, b) => {
          if (a.quality_score && b.quality_score && a.quality_score !== b.quality_score) {
            return b.quality_score - a.quality_score;
          }
          return b.profit_percent - a.profit_percent;
        })[0];
      
      // 2. SAFETY CHECK: Ensure we haven't processed this ID yet
      if (topOpp && !processedTradeIds.current.has(topOpp.id)) {
        
        // 3. Mark as processed IMMEDIATELY before await
        processedTradeIds.current.add(topOpp.id);
        
        console.log(`Auto-executing opportunity: ${topOpp.id} (${topOpp.profit_percent}% profit)`);
        
        try {
          await executeTrade(topOpp.id);
          
          toast({
            title: "Auto-Trade Triggered",
            description: `Executing ${topOpp.base_symbol} arbitrage path`,
          });
        } catch (error) {
          console.error("Auto-trade execution failed:", error);
          // Note: We do NOT remove from set on error to prevent infinite retry loops on a bad trade
        }
      }
    };
    
    executeTopOpportunity();
  }, [opportunities, autoTradeEnabled, executeTrade, toast]);

  // Load opportunities from database
  const loadOpportunitiesFromDB = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('arbitrage_opportunities')
        .select('*')
        .gt('expires_at', new Date().toISOString())
        .order('profit_percent', { ascending: false })
        .limit(100);

      if (error) throw error;

      if (data) {
        setOpportunities(data);
        setLastScanTime(new Date());
      }
    } catch (error) {
      console.error('Error loading opportunities:', error);
    }
  };

  // Initial load and real-time subscription
  useEffect(() => {
    if (user && hasActiveSubscription) {
      loadOpportunitiesFromDB();

      // Set up real-time subscription
      const channel = supabase
        .channel('arbitrage-opportunities')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'arbitrage_opportunities'
          },
          () => {
            loadOpportunitiesFromDB();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user, hasActiveSubscription]);

  // Perform scan
  const performScan = async () => {
    if (isScanningRef.current || !user) return;
    
    isScanningRef.current = true;
    
    try {
      /* 
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error('No active session');
      }

      const response = await supabase.functions.invoke('arbitrage-scanner', {
        body: { 
          action: 'scan',
          userId: user.id 
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });

      if (response.error) {
        throw response.error;
      }

      setScanCount(prev => prev + 1);
      setLastScanTime(new Date());
      
      // Load updated opportunities from database
      await loadOpportunitiesFromDB();

      toast({
        title: "Scan Complete",
        description: `Found ${response.data?.opportunities_count || 0} opportunities`,
      });
      */
    } catch (error: any) {
      console.error('Scan error:', error);
      toast({
        title: "Scan Error",
        description: error.message || "Failed to scan for opportunities",
        variant: "destructive",
      });
    } finally {
      isScanningRef.current = false;
    }
  };

  // Start scanning
  const startScanning = async () => {
    if (!user || !hasActiveSubscription) {
      toast({
        title: "Subscription Required",
        description: "Please subscribe to use the scanner",
        variant: "destructive",
      });
      return;
    }

    setIsInitializing(true);
    
    // Perform initial scan
    await performScan();
    
    setIsInitializing(false);
    setIsScanning(true);

    // Set up periodic scanning
    const interval = setInterval(performScan, 30000); // Scan every 30 seconds
    setScanInterval(interval);
  };

  // Stop scanning
  const stopScanning = () => {
    if (scanInterval) {
      clearInterval(scanInterval);
      setScanInterval(null);
    }
    setIsScanning(false);
    isScanningRef.current = false;
  };

  // Optimized sorted opportunities with pagination
  const paginatedOpportunities = useMemo(() => {
    const filtered = opportunities
      .filter(opp => new Date(opp.expires_at) > new Date())
      .sort((a, b) => {
        // Sort by quality score first (if available), then by profit
        if (a.quality_score && b.quality_score && a.quality_score !== b.quality_score) {
          return b.quality_score - a.quality_score;
        }
        return Math.abs(b.profit_percent) - Math.abs(a.profit_percent);
      });
    
    setTotalPages(Math.ceil(filtered.length / OPPORTUNITIES_PER_PAGE));
    
    const start = (currentPage - 1) * OPPORTUNITIES_PER_PAGE;
    const end = start + OPPORTUNITIES_PER_PAGE;
    
    return filtered.slice(start, end);
  }, [opportunities, currentPage]);

  // Reset to page 1 when opportunities change significantly
  useEffect(() => {
    setCurrentPage(1);
  }, [opportunities.length]);

  // Show subscription requirement if not subscribed
  if (subscriptionLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Loading subscription...</p>
      </div>
    );
  }

  if (!hasActiveSubscription) {
    return (
      <div className="space-y-6">
        <Card className="border-yellow-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Subscription Required
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              You need an active subscription to use the Arbitrage Scanner.
            </p>
            <PlansSection />
          </CardContent>
        </Card>
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
                Real-time monitoring • Showing top {OPPORTUNITIES_PER_PAGE} opportunities per page
                {autoTradeEnabled && <span className="text-green-600 font-semibold ml-2 animate-pulse">• Auto-Trade Active</span>}
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
              <span>Total: {opportunities.length}</span>
              <span>Showing: {paginatedOpportunities.length}</span>
            </div>
            {lastScanTime && (
              <span>Last update: {lastScanTime.toLocaleTimeString()}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Opportunities with Pagination */}
      <div className="space-y-4">
        {paginatedOpportunities.length === 0 && isScanning && (
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="animate-pulse">
                <p>Scanning for high-quality arbitrage opportunities...</p>
              </div>
            </CardContent>
          </Card>
        )}

        {paginatedOpportunities.length === 0 && !isScanning && (
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-muted-foreground">
                No opportunities found. Click "Start" to begin scanning.
              </p>
            </CardContent>
          </Card>
        )}

        {paginatedOpportunities.map((opportunity, index) => (
          <ArbitrageOpportunityCard 
            key={opportunity.id} 
            opportunity={opportunity}
            rank={(currentPage - 1) * OPPORTUNITIES_PER_PAGE + index + 1}
          />
        ))}

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  Previous
                </Button>
                
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Badge variant="outline">
                    {opportunities.length} total opportunities
                  </Badge>
                </div>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
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

import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { ArbitrageSettings } from './ArbitrageSettings';
import { ArbitrageOpportunityCard } from './ArbitrageOpportunityCard';

import { PaperTradeHistory } from './PaperTradeHistory';
import { PlansSection } from '@/components/plans/PlansSection';
import { Play, Pause, Settings, TrendingUp, Lock, ChevronLeft, ChevronRight, TestTube, Shield, Clock } from 'lucide-react';

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

// Memoized opportunity card to prevent unnecessary re-renders
const MemoizedOpportunityCard = memo(ArbitrageOpportunityCard);

export const ArbitrageScanner = () => {
  const { user } = useAuth();
  const { hasActiveSubscription, loading: subscriptionLoading } = useSubscription();
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const { toast } = useToast();

  const [isScanning, setIsScanning] = useState(false);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [isInitializing, setIsInitializing] = useState(false);
  const [autoPaperTrade, setAutoPaperTrade] = useState(false);
  const [autoPaperTradeCount, setAutoPaperTradeCount] = useState(0);
  const [scanDebug, setScanDebug] = useState<any[] | null>(null);
  const [activeArbTypes, setActiveArbTypes] = useState<string[]>(['triangular', 'cross_exchange']);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Track which opportunities have been auto-traded
  const autoTradedIdsRef = useRef<Set<string>>(new Set());
  const isScanningRef = useRef(false);
  const mountedRef = useRef(true);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
      }
    };
  }, []);

  // Load opportunities from database - memoized to prevent recreation
  const loadOpportunitiesFromDB = useCallback(async () => {
    if (!user || !mountedRef.current) return;

    try {
      const { data, error } = await supabase
        .from('arbitrage_opportunities')
        .select('*')
        .eq('user_id', user.id)
        .gt('expires_at', new Date().toISOString())
        .order('profit_percent', { ascending: false })
        .limit(100);

      if (error) throw error;

      if (data && mountedRef.current) {
        // Only update if data actually changed
        setOpportunities(prev => {
          const prevIds = new Set(prev.map(o => o.id));
          const newIds = new Set(data.map(o => o.id));
          const hasChanged = prev.length !== data.length ||
            data.some(o => !prevIds.has(o.id)) ||
            prev.some(o => !newIds.has(o.id));
          return hasChanged ? data : prev;
        });
        setLastScanTime(new Date());
      }
    } catch (error) {
      console.error('Error loading opportunities:', error);
    }
  }, [user]);

  const loadUserSettings = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await supabase.from('user_settings').select('arbitrage_types').eq('user_id', user.id).maybeSingle();
      if (data?.arbitrage_types) {
        setActiveArbTypes(data.arbitrage_types);
      }
    } catch (e) { }
  }, [user]);

  useEffect(() => {
    loadUserSettings();
  }, [loadUserSettings]);

  // Initial load and real-time subscription
  useEffect(() => {
    if (user && (hasActiveSubscription || isAdmin)) {
      loadOpportunitiesFromDB();

      // Set up real-time subscription with debounce
      let debounceTimer: NodeJS.Timeout;
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
            // Debounce rapid updates
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              if (mountedRef.current) {
                loadOpportunitiesFromDB();
              }
            }, 500);
          }
        )
        .subscribe();

      return () => {
        clearTimeout(debounceTimer);
        supabase.removeChannel(channel);
      };
    }
  }, [user, hasActiveSubscription, isAdmin, loadOpportunitiesFromDB]);

  // Perform scan
  const performScan = useCallback(async () => {
    if (isScanningRef.current || !user) return;

    isScanningRef.current = true;

    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        throw new Error('No active session');
      }

      // Use VPS API instead of Supabase edge functions
      const functionsUrl = import.meta.env.VITE_FUNCTIONS_URL || 'http://localhost:3001';
      const response = await fetch(`${functionsUrl}/functions/arbitrage-scanner`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          mode: 'manual',
          userId: user.id
        })
      });

      const data = await response.json();
      
      // Handle VPS API response
      const vpsResponse = {
        data,
        error: !response.ok ? { 
          status: response.status,
          statusCode: response.status,
          message: data?.error || 'Failed to scan for opportunities'
        } : null
      };

      if (vpsResponse.error) {
        console.error('VPS API returned error:', vpsResponse);
        const status = vpsResponse.error?.status || vpsResponse.error?.statusCode || 'unknown';
        
        // Parse error message from response
        let errMessage = vpsResponse.error?.message || 'Failed to scan for opportunities';

        // Provide user-friendly error messages based on status
        if (status === 404) {
          if (errMessage.includes('User settings not found') || errMessage.includes('settings')) {
            errMessage = 'User settings not found. Please configure your trading settings first.';
            // Try to create default settings
            try {
              const { error: createError } = await supabase
                .from('user_settings')
                .insert({
                  user_id: user.id,
                  enabled_exchanges: ['binance', 'bybit', 'okx'],
                  trade_amount: 10,
                  min_profit_percent: 0.1,
                  arbitrage_types: ['triangular', 'cross_exchange']
                });
              
              if (!createError) {
                toast({
                  title: "Settings Created",
                  description: "Default settings have been created. Retrying scan...",
                });
                // Retry the scan after creating settings (avoid infinite recursion)
                setTimeout(async () => {
                  if (mountedRef.current && !isScanningRef.current) {
                    isScanningRef.current = true;
                    try {
                      // Get fresh session for retry
                      const { data: { session: retrySession } } = await supabase.auth.getSession();
                      if (!retrySession) {
                        throw new Error('No active session for retry');
                      }

                      const functionsUrl = import.meta.env.VITE_FUNCTIONS_URL || 'http://localhost:3001';
                      const retryFetch = await fetch(`${functionsUrl}/functions/arbitrage-scanner`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          Authorization: `Bearer ${retrySession.access_token}`
                        },
                        body: JSON.stringify({
                          mode: 'manual',
                          userId: user.id
                        })
                      });

                      const retryData = await retryFetch.json();
                      const retryResponse = {
                        data: retryData,
                        error: !retryFetch.ok ? { status: retryFetch.status, message: retryData?.message || 'Scan failed' } : null
                      };

                      if (!retryResponse.error && mountedRef.current) {
                        setScanCount(prev => prev + 1);
                        setLastScanTime(new Date());
                        await loadOpportunitiesFromDB();
                        toast({
                          title: "Scan Complete",
                          description: `Found ${retryResponse.data?.opportunities_count || 0} opportunities`,
                        });
                      } else if (retryResponse.error && mountedRef.current) {
                        toast({
                          title: "Scan Error",
                          description: retryResponse.error.message || "Failed to scan after creating settings",
                          variant: "destructive",
                        });
                      }
                    } catch (retryError: any) {
                      console.error('Retry scan error:', retryError);
                      if (mountedRef.current) {
                        toast({
                          title: "Scan Error",
                          description: retryError.message || "Failed to retry scan",
                          variant: "destructive",
                        });
                      }
                    } finally {
                      isScanningRef.current = false;
                    }
                  }
                }, 1000);
                return;
              }
            } catch (e) {
              console.error('Failed to create default settings:', e);
            }
          } else {
            errMessage = 'Resource not found. Please try again.';
          }
        } else if (status === 401) {
          errMessage = 'Authentication failed. Please sign in again.';
        } else if (status === 403) {
          errMessage = 'Access denied. You may not have permission to perform this action.';
        } else if (status === 500) {
          errMessage = 'Server error. The scanner service may be temporarily unavailable.';
        }

        throw new Error(`${errMessage} (Status: ${status})`);
      }

      if (mountedRef.current) {
        setScanCount(prev => prev + 1);
        setLastScanTime(new Date());
        setScanDebug(vpsResponse.data?.exchange_debug || null);
      }

      // Load updated opportunities from database
      await loadOpportunitiesFromDB();

      if (mountedRef.current) {
        toast({
          title: "Scan Complete",
          description: `Found ${vpsResponse.data?.opportunities_count || 0} opportunities`,
        });
      }
    } catch (error: any) {
      console.error('Scan error:', error);
      if (mountedRef.current) {
        toast({
          title: "Scan Error",
          description: error.message || "Failed to scan for opportunities",
          variant: "destructive",
        });
      }
    } finally {
      isScanningRef.current = false;
    }
  }, [user, loadOpportunitiesFromDB, toast]);

  // Auto paper trade function
  const executeAutoPaperTrade = useCallback(async (opportunity: Opportunity) => {
    if (!user || autoTradedIdsRef.current.has(opportunity.id)) return;

    // Mark as traded to prevent duplicates
    autoTradedIdsRef.current.add(opportunity.id);

    try {
      const slippage = (Math.random() - 0.5) * 0.002;
      const simulatedProfit = opportunity.profit_amount * (1 + slippage);
      const simulatedFinalAmount = opportunity.start_amount + simulatedProfit;

      await supabase.from('trade_history').insert({
        user_id: user.id,
        opportunity_id: opportunity.id,
        base_symbol: opportunity.base_symbol,
        quote_symbol: opportunity.quote_symbol,
        intermediate_symbol: opportunity.intermediate_symbol,
        start_amount: opportunity.start_amount,
        expected_profit: opportunity.profit_amount,
        actual_profit: simulatedProfit,
        final_amount: simulatedFinalAmount,
        status: 'completed',
        total_steps: 3,
        completed_steps: 3,
        execution_details: {
          is_paper_trade: true,
          auto_executed: true,
          log: [
            { step: 1, success: true, isPaperTrade: true, orderId: `PAPER_AUTO_${Date.now()}_1`, timestamp: new Date().toISOString() },
            { step: 2, success: true, isPaperTrade: true, orderId: `PAPER_AUTO_${Date.now()}_2`, timestamp: new Date().toISOString() },
            { step: 3, success: true, isPaperTrade: true, orderId: `PAPER_AUTO_${Date.now()}_3`, timestamp: new Date().toISOString() }
          ]
        }
      });

      setAutoPaperTradeCount(prev => prev + 1);
    } catch (error) {
      console.error('Auto paper trade error:', error);
      autoTradedIdsRef.current.delete(opportunity.id); // Allow retry on error
    }
  }, [user]);

  // Auto paper trade effect - execute on new profitable opportunities
  useEffect(() => {
    if (!autoPaperTrade || !isScanning || opportunities.length === 0) return;

    // Find new opportunities that haven't been auto-traded yet
    const newOpportunities = opportunities.filter(opp =>
      !autoTradedIdsRef.current.has(opp.id) &&
      opp.profit_percent > 0 &&
      new Date(opp.expires_at) > new Date()
    );

    // Execute paper trades for top 3 new opportunities
    newOpportunities.slice(0, 3).forEach(opp => {
      executeAutoPaperTrade(opp);
    });
  }, [opportunities, autoPaperTrade, isScanning, executeAutoPaperTrade]);

  // Start scanning
  const startScanning = useCallback(async () => {
    if (!user || (!hasActiveSubscription && !isAdmin)) {
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

    if (mountedRef.current) {
      setIsInitializing(false);
      setIsScanning(true);

      // Set up periodic scanning
      scanIntervalRef.current = setInterval(performScan, 30000);
    }
  }, [user, hasActiveSubscription, toast, performScan]);

  // Stop scanning
  const stopScanning = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    setIsScanning(false);
    isScanningRef.current = false;
  }, []);

  // Filter and sort opportunities
  const filteredOpportunities = useMemo(() => {
    return opportunities
      .filter(opp =>
        new Date(opp.expires_at) > new Date() &&
        (!opp.type || activeArbTypes.includes(opp.type))
      )
      .sort((a, b) => {
        if (a.quality_score && b.quality_score && a.quality_score !== b.quality_score) {
          return b.quality_score - a.quality_score;
        }
        return b.profit_percent - a.profit_percent;
      });
  }, [opportunities, activeArbTypes]);

  // Update total pages whenever filtered opportunities change
  useEffect(() => {
    setTotalPages(Math.ceil(filteredOpportunities.length / OPPORTUNITIES_PER_PAGE));
  }, [filteredOpportunities.length]);

  // Optimized paginated results
  const paginatedOpportunities = useMemo(() => {
    const start = (currentPage - 1) * OPPORTUNITIES_PER_PAGE;
    const end = start + OPPORTUNITIES_PER_PAGE;
    return filteredOpportunities.slice(start, end);
  }, [filteredOpportunities, currentPage]);

  // Reset to page 1 when opportunities change significantly
  useEffect(() => {
    setCurrentPage(1);
  }, [opportunities.length]);

  // Show subscription requirement if not subscribed
  if (subscriptionLoading || adminLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Loading subscription...</p>
      </div>
    );
  }

  if (!hasActiveSubscription && !isAdmin) {
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
      <Card className="glass-card border-primary/20 overflow-hidden relative">
        <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
        <CardHeader className="pb-4">
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-xl font-bold flex items-center gap-2 tracking-tight">
                <TrendingUp className="h-5 w-5 text-primary" />
                Control Center
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1 font-medium opacity-70 italic">
                Real-time Arbitrage Surveillance • Cycle detection active
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSettings(true)}
                className="hover:bg-primary/10"
              >
                <Settings className="h-4 w-4 mr-2" />
                Config
              </Button>

              {isScanning ? (
                <Button onClick={stopScanning} variant="destructive" size="sm" className="shadow-lg shadow-red-500/20">
                  <Pause className="h-4 w-4 mr-2" />
                  Halt Scan
                </Button>
              ) : (
                <Button onClick={startScanning} size="sm" disabled={isInitializing} className="premium-gradient shadow-lg shadow-primary/20">
                  <Play className="h-4 w-4 mr-2" />
                  {isInitializing ? 'Booting...' : 'Initiate Scan'}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-center text-[11px] text-muted-foreground">
            <div className="flex gap-6 flex-wrap items-center">
              <div className="flex items-center gap-2 bg-muted/50 px-3 py-1.5 rounded-full border">
                <span className="font-semibold uppercase text-[9px] opacity-70">Status:</span>
                <Badge variant={isScanning ? "default" : "secondary"} className={`text-[9px] h-4 px-1.5 ${isScanning ? 'bg-green-500/80' : ''}`}>
                  {isScanning ? "Active" : "Offline"}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold uppercase text-[9px] opacity-70">Loops:</span>
                <span className="font-mono text-primary font-bold">{scanCount}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold uppercase text-[9px] opacity-70">Hot:</span>
                <span className="font-mono text-primary font-bold">{opportunities.length}</span>
              </div>
              {autoPaperTrade && (
                <div className="flex items-center gap-2 bg-purple-500/10 text-purple-500 px-3 py-1.5 rounded-full border border-purple-500/20">
                  <TestTube className="h-3 w-3" />
                  <span className="font-bold">LIVE SIM: {autoPaperTradeCount}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <Label htmlFor="auto-paper" className="text-[10px] font-bold uppercase cursor-pointer opacity-70">
                  Auto-Simulate
                </Label>
                <Switch
                  id="auto-paper"
                  checked={autoPaperTrade}
                  onCheckedChange={setAutoPaperTrade}
                  className="scale-75 data-[state=checked]:bg-purple-500"
                />
              </div>

              {/* AI Shield Badge - Visual Indicator */}
              <div className="hidden md:flex items-center">
                <Badge variant="outline" className="text-[9px] h-5 px-2 gap-1 border-primary/30 text-primary bg-primary/5 uppercase font-bold">
                  <Shield className="h-3 w-3" />
                  Secure Loop
                </Badge>
              </div>

              {lastScanTime && (
                <div className="flex items-center gap-1 opacity-70 font-mono">
                  <Clock className="h-3 w-3" />
                  {lastScanTime.toLocaleTimeString()}
                </div>
              )}
            </div>
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
              <p className="text-muted-foreground mb-4">
                No opportunities found. Click "Start" to begin scanning.
              </p>

              {/* Debug Info Display */}
              {scanDebug && (
                <div className="mt-4 text-left max-w-md mx-auto border rounded p-3 bg-card/50">
                  <p className="text-xs font-semibold mb-2 text-muted-foreground">Exchange Connectivity Status:</p>
                  <div className="grid gap-2">
                    {scanDebug.map((d: any, i: number) => (
                      <div key={i} className={`text-xs p-2 rounded flex justify-between items-center border ${d.success ? 'border-green-500/20 bg-green-500/5 text-green-600 dark:text-green-400' : 'border-red-500/20 bg-red-500/5 text-red-600 dark:text-red-400'}`}>
                        <span className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${d.success ? 'bg-green-500' : 'bg-red-500'}`}></span>
                          {d.exchange}
                        </span>
                        <span>{d.ticker_count} pairs</span>
                        {!d.success && <span className="ml-2">Err: {d.error}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {paginatedOpportunities.map((opportunity, index) => (
          <MemoizedOpportunityCard
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

      {/* Paper Trade History */}
      <PaperTradeHistory />


      {/* Settings Modal */}
      {showSettings && (
        <ArbitrageSettings
          isOpen={showSettings}
          onClose={() => {
            setShowSettings(false);
            loadUserSettings();
            loadOpportunitiesFromDB();
          }}
        />
      )}
    </div>
  );
};

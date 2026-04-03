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
  strategy: string;
  path: string;
  exchange1: string | null;
  exchange2: string | null;
  exchange3: string | null;
  pair1: string | null;
  pair2: string | null;
  pair3: string | null;
  profit_percent: number;
  liquidity_score: number;
  volume_estimate: number;
  estimated_slippage: number;
  detected_at: string;
  status: string;
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
  
  const [activeArbTypes, setActiveArbTypes] = useState<string[]>(['triangular', 'cross_exchange']);
  const [userSettings, setUserSettings] = useState<{
    min_profit_percent?: number;
    max_profit_percent?: number;
    enabled_exchanges?: string[];
    slippage_buffer?: number;
  }>({});

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Track which opportunities have been auto-traded
  const autoTradedIdsRef = useRef<Set<string>>(new Set());
  const isScanningRef = useRef(false);
  const mountedRef = useRef(true);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
      }
    };
  }, []);

  // Load opportunities from VPS API (primary) with Supabase fallback
  const loadOpportunitiesFromDB = useCallback(async () => {
    if (!user || !mountedRef.current) return;

    let vpsFetched = false;

    try {
      // Primary: fetch from VPS API
      const vpsUrl = import.meta.env.VITE_FUNCTIONS_URL || '';
      if (vpsUrl) {
        const apiBase = vpsUrl.replace(/\/functions\/?$/, '');
        const response = await fetch(
          `${apiBase}/fetch-opportunities?` + new URLSearchParams({
            limit: '100',
            sort_by: 'profit',
            order: 'desc',
          }),
          { signal: AbortSignal.timeout(8000) }
        );

        if (response.ok) {
          const result = await response.json();
          const data = result.data || result;
          if (Array.isArray(data) && data.length > 0 && mountedRef.current) {
            setOpportunities(prev => {
              const prevIds = new Set(prev.map(o => o.id));
              const newIds = new Set(data.map((o: Opportunity) => o.id));
              const hasChanged = prev.length !== data.length ||
                data.some((o: Opportunity) => !prevIds.has(o.id)) ||
                prev.some(o => !newIds.has(o.id));
              return hasChanged ? data : prev;
            });
            setLastScanTime(new Date());
            vpsFetched = true;
          }
        }
      }
    } catch (e) {
      console.warn('VPS fetch failed, falling back to Supabase:', (e as Error).message);
    }

    if (vpsFetched) return;

    try {
      // Fallback: read directly from Supabase with user-config filters
      let query = supabase
        .from('opportunities')
        .select('*')
        .eq('status', 'active')
        .order('profit_percent', { ascending: false })
        .limit(100);

      // Apply user's min profit filter at the DB level
      if (userSettings.min_profit_percent != null) {
        query = query.gte('profit_percent', userSettings.min_profit_percent);
      }
      if (userSettings.max_profit_percent != null) {
        query = query.lte('profit_percent', userSettings.max_profit_percent);
      }

      const { data, error } = await query;

      if (error) throw error;

      if (data && mountedRef.current) {
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
      console.error('Error loading opportunities from Supabase:', error);
    }
  }, [user, userSettings]);

  const loadUserSettings = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await supabase.from('user_settings').select('arbitrage_types, min_profit_percent, max_profit_percent, enabled_exchanges, slippage_buffer').eq('user_id', user.id).maybeSingle();
      if (data) {
        if (data.arbitrage_types) setActiveArbTypes(data.arbitrage_types);
        setUserSettings({
          min_profit_percent: data.min_profit_percent != null ? Number(data.min_profit_percent) : undefined,
          max_profit_percent: data.max_profit_percent != null ? Number(data.max_profit_percent) : undefined,
          enabled_exchanges: data.enabled_exchanges || undefined,
          slippage_buffer: data.slippage_buffer != null ? Number(data.slippage_buffer) : undefined,
        });
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
      let debounceTimer: ReturnType<typeof setTimeout>;
      const channel = supabase
        .channel('arbitrage-opportunities')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'opportunities'
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




  // Auto paper trade function
  const executeAutoPaperTrade = useCallback(async (opportunity: Opportunity) => {
    if (!user || autoTradedIdsRef.current.has(opportunity.id)) return;

    // Mark as traded to prevent duplicates
    autoTradedIdsRef.current.add(opportunity.id);

    try {
      const symbols = opportunity.path.split(/[→>\/\-]/).map(s => s.trim()).filter(Boolean);
      const baseSymbol = symbols[0] || 'UNKNOWN';
      const intermediateSymbol = symbols[1] || 'UNKNOWN';
      const quoteSymbol = symbols[2] || symbols[0] || 'UNKNOWN';
      const startAmount = opportunity.volume_estimate;
      const expectedProfit = startAmount * (opportunity.profit_percent / 100);

      const slippage = (Math.random() - 0.5) * 0.002;
      const simulatedProfit = expectedProfit * (1 + slippage);
      const simulatedFinalAmount = startAmount + simulatedProfit;

      await supabase.from('trade_history').insert({
        user_id: user.id,
        opportunity_id: opportunity.id,
        base_symbol: baseSymbol,
        quote_symbol: quoteSymbol,
        intermediate_symbol: intermediateSymbol,
        start_amount: startAmount,
        expected_profit: expectedProfit,
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
      opp.profit_percent > 0
    );

    // Execute paper trades for top 3 new opportunities
    newOpportunities.slice(0, 3).forEach(opp => {
      executeAutoPaperTrade(opp);
    });
  }, [opportunities, autoPaperTrade, isScanning, executeAutoPaperTrade]);

  // Start scanning - reads from DB (VPS scanner writes opportunities independently)
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

    // Load current opportunities from database
    await loadOpportunitiesFromDB();

    if (mountedRef.current) {
      setIsInitializing(false);
      setIsScanning(true);
      setScanCount(prev => prev + 1);

      toast({
        title: "Scanner Active",
        description: "Reading opportunities from VPS scanner. Updates every 20s + real-time.",
      });

      // Set up periodic polling (complements real-time subscription)
      scanIntervalRef.current = setInterval(() => {
        loadOpportunitiesFromDB();
        setScanCount(prev => prev + 1);
      }, 20000);
    }
  }, [user, hasActiveSubscription, isAdmin, toast, loadOpportunitiesFromDB]);

  // Stop scanning
  const stopScanning = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    setIsScanning(false);
    isScanningRef.current = false;
  }, []);

  // Filter and sort opportunities using user config
  const filteredOpportunities = useMemo(() => {
    return opportunities
      .filter(opp => {
        if (opp.status !== 'active') return false;
        if (opp.strategy && !activeArbTypes.includes(opp.strategy)) return false;
        
        // Apply user's min/max profit filters (client-side for VPS-fetched data)
        if (userSettings.min_profit_percent != null && opp.profit_percent < userSettings.min_profit_percent) return false;
        if (userSettings.max_profit_percent != null && opp.profit_percent > userSettings.max_profit_percent) return false;
        
        // Filter by user's enabled exchanges
        if (userSettings.enabled_exchanges?.length) {
          const oppExchanges = [opp.exchange1, opp.exchange2, opp.exchange3].filter(Boolean);
          const hasEnabledExchange = oppExchanges.some(ex => 
            userSettings.enabled_exchanges!.includes(ex!.toLowerCase())
          );
          if (!hasEnabledExchange) return false;
        }
        
        // Filter by slippage buffer
        if (userSettings.slippage_buffer != null && opp.estimated_slippage > userSettings.slippage_buffer) return false;
        
        return true;
      })
      .sort((a, b) => {
        if (a.liquidity_score !== b.liquidity_score) {
          return b.liquidity_score - a.liquidity_score;
        }
        return b.profit_percent - a.profit_percent;
      });
  }, [opportunities, activeArbTypes, userSettings]);

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

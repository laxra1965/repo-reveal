import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { ArrowRight, TrendingUp, Clock, Eye, EyeOff, Zap, AlertTriangle, Target, Loader2, TestTube } from 'lucide-react';

export interface Opportunity {
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

interface ArbitrageOpportunityCardProps {
  opportunity: Opportunity;
  rank: number;
}

export const ArbitrageOpportunityCard = ({ opportunity, rank }: ArbitrageOpportunityCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isPaperExecuting, setIsPaperExecuting] = useState(false);
  const [hasCredentials, setHasCredentials] = useState<boolean | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  const exchanges = [opportunity.exchange1, opportunity.exchange2, opportunity.exchange3].filter(Boolean) as string[];
  const pairs = [opportunity.pair1, opportunity.pair2, opportunity.pair3].filter(Boolean) as string[];

  // Check if user has credentials for required exchanges
  useEffect(() => {
    const checkCredentials = async () => {
      if (!user || exchanges.length === 0) return;

      const uniqueExchanges = [...new Set(exchanges.map(e => e.toLowerCase()))];

      const { data: credentials } = await supabase
        .from('exchange_credentials')
        .select('exchange')
        .eq('user_id', user.id);

      const hasAll = uniqueExchanges.every(ex =>
        credentials?.some(c => c.exchange === ex)
      );
      setHasCredentials(hasAll);
    };

    checkCredentials();
  }, [user, opportunity.exchange1, opportunity.exchange2, opportunity.exchange3]);

  const handleTrade = async () => {
    if (!user) {
      toast({ title: "Authentication Required", description: "Please log in to execute trades", variant: "destructive" });
      return;
    }
    if (!hasCredentials) {
      toast({ title: "API Credentials Required", description: `Please configure API keys for ${exchanges.join(', ')} in your Profile settings`, variant: "destructive" });
      return;
    }

    setIsExecuting(true);
    try {
      // Parse path for symbols (e.g. "BTC→ETH→USDT")
      const symbols = opportunity.path.split(/[→>\/\-]/).map(s => s.trim()).filter(Boolean);
      const baseSymbol = symbols[0] || 'UNKNOWN';
      const intermediateSymbol = symbols[1] || 'UNKNOWN';
      const quoteSymbol = symbols[2] || symbols[0] || 'UNKNOWN';

      // 1. Insert trade record into Supabase
      const { data: tradeEntry, error: insertError } = await supabase
        .from('trade_history')
        .insert({
          user_id: user.id,
          opportunity_id: opportunity.id,
          base_symbol: baseSymbol,
          quote_symbol: quoteSymbol,
          intermediate_symbol: intermediateSymbol,
          start_amount: opportunity.volume_estimate,
          expected_profit: opportunity.volume_estimate * (opportunity.profit_percent / 100),
          status: 'pending',
          total_steps: 3,
          completed_steps: 0
        })
        .select()
        .single();

      if (insertError) throw insertError;

      const { data: { session } } = await supabase.auth.getSession();
      const payload = {
        action: 'execute_single',
        tradeId: tradeEntry.id,
        userId: user.id,
        opportunityId: opportunity.id,
      };
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      };

      let responseData: any;

      // 2. Try VPS executor first
      const vpsUrl = import.meta.env.VITE_FUNCTIONS_URL;
      if (vpsUrl) {
        try {
          const vpsResponse = await fetch(`${vpsUrl}/functions/execute-trade`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(15000),
          });
          responseData = await vpsResponse.json();
          if (!vpsResponse.ok) throw new Error(responseData?.message || 'VPS execution failed');
        } catch (vpsErr) {
          console.warn('VPS execution failed, falling back to edge function:', (vpsErr as Error).message);
          responseData = null;
        }
      }

      // 3. Fallback to Supabase edge function
      if (!responseData) {
        const { data, error } = await supabase.functions.invoke('execute-trade', {
          body: payload,
        });
        if (error) throw error;
        responseData = data;
      }

      toast({
        title: "Trade Executed",
        description: responseData?.success
          ? `Trade completed! Profit: ${responseData.actualProfit?.toFixed(4) || 'N/A'}`
          : "Trade submitted for execution",
      });
    } catch (error: any) {
      console.error('Trade execution error:', error);
      toast({ title: "Trade Failed", description: error.message || "Failed to execute trade", variant: "destructive" });
    } finally {
      setIsExecuting(false);
    }
  };

  const handlePaperTrade = async () => {
    if (!user) {
      toast({ title: "Authentication Required", description: "Please log in to execute paper trades", variant: "destructive" });
      return;
    }

    setIsPaperExecuting(true);
    try {
      const symbols = opportunity.path.split(/[→>\/\-]/).map(s => s.trim()).filter(Boolean);
      const baseSymbol = symbols[0] || 'UNKNOWN';
      const intermediateSymbol = symbols[1] || 'UNKNOWN';
      const quoteSymbol = symbols[2] || symbols[0] || 'UNKNOWN';

      const startAmount = opportunity.volume_estimate;
      const expectedProfit = startAmount * (opportunity.profit_percent / 100);

      // 1. Insert paper trade record
      const { data: tradeEntry, error: insertError } = await supabase
        .from('trade_history')
        .insert({
          user_id: user.id,
          opportunity_id: opportunity.id,
          base_symbol: baseSymbol,
          quote_symbol: quoteSymbol,
          intermediate_symbol: intermediateSymbol,
          start_amount: startAmount,
          expected_profit: expectedProfit,
          status: 'pending',
          total_steps: 3,
          completed_steps: 0,
          execution_details: { is_paper_trade: true },
        })
        .select()
        .single();

      if (insertError) throw insertError;

      const { data: { session } } = await supabase.auth.getSession();
      const payload = {
        action: 'execute_single',
        tradeId: tradeEntry.id,
        userId: user.id,
        opportunityId: opportunity.id,
        paperTrade: true,
      };
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      };

      let responseData: any = null;
      let routedVia: 'vps' | 'edge' | 'local' = 'local';

      // 2. Try VPS executor first
      const vpsUrl = import.meta.env.VITE_FUNCTIONS_URL;
      if (vpsUrl) {
        try {
          const vpsResponse = await fetch(`${vpsUrl}/functions/execute-trade`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(15000),
          });
          responseData = await vpsResponse.json();
          if (!vpsResponse.ok) throw new Error(responseData?.message || 'VPS paper execution failed');
          routedVia = 'vps';
        } catch (vpsErr) {
          console.warn('VPS paper execution failed, falling back to edge function:', (vpsErr as Error).message);
          responseData = null;
        }
      }

      // 3. Fallback to Supabase edge function
      if (!responseData) {
        try {
          const { data, error } = await supabase.functions.invoke('execute-trade', { body: payload });
          if (error) throw error;
          responseData = data;
          routedVia = 'edge';
        } catch (edgeErr) {
          console.warn('Edge paper execution failed, falling back to local simulation:', (edgeErr as Error).message);
        }
      }

      // 4. Final fallback: local simulation (keeps UX working even with no backend)
      if (!responseData) {
        const slippage = (Math.random() - 0.5) * 0.002;
        const simulatedProfit = expectedProfit * (1 + slippage);
        const simulatedFinalAmount = startAmount + simulatedProfit;

        const { error: updateError } = await supabase
          .from('trade_history')
          .update({
            actual_profit: simulatedProfit,
            final_amount: simulatedFinalAmount,
            status: 'completed',
            completed_steps: 3,
            execution_details: {
              is_paper_trade: true,
              routed_via: 'local',
              simulated_slippage: slippage,
              log: [
                { step: 1, success: true, isPaperTrade: true, orderId: `PAPER_${Date.now()}_1`, timestamp: new Date().toISOString() },
                { step: 2, success: true, isPaperTrade: true, orderId: `PAPER_${Date.now()}_2`, timestamp: new Date().toISOString() },
                { step: 3, success: true, isPaperTrade: true, orderId: `PAPER_${Date.now()}_3`, timestamp: new Date().toISOString() }
              ],
            },
          })
          .eq('id', tradeEntry.id);
        if (updateError) throw updateError;

        responseData = { success: true, actualProfit: simulatedProfit };
      }

      toast({
        title: "Paper Trade Submitted",
        description: `Routed via ${routedVia.toUpperCase()}${
          responseData?.actualProfit != null
            ? ` · Profit: ${Number(responseData.actualProfit).toFixed(4)}`
            : ''
        }`,
      });
    } catch (error: any) {
      console.error('Paper trade error:', error);
      toast({ title: "Paper Trade Failed", description: error.message || "Failed to simulate trade", variant: "destructive" });
    } finally {
      setIsPaperExecuting(false);
    }
  };

  const formatExchange = (exchange: string) => exchange.charAt(0).toUpperCase() + exchange.slice(1);

  const getAge = () => {
    const detected = new Date(opportunity.detected_at);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - detected.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  const getRankIcon = () => {
    if (rank === 1) return <Target className="h-3 w-3" />;
    if (rank <= 3) return <TrendingUp className="h-3 w-3" />;
    return null;
  };

  // Net profit: gross - fees (3 trades × 0.1%) - estimated slippage
  const tradingFees = 0.3; // 3 legs × 0.1%
  const slippagePct = opportunity.estimated_slippage * 100;
  const netProfitPct = opportunity.profit_percent - tradingFees - slippagePct;

  // Staleness: age in seconds
  const getAgeSeconds = () => {
    return Math.floor((Date.now() - new Date(opportunity.detected_at).getTime()) / 1000);
  };
  const ageSeconds = getAgeSeconds();
  const stalenessColor = ageSeconds < 15 ? 'text-green-500' : ageSeconds < 45 ? 'text-yellow-500' : 'text-red-500';
  const stalenessBg = ageSeconds < 15 ? 'bg-green-500/10 border-green-500/20' : ageSeconds < 45 ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-red-500/10 border-red-500/20';
  const isStale = ageSeconds > 60;

  return (
    <Card className={`glass-card relative overflow-hidden transition-all duration-300 hover:shadow-2xl hover:scale-[1.01] ${isStale ? 'opacity-50' : ''} ${rank === 1 ? 'border-primary/40 ring-1 ring-primary/20' : 'border-primary/10'}`}>
      {rank === 1 && !isStale && (
        <div className="absolute top-0 right-0">
          <Badge className="rounded-none rounded-bl-lg premium-gradient text-black font-black uppercase text-[10px] tracking-tighter px-3 h-6">
            Top Signal
          </Badge>
        </div>
      )}
      {isStale && (
        <div className="absolute top-0 right-0">
          <Badge variant="destructive" className="rounded-none rounded-bl-lg uppercase text-[10px] tracking-tighter px-3 h-6">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Stale
          </Badge>
        </div>
      )}

      <CardHeader className="pb-3 border-b border-primary/5">
        <div className="flex flex-col sm:flex-row justify-between items-start gap-3">
          <div className="space-y-2 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center justify-center w-6 h-6 rounded bg-primary text-primary-foreground font-black text-[10px] shrink-0">
                {rank}
              </span>
              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]">
                <TrendingUp className="h-3 w-3 mr-1" />
                {opportunity.strategy}
              </Badge>
              {opportunity.liquidity_score > 0 && (
                <Badge variant="outline" className="border-purple-500/30 text-purple-400 bg-purple-500/5 text-[10px] uppercase font-bold px-2 h-5">
                  Liq: {opportunity.liquidity_score.toFixed(0)}
                </Badge>
              )}
            </div>

            <CardTitle className="text-lg sm:text-xl font-black tracking-tighter break-all">
              {opportunity.path}
            </CardTitle>

            <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {exchanges.map((ex, i) => (
                <div key={i} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/50 border border-primary/5">
                  <span className="text-foreground">{formatExchange(ex)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="text-left sm:text-right flex flex-row sm:flex-col items-center sm:items-end gap-2 sm:gap-1 w-full sm:w-auto">
            <div className="flex flex-col items-start sm:items-end">
              <div className={`text-2xl sm:text-3xl font-black tracking-tighter tabular-nums ${netProfitPct > 0 ? 'text-green-500' : 'text-red-500'}`}>
                {netProfitPct > 0 ? '+' : ''}{netProfitPct.toFixed(3)}%
              </div>
              <span className="text-[9px] text-muted-foreground font-mono">
                gross {opportunity.profit_percent.toFixed(3)}% − fees {tradingFees.toFixed(1)}% − slip {slippagePct.toFixed(2)}%
              </span>
            </div>
            <div className="flex items-center gap-1 ml-auto sm:ml-0">
              <span className="text-[10px] font-bold text-muted-foreground uppercase">Vol:</span>
              <span className="text-sm font-mono font-bold text-foreground">
                ${opportunity.volume_estimate.toFixed(0)}
              </span>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Quick Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-muted/50 rounded-lg">
          <div className="text-center">
            <div className="text-[11px] text-muted-foreground">Net Profit</div>
            <div className={`font-bold font-mono text-sm ${netProfitPct > 0 ? 'text-green-500' : 'text-red-500'}`}>
              {netProfitPct > 0 ? '+' : ''}{netProfitPct.toFixed(3)}%
            </div>
          </div>
          <div className="text-center">
            <div className="text-[11px] text-muted-foreground">Slippage</div>
            <div className="font-semibold font-mono text-sm">
              {slippagePct.toFixed(2)}%
            </div>
          </div>
          <div className="text-center">
            <div className="text-[11px] text-muted-foreground">Liquidity</div>
            <div className="font-semibold text-sm">
              {opportunity.liquidity_score.toFixed(1)}
            </div>
          </div>
          <div className="text-center">
            <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold ${stalenessBg} ${stalenessColor}`}>
              <Clock className="h-3 w-3" />
              {getAge()}
            </div>
          </div>
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="space-y-4 border-t pt-4">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Trade Path Details
            </h4>

            <div className="space-y-2">
              {pairs.map((pair, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-background rounded border">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">
                      {i + 1}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{pair}</div>
                      <div className="text-xs text-muted-foreground">
                        on {exchanges[i] ? formatExchange(exchanges[i]) : 'N/A'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Risk Assessment */}
            <div className="p-3 bg-muted/30 rounded border border-dashed">
              <h5 className="text-xs font-semibold mb-2 text-muted-foreground">RISK ASSESSMENT</h5>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>Strategy: <span className="font-semibold">{opportunity.strategy}</span></div>
                <div>Speed Required: <span className="font-semibold">High</span></div>
                <div>Est. Slippage: <span className="font-semibold">{(opportunity.estimated_slippage * 100).toFixed(2)}%</span></div>
                <div>Status: <span className="font-semibold text-green-500">{opportunity.status}</span></div>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-between items-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2"
          >
            {isExpanded ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {isExpanded ? 'Hide Details' : 'Show Details'}
          </Button>

          <div className="flex gap-2 items-center flex-wrap">
            {hasCredentials === false && (
              <Badge variant="outline" className="text-yellow-600 border-yellow-500">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Missing API Keys
              </Badge>
            )}
            <Button
              onClick={handlePaperTrade}
              disabled={isPaperExecuting}
              variant="outline"
              size="sm"
              className="border-yellow-500/50 text-yellow-600 hover:bg-yellow-500/10"
            >
              {isPaperExecuting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <TestTube className="h-4 w-4 mr-2" />}
              {isPaperExecuting ? 'Simulating...' : 'Paper Trade'}
            </Button>
            <Button
              onClick={handleTrade}
              disabled={isExecuting || isPaperExecuting}
              className={rank === 1
                ? "bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-black font-semibold"
                : "bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800"
              }
            >
              {isExecuting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
              {isExecuting ? 'Executing...' : rank === 1 ? 'Execute Top Trade' : 'Execute Trade'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

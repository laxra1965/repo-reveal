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
      const functionsUrl = import.meta.env.VITE_FUNCTIONS_URL || 'http://localhost:3001';
      const fetchResponse = await fetch(`${functionsUrl}/functions/execute-trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: 'execute_single', tradeId: tradeEntry.id, userId: user.id })
      });

      const responseData = await fetchResponse.json();
      if (!fetchResponse.ok) throw { message: responseData?.message || 'Trade execution failed' };

      toast({
        title: "Trade Executed",
        description: responseData?.success ? `Trade completed! Profit: ${responseData.actualProfit?.toFixed(4) || 'N/A'}` : "Trade submitted for execution",
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
      const slippage = (Math.random() - 0.5) * 0.002;
      const expectedProfit = startAmount * (opportunity.profit_percent / 100);
      const simulatedProfit = expectedProfit * (1 + slippage);
      const simulatedFinalAmount = startAmount + simulatedProfit;

      const { error: insertError } = await supabase
        .from('trade_history')
        .insert({
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
            log: [
              { step: 1, success: true, isPaperTrade: true, orderId: `PAPER_${Date.now()}_1`, timestamp: new Date().toISOString() },
              { step: 2, success: true, isPaperTrade: true, orderId: `PAPER_${Date.now()}_2`, timestamp: new Date().toISOString() },
              { step: 3, success: true, isPaperTrade: true, orderId: `PAPER_${Date.now()}_3`, timestamp: new Date().toISOString() }
            ],
            simulated_slippage: slippage
          }
        });

      if (insertError) throw insertError;

      toast({
        title: "Paper Trade Completed",
        description: `Simulated profit: $${simulatedProfit.toFixed(4)} (${opportunity.profit_percent.toFixed(4)}%)`,
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

  return (
    <Card className={`glass-card relative overflow-hidden transition-all duration-300 hover:shadow-2xl hover:scale-[1.01] ${rank === 1 ? 'border-primary/40 ring-1 ring-primary/20' : 'border-primary/10'}`}>
      {rank === 1 && (
        <div className="absolute top-0 right-0">
          <Badge className="rounded-none rounded-bl-lg premium-gradient text-black font-black uppercase text-[10px] tracking-tighter px-3 h-6">
            Top Signal
          </Badge>
        </div>
      )}

      <CardHeader className="pb-3 border-b border-primary/5">
        <div className="flex justify-between items-start gap-4">
          <div className="space-y-3 flex-1">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-6 h-6 rounded bg-primary text-primary-foreground font-black text-[10px]">
                {rank}
              </span>
              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                <TrendingUp className="h-3 w-3 mr-1" />
                {opportunity.strategy}
              </Badge>
              {opportunity.liquidity_score > 0 && (
                <Badge variant="outline" className="border-purple-500/30 text-purple-400 bg-purple-500/5 text-[10px] uppercase font-bold px-2 h-5">
                  Liq: {opportunity.liquidity_score.toFixed(0)}
                </Badge>
              )}
            </div>

            <CardTitle className="text-xl font-black tracking-tighter">
              {opportunity.path}
            </CardTitle>

            <div className="flex items-center gap-2 flex-wrap text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {exchanges.map((ex, i) => (
                <div key={i} className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-muted/50 border border-primary/5">
                  <span className="text-foreground">{formatExchange(ex)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="text-right flex flex-col items-end gap-1">
            <div className={`text-4xl font-black tracking-tighter tabular-nums ${opportunity.profit_percent > 0 ? 'text-green-500' : 'text-red-500'}`}>
              {opportunity.profit_percent > 0 ? '+' : ''}{opportunity.profit_percent.toFixed(3)}%
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Est. Volume:</span>
              <span className="text-sm font-mono font-bold text-foreground">
                ${opportunity.volume_estimate.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Quick Summary */}
        <div className="grid grid-cols-3 gap-4 p-3 bg-muted/50 rounded-lg">
          <div className="text-center">
            <div className="text-sm text-muted-foreground">Slippage Est.</div>
            <div className="font-semibold font-mono">
              {(opportunity.estimated_slippage * 100).toFixed(2)}%
            </div>
          </div>
          <div className="text-center">
            <div className="text-sm text-muted-foreground">Liquidity</div>
            <div className="font-semibold">
              {opportunity.liquidity_score.toFixed(1)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-sm text-muted-foreground flex items-center justify-center gap-1">
              <Clock className="h-3 w-3 text-muted-foreground" />
              Detected
            </div>
            <div className="font-semibold">
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

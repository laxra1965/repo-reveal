import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { ArrowRight, TrendingUp, TrendingDown, Clock, Eye, EyeOff, Zap, AlertTriangle, Target, AlertCircle, Loader2, TestTube } from 'lucide-react';

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
  quality_score?: number; // Added for the quality score badge
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

  // Check if user has credentials for required exchanges
  useEffect(() => {
    const checkCredentials = async () => {
      if (!user) return;

      const requiredExchanges = [
        opportunity.exchange1.toLowerCase(),
        opportunity.exchange2.toLowerCase(),
        opportunity.exchange3.toLowerCase()
      ];
      const uniqueExchanges = [...new Set(requiredExchanges)];

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
      toast({
        title: "Authentication Required",
        description: "Please log in to execute trades",
        variant: "destructive",
      });
      return;
    }

    if (!hasCredentials) {
      toast({
        title: "API Credentials Required",
        description: `Please configure API keys for ${opportunity.exchange1}, ${opportunity.exchange2}, ${opportunity.exchange3} in your Profile settings`,
        variant: "destructive",
      });
      return;
    }

    setIsExecuting(true);

    try {
      // Create trade history entry
      const { data: tradeEntry, error: insertError } = await supabase
        .from('trade_history')
        .insert({
          user_id: user.id,
          opportunity_id: opportunity.id,
          base_symbol: opportunity.base_symbol,
          quote_symbol: opportunity.quote_symbol,
          intermediate_symbol: opportunity.intermediate_symbol,
          start_amount: opportunity.start_amount,
          expected_profit: opportunity.profit_amount,
          status: 'pending',
          total_steps: 3,
          completed_steps: 0
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Call execute-trade edge function
      const { data: { session } } = await supabase.auth.getSession();

      const response = await supabase.functions.invoke('execute-trade', {
        body: {
          action: 'execute_single',
          tradeId: tradeEntry.id,
          userId: user.id
        },
        headers: {
          Authorization: `Bearer ${session?.access_token}`
        }
      });

      if (response.error) throw response.error;

      toast({
        title: "Trade Executed",
        description: response.data?.success
          ? `Trade completed! Profit: ${response.data.actualProfit?.toFixed(4) || 'N/A'}`
          : "Trade submitted for execution",
      });
    } catch (error: any) {
      console.error('Trade execution error:', error);
      toast({
        title: "Trade Failed",
        description: error.message || "Failed to execute trade",
        variant: "destructive",
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const handlePaperTrade = async () => {
    if (!user) {
      toast({
        title: "Authentication Required",
        description: "Please log in to execute paper trades",
        variant: "destructive",
      });
      return;
    }

    setIsPaperExecuting(true);

    try {
      // Simulate paper trade with realistic results
      const slippage = (Math.random() - 0.5) * 0.002; // +/- 0.1% slippage simulation
      const simulatedProfit = opportunity.profit_amount * (1 + slippage);
      const simulatedFinalAmount = opportunity.start_amount + simulatedProfit;

      // Create paper trade history entry
      const { error: insertError } = await supabase
        .from('trade_history')
        .insert({
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
            log: [
              { step: 1, success: true, isPaperTrade: true, orderId: `PAPER_${Date.now()}_1`, filledQty: opportunity.step1_amount, timestamp: new Date().toISOString() },
              { step: 2, success: true, isPaperTrade: true, orderId: `PAPER_${Date.now()}_2`, filledQty: opportunity.step2_amount, timestamp: new Date().toISOString() },
              { step: 3, success: true, isPaperTrade: true, orderId: `PAPER_${Date.now()}_3`, filledQty: opportunity.step3_amount, timestamp: new Date().toISOString() }
            ],
            simulated_slippage: slippage
          }
        });

      if (insertError) throw insertError;

      toast({
        title: "Paper Trade Completed",
        description: `Simulated profit: $${simulatedProfit.toFixed(4)} (${((simulatedProfit / opportunity.start_amount) * 100).toFixed(4)}%)`,
      });
    } catch (error: any) {
      console.error('Paper trade error:', error);
      toast({
        title: "Paper Trade Failed",
        description: error.message || "Failed to simulate trade",
        variant: "destructive",
      });
    } finally {
      setIsPaperExecuting(false);
    }
  };

  const formatExchange = (exchange: string) => {
    return exchange.charAt(0).toUpperCase() + exchange.slice(1);
  };

  const getTimeLeft = () => {
    const expiresAt = new Date(opportunity.expires_at);
    const now = new Date();
    const timeLeft = Math.max(0, expiresAt.getTime() - now.getTime());
    return Math.floor(timeLeft / 1000);
  };

  const formatCurrency = (amount: number, decimals = 8) => {
    return amount.toFixed(decimals);
  };

  const getProfitColorClass = () => {
    if (opportunity.profit_percent > 1) return 'text-green-400';
    if (opportunity.profit_percent > 0.5) return 'text-green-500';
    if (opportunity.profit_percent > 0.1) return 'text-green-600';
    return 'text-green-700';
  };

  const getRankBadgeVariant = () => {
    if (rank === 1) return 'default';
    if (rank <= 3) return 'secondary';
    return 'outline';
  };

  const getRankIcon = () => {
    if (rank === 1) return <Target className="h-3 w-3" />;
    if (rank <= 3) return <TrendingUp className="h-3 w-3" />;
    return null;
  };

  const getUrgencyIndicator = () => {
    const timeLeft = getTimeLeft();
    if (timeLeft < 10) return <AlertTriangle className="h-4 w-4 text-red-500 animate-pulse" />;
    if (timeLeft < 30) return <Clock className="h-4 w-4 text-yellow-500" />;
    return <Clock className="h-4 w-4 text-muted-foreground" />;
  };

  const signalType = opportunity.signal_type || 'arbitrage';
  const arbFactor = opportunity.arb_factor || (opportunity.end_amount / opportunity.start_amount);

  const getSignalBadge = () => {
    if (signalType === 'arbitrage') {
      return (
        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
          <TrendingUp className="h-3 w-3 mr-1" />
          Arb Opportunity
        </Badge>
      );
    } else if (signalType === 'short') {
      return (
        <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
          <TrendingDown className="h-3 w-3 mr-1" />
          Short Signal
        </Badge>
      );
    } else {
      return (
        <Badge variant="secondary">
          <AlertCircle className="h-3 w-3 mr-1" />
          No Opportunity
        </Badge>
      );
    }
  };

  return (
    <Card className={`border-l-4 ${rank === 1 ? 'border-l-yellow-500 bg-gradient-to-r from-yellow-50/30 to-transparent dark:from-yellow-900/10' : rank <= 3 ? 'border-l-green-500' : 'border-l-primary'} transition-all duration-300 hover:shadow-lg`}>
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <div className="flex-1">
            {/* Rank and Title */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Badge variant={getRankBadgeVariant()} className="flex items-center gap-1">
                {getRankIcon()}
                #{rank}
              </Badge>
              {rank === 1 && <Badge variant="default" className="bg-yellow-500 text-black">TOP</Badge>}
              {getSignalBadge()}

              {/* Quality Score Badge */}
              {opportunity.quality_score && opportunity.quality_score >= 50 && (
                <Badge variant="default" className="bg-purple-500 text-white">
                  ⭐ Premium Quality
                </Badge>
              )}
              {opportunity.quality_score && opportunity.quality_score >= 35 && opportunity.quality_score < 50 && (
                <Badge variant="outline" className="text-purple-600 border-purple-300">
                  ✨ High Quality
                </Badge>
              )}
            </div>

            <CardTitle className="text-lg flex items-center gap-2">
              <span className="font-mono text-base">
                {opportunity.base_symbol} → {opportunity.intermediate_symbol} → {opportunity.quote_symbol}
              </span>
              <Badge variant="outline" className="text-xs font-normal">
                {opportunity.type === 'cross_exchange' ? 'Cross-Exchange Arbitrage' : 'Triangular Arbitrage'}
              </Badge>
            </CardTitle>

            {/* Clear Trading Path */}
            <div className="mt-2 p-2 bg-muted/30 rounded text-sm">
              <div className="font-medium text-muted-foreground mb-1">Trading Path:</div>
              <div className="font-mono text-sm">
                1. {opportunity.base_symbol} → {opportunity.intermediate_symbol} ({opportunity.step1_action})
              </div>
              <div className="font-mono text-sm">
                2. {opportunity.intermediate_symbol} → {opportunity.quote_symbol} ({opportunity.step2_action})
              </div>
              <div className="font-mono text-sm">
                3. {opportunity.quote_symbol} → {opportunity.base_symbol} ({opportunity.step3_action})
              </div>
            </div>

            {/* Exchange Path */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant="outline" className="text-xs">
                {formatExchange(opportunity.exchange1)}
              </Badge>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <Badge variant="outline" className="text-xs">
                {formatExchange(opportunity.exchange2)}
              </Badge>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <Badge variant="outline" className="text-xs">
                {formatExchange(opportunity.exchange3)}
              </Badge>
              {opportunity.profit_percent > 1 && (
                <Badge variant="destructive" className="ml-2 animate-pulse">
                  HIGH PROFIT
                </Badge>
              )}
            </div>
          </div>

          {/* Profit Display */}
          <div className="text-right">
            <div className={`text-2xl font-bold ${opportunity.profit_percent > 0 ? 'text-green-500' : 'text-red-500'
              }`}>
              {opportunity.profit_percent > 0 ? '+' : ''}{opportunity.profit_percent.toFixed(4)}%
            </div>
            <div className="text-sm text-muted-foreground">
              {opportunity.profit_percent > 0 ? '+' : ''}{formatCurrency(opportunity.profit_amount, 4)} {opportunity.quote_symbol}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              ${Math.abs(opportunity.profit_amount * opportunity.start_amount).toFixed(2)} est.
            </div>
            {opportunity.profit_percent < 0 && (
              <Badge variant="destructive" className="mt-1 text-xs">
                NEGATIVE SPREAD
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Quick Summary */}
        <div className="grid grid-cols-3 gap-4 p-3 bg-muted/50 rounded-lg">
          <div className="text-center">
            <div className="text-sm text-muted-foreground">Arb Factor</div>
            <div className="font-semibold font-mono">
              {arbFactor.toFixed(6)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-sm text-muted-foreground">Start → End</div>
            <div className="font-semibold">
              {formatCurrency(opportunity.start_amount, 2)} → {formatCurrency(opportunity.end_amount, 2)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-sm text-muted-foreground flex items-center justify-center gap-1">
              {getUrgencyIndicator()}
              Expires
            </div>
            <div className="font-semibold">
              {getTimeLeft()}s
            </div>
          </div>
        </div>

        {/* Short Signal Details */}
        {signalType === 'short' && opportunity.overpriced_leg && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-semibold text-red-400 mb-1">Overpriced Asset Detected</div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-mono font-medium text-foreground">{opportunity.overpriced_leg}</span>
                  {opportunity.price_deviation && (
                    <span className="ml-2 text-red-400 font-semibold">
                      +{opportunity.price_deviation.toFixed(2)}% deviation from fair value
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Consider shorting this asset as it's trading above its implied fair value in this cycle.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Expanded Details */}
        {isExpanded && (
          <div className="space-y-4 border-t pt-4">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Execution Steps
            </h4>

            <div className="space-y-3">
              {/* Step 1 */}
              <div className="flex items-center justify-between p-3 bg-background rounded border">
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">
                    1
                  </div>
                  <div>
                    <Badge variant={opportunity.step1_action === 'BUY' ? 'default' : 'destructive'} className="mb-1">
                      {opportunity.step1_action}
                    </Badge>
                    <div className="text-sm">
                      {opportunity.base_symbol}/{opportunity.intermediate_symbol}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      on {formatExchange(opportunity.exchange1)}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm">
                    @ {formatCurrency(opportunity.step1_price, 8)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatCurrency(opportunity.step1_amount, 4)} {opportunity.intermediate_symbol}
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex items-center justify-between p-3 bg-background rounded border">
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">
                    2
                  </div>
                  <div>
                    <Badge variant={opportunity.step2_action === 'BUY' ? 'default' : 'destructive'} className="mb-1">
                      {opportunity.step2_action}
                    </Badge>
                    <div className="text-sm">
                      {opportunity.intermediate_symbol}/{opportunity.quote_symbol}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      on {formatExchange(opportunity.exchange2)}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm">
                    @ {formatCurrency(opportunity.step2_price, 8)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatCurrency(opportunity.step2_amount, 4)} {opportunity.quote_symbol}
                  </div>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex items-center justify-between p-3 bg-background rounded border">
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">
                    3
                  </div>
                  <div>
                    <Badge variant={opportunity.step3_action === 'BUY' ? 'default' : 'destructive'} className="mb-1">
                      {opportunity.step3_action}
                    </Badge>
                    <div className="text-sm">
                      {opportunity.base_symbol}/{opportunity.quote_symbol}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      on {formatExchange(opportunity.exchange3)}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm">
                    @ {formatCurrency(opportunity.step3_price, 8)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatCurrency(opportunity.step3_amount, 4)} {opportunity.base_symbol}
                  </div>
                </div>
              </div>
            </div>

            {/* Risk Assessment */}
            <div className="p-3 bg-muted/30 rounded border border-dashed">
              <h5 className="text-xs font-semibold mb-2 text-muted-foreground">RISK ASSESSMENT</h5>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>Complexity: <span className="font-semibold">{opportunity.quality_score && opportunity.quality_score > 70 ? 'Low' : opportunity.quality_score && opportunity.quality_score > 40 ? 'Medium' : 'High'}</span></div>
                <div>Speed Required: <span className="font-semibold">High</span></div>
                <div>Market Impact: <span className="font-semibold">{opportunity.start_amount > 1000 ? 'Medium' : 'Low'}</span></div>
                <div>Success Rate: <span className="font-semibold text-green-500">~{opportunity.quality_score ? Math.min(99, Math.round(opportunity.quality_score * 0.9 + 10)) : 75}%</span></div>
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
            {/* Paper Trade Button */}
            <Button
              onClick={handlePaperTrade}
              disabled={isPaperExecuting}
              variant="outline"
              size="sm"
              className="border-yellow-500/50 text-yellow-600 hover:bg-yellow-500/10"
            >
              {isPaperExecuting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <TestTube className="h-4 w-4 mr-2" />
              )}
              {isPaperExecuting ? 'Simulating...' : 'Paper Trade'}
            </Button>
            {/* Live Trade Buttons */}
            {rank === 1 && (
              <Button
                onClick={handleTrade}
                disabled={isExecuting || isPaperExecuting}
                className="bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-black font-semibold"
              >
                {isExecuting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4 mr-2" />
                )}
                {isExecuting ? 'Executing...' : 'Execute Top Trade'}
              </Button>
            )}
            {rank !== 1 && (
              <Button
                onClick={handleTrade}
                disabled={isExecuting || isPaperExecuting}
                className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800"
              >
                {isExecuting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                {isExecuting ? 'Executing...' : 'Execute Trade'}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

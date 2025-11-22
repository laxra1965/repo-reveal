import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js'; // Ensure you have this installed
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ArrowRight, TrendingUp, TrendingDown, Clock, Eye, EyeOff, Zap, AlertTriangle, Target, AlertCircle, Loader2 } from 'lucide-react';

// Initialize Supabase Client (Best practice: move this to a utils file)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

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
  quality_score?: number;
  user_id: string; // Added to interface
}

interface ArbitrageOpportunityCardProps {
  opportunity: Opportunity;
  rank: number;
}

export const ArbitrageOpportunityCard = ({ opportunity, rank }: ArbitrageOpportunityCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [executing, setExecuting] = useState(false);
  const { toast } = useToast();

  // --- FIX 1: Timer Logic ---
  const calculateTimeLeft = () => {
    const expiresAt = new Date(opportunity.expires_at);
    const now = new Date();
    const diff = Math.max(0, expiresAt.getTime() - now.getTime());
    return Math.floor(diff / 1000);
  };

  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft());

  useEffect(() => {
    setTimeLeft(calculateTimeLeft());
    const timer = setInterval(() => {
      const remaining = calculateTimeLeft();
      setTimeLeft(remaining);
      if (remaining <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [opportunity.expires_at]);

  // --- FIX 2: Merged Execution Logic ---
  const handleTrade = async () => {
    if (timeLeft <= 0) {
      toast({
        title: "Opportunity Expired",
        description: "This arbitrage opportunity is no longer valid.",
        variant: "destructive",
      });
      return;
    }

    setExecuting(true);

    try {
      // Calls the Edge Function (Part 2)
      const { data, error } = await supabase.functions.invoke('execute-trade', {
        body: { opportunityId: opportunity.id },
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Unknown execution error');
      }

      toast({
        title: "Trade Executed Successfully",
        description: `Profit secured: ${data.profit} ${opportunity.quote_symbol}`,
        variant: "default",
        className: "bg-green-600 text-white",
      });
      
    } catch (error: any) {
      console.error('Trade Execution Error:', error);
      toast({
        title: "Execution Failed",
        description: error.message || "Failed to connect to trading engine.",
        variant: "destructive",
      });
    } finally {
      setExecuting(false);
    }
  };

  // --- FIX 3: Dynamic Risk Calculation ---
  const riskMetrics = useMemo(() => {
    const isCrossExchange = opportunity.type === 'cross_exchange' || 
                           (opportunity.exchange1 !== opportunity.exchange2) || 
                           (opportunity.exchange2 !== opportunity.exchange3);
    const highProfit = opportunity.profit_percent > 1.5;

    return {
      complexity: isCrossExchange ? 'High' : 'Medium',
      speedRequired: highProfit ? 'Critical' : 'High',
      marketImpact: opportunity.start_amount > 1000 ? 'Medium' : 'Low',
      successRate: isCrossExchange ? '~65%' : '~85%',
      complexityColor: isCrossExchange ? 'text-orange-500' : 'text-blue-500'
    };
  }, [opportunity]);

  const formatExchange = (exchange: string) => exchange.charAt(0).toUpperCase() + exchange.slice(1);
  const formatCurrency = (amount: number, decimals = 8) => amount.toFixed(decimals);

  const getRankBadgeVariant = () => {
    if (rank === 1) return 'default';
    if (rank <= 3) return 'secondary';
    return 'outline';
  };

  const getUrgencyIndicator = () => {
    if (timeLeft < 10) return <AlertTriangle className="h-4 w-4 text-red-500 animate-pulse" />;
    if (timeLeft < 30) return <Clock className="h-4 w-4 text-yellow-500" />;
    return <Clock className="h-4 w-4 text-muted-foreground" />;
  };

  const arbFactor = opportunity.arb_factor || 
    (opportunity.start_amount > 0 ? opportunity.end_amount / opportunity.start_amount : 0);

  return (
    <Card className={`border-l-4 ${rank === 1 ? 'border-l-yellow-500 bg-gradient-to-r from-yellow-50/30 to-transparent dark:from-yellow-900/10' : rank <= 3 ? 'border-l-green-500' : 'border-l-primary'} transition-all duration-300 hover:shadow-lg`}>
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Badge variant={getRankBadgeVariant()} className="flex items-center gap-1">
                {rank === 1 && <Target className="h-3 w-3" />}
                {rank <= 3 && rank !== 1 && <TrendingUp className="h-3 w-3" />}
                #{rank}
              </Badge>
              {rank === 1 && <Badge variant="default" className="bg-yellow-500 text-black">TOP</Badge>}
              {opportunity.signal_type === 'short' && (
                <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                  <TrendingDown className="h-3 w-3 mr-1" /> Short
                </Badge>
              )}
              {opportunity.quality_score && opportunity.quality_score >= 50 && (
                 <Badge variant="default" className="bg-purple-500 text-white">⭐ Premium</Badge>
              )}
            </div>
            
            <CardTitle className="text-lg flex items-center gap-2">
              <span className="font-mono text-base">
                {opportunity.base_symbol} → {opportunity.intermediate_symbol} → {opportunity.quote_symbol}
              </span>
            </CardTitle>
            
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant="outline" className="text-xs">{formatExchange(opportunity.exchange1)}</Badge>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <Badge variant="outline" className="text-xs">{formatExchange(opportunity.exchange2)}</Badge>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <Badge variant="outline" className="text-xs">{formatExchange(opportunity.exchange3)}</Badge>
            </div>
          </div>
          
          <div className="text-right">
            <div className={`text-2xl font-bold ${opportunity.profit_percent > 0 ? 'text-green-500' : 'text-red-500'}`}>
              {opportunity.profit_percent > 0 ? '+' : ''}{opportunity.profit_percent.toFixed(4)}%
            </div>
            <div className="text-sm text-muted-foreground">
              est. ${Math.abs(opportunity.profit_amount * opportunity.start_amount).toFixed(2)}
            </div>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4 p-3 bg-muted/50 rounded-lg">
          <div className="text-center">
            <div className="text-sm text-muted-foreground">Arb Factor</div>
            <div className="font-semibold font-mono">{arbFactor.toFixed(6)}</div>
          </div>
          <div className="text-center">
            <div className="text-sm text-muted-foreground">Volume</div>
            <div className="font-semibold">{formatCurrency(opportunity.start_amount, 2)}</div>
          </div>
          <div className="text-center">
            <div className="text-sm text-muted-foreground flex items-center justify-center gap-1">
              {getUrgencyIndicator()} Expires
            </div>
            <div className={`font-semibold ${timeLeft < 10 ? 'text-red-500' : ''}`}>{timeLeft}s</div>
          </div>
        </div>

        {isExpanded && (
          <div className="space-y-4 border-t pt-4 animate-in slide-in-from-top-2">
            <h4 className="font-semibold text-sm flex items-center gap-2"><Zap className="h-4 w-4" /> Execution Steps</h4>
            <div className="space-y-3">
               {/* Step 1 */}
               <div className="flex justify-between p-2 bg-background rounded border text-sm">
                  <span>1. {opportunity.step1_action} {opportunity.base_symbol}/{opportunity.intermediate_symbol}</span>
                  <span className="font-mono">@ {opportunity.step1_price}</span>
               </div>
               {/* Step 2 */}
               <div className="flex justify-between p-2 bg-background rounded border text-sm">
                  <span>2. {opportunity.step2_action} {opportunity.intermediate_symbol}/{opportunity.quote_symbol}</span>
                  <span className="font-mono">@ {opportunity.step2_price}</span>
               </div>
               {/* Step 3 */}
               <div className="flex justify-between p-2 bg-background rounded border text-sm">
                  <span>3. {opportunity.step3_action} {opportunity.base_symbol}/{opportunity.quote_symbol}</span>
                  <span className="font-mono">@ {opportunity.step3_price}</span>
               </div>
            </div>
            
            <div className="p-3 bg-muted/30 rounded border border-dashed">
              <h5 className="text-xs font-semibold mb-2 text-muted-foreground">RISK ASSESSMENT</h5>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>Complexity: <span className={`font-semibold ${riskMetrics.complexityColor}`}>{riskMetrics.complexity}</span></div>
                <div>Speed: <span className="font-semibold">{riskMetrics.speedRequired}</span></div>
                <div>Success Rate: <span className="font-semibold">{riskMetrics.successRate}</span></div>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center pt-2">
          <Button variant="outline" size="sm" onClick={() => setIsExpanded(!isExpanded)} className="flex items-center gap-2">
            {isExpanded ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {isExpanded ? 'Hide Details' : 'Show Details'}
          </Button>
          
          <Button 
            onClick={handleTrade}
            disabled={executing || timeLeft <= 0}
            className={`${rank === 1 ? 'bg-yellow-500 hover:bg-yellow-600 text-black' : 'bg-green-600 hover:bg-green-700'} transition-colors`}
          >
            {executing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Executing...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" /> Execute Trade
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

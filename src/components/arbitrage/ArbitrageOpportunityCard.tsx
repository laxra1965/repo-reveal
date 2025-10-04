import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ArrowRight, TrendingUp, Clock, Eye, EyeOff, Zap, AlertTriangle, Target } from 'lucide-react';

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

interface ArbitrageOpportunityCardProps {
  opportunity: Opportunity;
  rank: number;
}

export const ArbitrageOpportunityCard = ({ opportunity, rank }: ArbitrageOpportunityCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { toast } = useToast();

  const handleTrade = () => {
    toast({
      title: "Trade Execution",
      description: "Trade execution functionality requires API credentials to be configured in Settings",
    });
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

  return (
    <Card className={`border-l-4 ${rank === 1 ? 'border-l-yellow-500 bg-gradient-to-r from-yellow-50/30 to-transparent dark:from-yellow-900/10' : rank <= 3 ? 'border-l-green-500' : 'border-l-primary'} transition-all duration-300 hover:shadow-lg`}>
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <div className="flex-1">
            {/* Rank and Title */}
            <div className="flex items-center gap-2 mb-2">
              <Badge variant={getRankBadgeVariant()} className="flex items-center gap-1">
                {getRankIcon()}
                #{rank}
              </Badge>
              {rank === 1 && <Badge variant="default" className="bg-yellow-500 text-black">TOP</Badge>}
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
                1. {opportunity.step1_action} {opportunity.base_symbol}/{opportunity.intermediate_symbol}
              </div>
              <div className="font-mono text-sm">
                2. {opportunity.step2_action} {opportunity.intermediate_symbol}/{opportunity.quote_symbol}
              </div>
              <div className="font-mono text-sm">
                3. {opportunity.step3_action} {opportunity.base_symbol}/{opportunity.quote_symbol}
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
            <div className={`text-2xl font-bold ${
              opportunity.profit_percent > 0 ? 'text-green-500' : 'text-red-500'
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
            <div className="text-sm text-muted-foreground">Start Amount</div>
            <div className="font-semibold">
              {formatCurrency(opportunity.start_amount, 2)} {opportunity.quote_symbol}
            </div>
          </div>
          <div className="text-center">
            <div className="text-sm text-muted-foreground">End Amount</div>
            <div className="font-semibold">
              {formatCurrency(opportunity.end_amount, 2)} {opportunity.quote_symbol}
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
                <div>Complexity: <span className="font-semibold">Medium</span></div>
                <div>Speed Required: <span className="font-semibold">High</span></div>
                <div>Market Impact: <span className="font-semibold">Low</span></div>
                <div>Success Rate: <span className="font-semibold">~75%</span></div>
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
          
          <div className="flex gap-2">
            {rank === 1 && (
              <Button 
                onClick={handleTrade}
                className="bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-black font-semibold"
              >
                <Zap className="h-4 w-4 mr-2" />
                Execute Top Trade
              </Button>
            )}
            {rank !== 1 && (
              <Button 
                onClick={handleTrade}
                className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800"
              >
                Execute Trade
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
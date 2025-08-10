import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ArrowRight, TrendingUp, Clock } from 'lucide-react';

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
}

interface ArbitrageOpportunityProps {
  opportunity: Opportunity;
}

export const ArbitrageOpportunity = ({ opportunity }: ArbitrageOpportunityProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { toast } = useToast();

  const handleTrade = () => {
    // TODO: Implement trade execution
    toast({
      title: "Trade Execution",
      description: "Trade execution functionality will be implemented with API credentials",
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

  const profitColor = opportunity.profit_percent > 0 ? 'text-green-600' : 'text-red-600';

  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-lg">
              {opportunity.base_symbol} → {opportunity.intermediate_symbol} → {opportunity.quote_symbol}
            </CardTitle>
            <div className="flex gap-2 mt-2">
              <Badge variant="outline">{formatExchange(opportunity.exchange1)}</Badge>
              <ArrowRight className="h-4 w-4 mt-0.5" />
              <Badge variant="outline">{formatExchange(opportunity.exchange2)}</Badge>
              <ArrowRight className="h-4 w-4 mt-0.5" />
              <Badge variant="outline">{formatExchange(opportunity.exchange3)}</Badge>
            </div>
          </div>
          <div className="text-right">
            <div className={`text-2xl font-bold ${profitColor}`}>
              +{opportunity.profit_percent.toFixed(4)}%
            </div>
            <div className="text-sm text-muted-foreground">
              +{formatCurrency(opportunity.profit_amount, 4)} {opportunity.base_symbol}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Summary */}
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              <span className="text-sm">
                Start: {formatCurrency(opportunity.start_amount, 4)} {opportunity.base_symbol}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span className="text-sm text-muted-foreground">
                Expires in {getTimeLeft()}s
              </span>
            </div>
          </div>

          {/* Trade Steps */}
          {isExpanded && (
            <div className="space-y-3 p-4 bg-muted rounded-lg">
              <h4 className="font-semibold">Trading Steps:</h4>
              
              <div className="space-y-2">
                <div className="flex justify-between items-center p-2 bg-background rounded">
                  <span className="text-sm">
                    <Badge variant={opportunity.step1_action === 'BUY' ? 'default' : 'destructive'} className="mr-2">
                      {opportunity.step1_action}
                    </Badge>
                    {opportunity.base_symbol}/{opportunity.intermediate_symbol} on {formatExchange(opportunity.exchange1)}
                  </span>
                  <span className="text-sm font-mono">
                    @ {formatCurrency(opportunity.step1_price)}
                  </span>
                </div>

                <div className="flex justify-center">
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>

                <div className="flex justify-between items-center p-2 bg-background rounded">
                  <span className="text-sm">
                    <Badge variant={opportunity.step2_action === 'BUY' ? 'default' : 'destructive'} className="mr-2">
                      {opportunity.step2_action}
                    </Badge>
                    {opportunity.intermediate_symbol}/{opportunity.quote_symbol} on {formatExchange(opportunity.exchange2)}
                  </span>
                  <span className="text-sm font-mono">
                    @ {formatCurrency(opportunity.step2_price)}
                  </span>
                </div>

                <div className="flex justify-center">
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>

                <div className="flex justify-between items-center p-2 bg-background rounded">
                  <span className="text-sm">
                    <Badge variant={opportunity.step3_action === 'BUY' ? 'default' : 'destructive'} className="mr-2">
                      {opportunity.step3_action}
                    </Badge>
                    {opportunity.base_symbol}/{opportunity.quote_symbol} on {formatExchange(opportunity.exchange3)}
                  </span>
                  <span className="text-sm font-mono">
                    @ {formatCurrency(opportunity.step3_price)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-between items-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? 'Hide Details' : 'Show Details'}
            </Button>
            <Button 
              onClick={handleTrade}
              className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800"
            >
              Execute Trade
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
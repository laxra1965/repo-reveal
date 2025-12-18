import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Wallet, RefreshCw, ChevronDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { invokeFunction } from '@/lib/functionsInvoke';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';

interface ExchangeBalance {
  exchange: string;
  totalUSDT: number;
  assets: Record<string, number>;
  timestamp: string;
  error?: string;
}

interface BalanceData {
  balances: ExchangeBalance[];
  totalUSDT: number;
  timestamp: string;
}

export const ExchangeBalanceCard = () => {
  const [balanceData, setBalanceData] = useState<BalanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const fetchBalances = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('No active session');
      }

      const response = await invokeFunction('fetch-exchange-balances', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      // invokeFunction throws on non-2xx; response is supabase invoke response
      setBalanceData(response.data);
    } catch (error) {
      console.error('Error fetching balances:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch exchange balances',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBalances();
    // Refresh every 30 seconds
    const interval = setInterval(fetchBalances, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const getExchangeColor = (exchange: string) => {
    const colors: Record<string, string> = {
      binance: 'bg-yellow-500',
      bybit: 'bg-orange-500',
      okx: 'bg-blue-500',
      gate: 'bg-purple-500',
      kucoin: 'bg-green-500',
    };
    return colors[exchange.toLowerCase()] || 'bg-gray-500';
  };

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Wallet className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Balance</p>
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-auto p-0 hover:bg-transparent font-bold text-2xl"
                  >
                    {loading ? (
                      <span className="animate-pulse">Loading...</span>
                    ) : (
                      <>
                        {formatCurrency(balanceData?.totalUSDT || 0)}
                        <ChevronDown className="h-4 w-4 ml-1 text-muted-foreground" />
                      </>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80" align="start">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm">Exchange Balances</h4>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={fetchBalances}
                        disabled={loading}
                        className="h-7 px-2"
                      >
                        <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                      </Button>
                    </div>
                    
                    {balanceData?.balances && balanceData.balances.length > 0 ? (
                      <div className="space-y-2">
                        {balanceData.balances.map((balance) => (
                          <div
                            key={balance.exchange}
                            className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                          >
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${getExchangeColor(balance.exchange)}`} />
                              <span className="font-medium text-sm capitalize">
                                {balance.exchange}
                              </span>
                              {balance.error && (
                                <Badge variant="destructive" className="text-xs">
                                  Error
                                </Badge>
                              )}
                            </div>
                            <span className="font-semibold text-sm">
                              {formatCurrency(balance.totalUSDT)}
                            </span>
                          </div>
                        ))}
                        
                        <div className="pt-2 border-t border-border">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Total</span>
                            <span className="text-sm font-bold">
                              {formatCurrency(balanceData.totalUSDT)}
                            </span>
                          </div>
                        </div>
                        
                        <p className="text-xs text-muted-foreground text-center">
                          Last updated: {new Date(balanceData.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                    ) : (
                      <div className="text-center py-4">
                        <p className="text-sm text-muted-foreground">
                          No exchange credentials found
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Add API keys in settings
                        </p>
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          
          <Button
            size="sm"
            variant="ghost"
            onClick={fetchBalances}
            disabled={loading}
            className="h-8 w-8 p-0"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

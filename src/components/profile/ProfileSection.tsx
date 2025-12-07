import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { TrendingUp, TrendingDown, Crown, Calendar } from 'lucide-react';

interface ProfileSectionProps {
  subscription: {
    subscription_plans: {
      name: string;
    } | null;
    end_date: string;
  } | null;
}

export const ProfileSection = ({ subscription }: ProfileSectionProps) => {
  const { user } = useAuth();
  const [totalProfit, setTotalProfit] = useState<number>(0);
  const [totalTrades, setTotalTrades] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const fetchProfitData = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('trade_history')
        .select('actual_profit, status')
        .eq('user_id', user.id)
        .eq('status', 'completed');

      if (error) throw error;

      const profit = data?.reduce((sum, trade) => {
        return sum + (Number(trade.actual_profit) || 0);
      }, 0) || 0;

      setTotalProfit(profit);
      setTotalTrades(data?.length || 0);
    } catch (error) {
      console.error('Error fetching profit data:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchProfitData();
  }, [fetchProfitData]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Profile Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-3">
          {/* P/L Section */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {totalProfit >= 0 ? (
                <TrendingUp className="h-4 w-4 text-green-500" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500" />
              )}
              <span>Total P/L</span>
            </div>
            <div className="text-2xl font-bold">
              {loading ? (
                <span className="text-muted-foreground">Loading...</span>
              ) : (
                <span className={totalProfit >= 0 ? 'text-green-500' : 'text-red-500'}>
                  ${totalProfit.toFixed(2)}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {totalTrades} completed trade{totalTrades !== 1 ? 's' : ''}
            </div>
          </div>

          {/* Subscription Type */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Crown className="h-4 w-4" />
              <span>Subscription</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="default" className="text-base">
                {subscription?.subscription_plans?.name || 'No Plan'}
              </Badge>
            </div>
          </div>

          {/* Expiry Date */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>Expires</span>
            </div>
            <div className="text-lg font-semibold">
              {subscription ? (
                new Date(subscription.end_date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })
              ) : (
                <span className="text-muted-foreground">N/A</span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

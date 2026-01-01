import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { isNetworkError, getErrorMessage } from '@/utils/networkUtils';

interface Subscription {
  id: string;
  status: string;
  start_date: string;
  end_date: string;
  subscription_plans: {
    name: string;
    price: number;
    duration_type: string;
  };
}

export const useSubscription = () => {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);

  const checkSubscription = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      setSubscription(null);
      setHasActiveSubscription(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select(`
  *,
  subscription_plans(
    name,
    price,
    duration_type
  )
    `)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .gte('end_date', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error checking subscription:', error);
        if (isNetworkError(error)) {
          console.error('Network error when checking subscription. Please check your internet connection.');
        }
        setSubscription(null);
        setHasActiveSubscription(false);
      } else if (data) {
        setSubscription(data);
        setHasActiveSubscription(true);
      } else {
        setSubscription(null);
        setHasActiveSubscription(false);
      }
    } catch (error: any) {
      console.error('Error checking subscription:', error);
      if (isNetworkError(error)) {
        console.error('Network error: Unable to connect to Supabase. Please check your internet connection and try again.');
      }
      setSubscription(null);
      setHasActiveSubscription(false);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    checkSubscription();
  }, [checkSubscription]);

  return {
    subscription,
    hasActiveSubscription,
    loading,
    refreshSubscription: checkSubscription,
  };
};
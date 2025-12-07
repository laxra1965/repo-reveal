import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

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
        setSubscription(null);
        setHasActiveSubscription(false);
      } else if (data) {
        setSubscription(data);
        setHasActiveSubscription(true);
      } else {
        setSubscription(null);
        setHasActiveSubscription(false);
      }
    } catch (error) {
      console.error('Error checking subscription:', error);
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
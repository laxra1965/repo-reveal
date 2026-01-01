import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlanCard } from './PlanCard';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { isNetworkError, getErrorMessage } from '@/utils/networkUtils';

interface Plan {
  id: string;
  name: string;
  price: number;
  duration_type: string;
  features: any; // Using any to handle JSON type from Supabase
  active: boolean;
}

export const PlansSection = () => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectingPlan, setSelectingPlan] = useState<string | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    try {
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('active', true)
        .order('price', { ascending: true });

      if (error) {
        if (isNetworkError(error)) {
          toast({
            title: "Connection Error",
            description: getErrorMessage(error, 'Failed to load subscription plans'),
            variant: "destructive",
          });
        } else {
          throw error;
        }
        return;
      }
      setPlans(data || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: getErrorMessage(error, 'Failed to load subscription plans'),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePlanSelect = async (planId: string) => {
    if (!user) return;

    try {
      setSelectingPlan(planId);
      
      // Generate transaction ID
      const transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      
      const selectedPlan = plans.find(p => p.id === planId);
      if (!selectedPlan) throw new Error('Plan not found');

      // Create transaction record
      const { data, error } = await supabase
        .from('transactions')
        .insert({
          user_id: user.id,
          plan_id: planId,
          transaction_id: transactionId,
          amount: selectedPlan.price,
          usdt_address: 'TRC20_ADDRESS_HERE', // This will be replaced with actual address
          status: 'pending'
        })
        .select()
        .single();

      if (error) throw error;

      // Navigate to payment page with the generated transaction ID (not the database ID)
      navigate(`/payment/${transactionId}`);

    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to process plan selection",
        variant: "destructive",
      });
    } finally {
      setSelectingPlan(null);
    }
  };

  if (loading) {
    return (
      <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
        {[1, 2].map((i) => (
          <div key={i} className="h-96 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
      {plans.map((plan) => (
        <PlanCard
          key={plan.id}
          id={plan.id}
          name={plan.name}
          price={plan.price}
          duration_type={plan.duration_type}
          features={Array.isArray(plan.features) ? plan.features : []}
          onSelect={handlePlanSelect}
          loading={selectingPlan === plan.id}
        />
      ))}
    </div>
  );
};
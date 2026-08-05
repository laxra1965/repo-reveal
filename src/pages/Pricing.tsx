
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PlanToggle } from "../components/ui/PlanToggle";
import { supabase } from "../integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage, isNetworkError } from "@/utils/networkUtils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";

function generateTransactionId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'txn_' + Math.random().toString(36).substr(2, 9) + Date.now();
}

const USDT_ADDRESS = "TQzjbHBa9ckat52PtVn7m2SSEM7dJXQ2uP";

interface DBPlan {
  id: string;
  name: string;
  duration_type: string;
  price: number;
  features: { features: string[] } | null;
  active: boolean;
}

// Group DB plans into tiers
function groupPlansIntoTiers(plans: DBPlan[]) {
  const tierMap = new Map<string, { name: string; features: string[]; plans: { duration_type: string; price: number; id: string }[] }>();

  for (const plan of plans) {
    if (!tierMap.has(plan.name)) {
      const features = Array.isArray(plan.features)
        ? plan.features
        : (plan.features as any)?.features || [];
      tierMap.set(plan.name, {
        name: plan.name,
        features,
        plans: [],
      });
    }
    tierMap.get(plan.name)!.plans.push({
      duration_type: plan.duration_type,
      price: plan.price,
      id: plan.id,
    });
  }

  // Sort tiers by lowest weekly price
  return Array.from(tierMap.values()).sort((a, b) => {
    const aMin = Math.min(...a.plans.map(p => p.price));
    const bMin = Math.min(...b.plans.map(p => p.price));
    return aMin - bMin;
  });
}

type Tier = ReturnType<typeof groupPlansIntoTiers>[number];

// Lifetime tiers have a single "lifetime" duration and ignore the billing toggle
function resolvePlan(tier: Tier, selectedPlan: string) {
  return (
    tier.plans.find(p => p.duration_type === selectedPlan) ||
    tier.plans.find(p => p.duration_type === 'lifetime')
  );
}

const Pricing = () => {
  const [selectedPlan, setSelectedPlan] = useState("weekly");
  const [loadingTier, setLoadingTier] = useState<number | null>(null);
  const [dbPlans, setDbPlans] = useState<DBPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const loadPlans = async () => {
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
              description: getErrorMessage(error, "Failed to connect to the database."),
              variant: "destructive",
            });
          } else {
            toast({
              title: "Database Error",
              description: getErrorMessage(error, "Could not load plans."),
              variant: "destructive",
            });
          }
        } else {
          setDbPlans((data || []).map(p => ({
            ...p,
            features: p.features as { features: string[] } | null,
            active: p.active ?? true,
          })));
        }
      } catch (error: any) {
        toast({
          title: "Error Loading Plans",
          description: getErrorMessage(error, "Failed to load plans."),
          variant: "destructive",
        });
      } finally {
        setPlansLoading(false);
      }
    };

    loadPlans();
  }, [toast]);

  const tiers = groupPlansIntoTiers(dbPlans);

  const handleSelect = async (tierIdx: number) => {
    setLoadingTier(tierIdx);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({
        title: "Authentication Required",
        description: "Please log in to subscribe.",
        variant: "destructive",
      });
      setLoadingTier(null);
      return navigate("/auth");
    }

    const tier = tiers[tierIdx];
    const selectedDuration = resolvePlan(tier, selectedPlan);

    if (!selectedDuration) {
      toast({
        title: "Plan Not Available",
        description: "Selected duration is not available for this tier.",
        variant: "destructive",
      });
      setLoadingTier(null);
      return;
    }

    const transaction_id = generateTransactionId();
    const { data: txn, error } = await supabase.from("transactions").insert({
      user_id: user.id,
      plan_id: selectedDuration.id,
      transaction_id,
      status: "pending",
      amount: selectedDuration.price,
      usdt_address: USDT_ADDRESS,
      payment_method: "USDT-TRC20"
    }).select().single();

    setLoadingTier(null);
    if (error || !txn) {
      toast({
        title: "Transaction Error",
        description: getErrorMessage(error, "Failed to create transaction."),
        variant: "destructive",
      });
      return;
    }

    toast({ title: "Success", description: "Redirecting to payment page..." });
    navigate(`/payment/${transaction_id}`);
  };

  const formatPrice = (price: number) => {
    return price >= 1000 ? `$${price.toLocaleString()}` : `$${price}`;
  };

  const durationLabel: Record<string, string> = {
    weekly: 'wk',
    monthly: 'mo',
    quarterly: 'qtr',
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground mb-3">
            Choose Your Plan
          </h1>
          <p className="text-base text-muted-foreground max-w-2xl mx-auto">
            Select the tier and billing cycle that fits your trading strategy.
          </p>
        </div>

        {plansLoading && (
          <div className="text-center text-muted-foreground mb-6">Loading plans...</div>
        )}
        {!plansLoading && tiers.length === 0 && (
          <div className="text-center text-destructive mb-6 p-4 bg-destructive/10 rounded-lg">
            ⚠️ No subscription plans are currently available. Please contact support.
          </div>
        )}

        <div className="flex justify-center mb-10">
          <PlanToggle value={selectedPlan} onChange={setSelectedPlan} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
          {tiers.map((tier, idx) => {
            const currentDuration = resolvePlan(tier, selectedPlan);
            const currentPrice = currentDuration ? formatPrice(currentDuration.price) : 'N/A';
            const isLifetime = currentDuration?.duration_type === 'lifetime';
            const isMiddle = idx === 1;

            return (
              <div
                key={tier.name}
                className={`
                  relative flex flex-col border rounded-2xl p-6 bg-card text-card-foreground
                  transition-all duration-200
                  ${isMiddle ? 'ring-2 ring-primary shadow-xl scale-[1.02]' : 'shadow-md'}
                  ${loadingTier === idx ? 'border-primary border-2' : 'border-border'}
                  ${loadingTier !== null && loadingTier !== idx ? 'opacity-60' : ''}
                `}
              >
                {isMiddle && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs px-3">
                    Most Popular
                  </Badge>
                )}

                <h2 className="text-lg font-bold text-foreground leading-snug mb-1">
                  {tier.name}
                </h2>

                <div className="mt-3 mb-5">
                  <span className="text-4xl font-extrabold tracking-tight text-primary">
                    {currentPrice}
                  </span>
                  <span className="text-sm font-medium text-muted-foreground ml-1">
                    /{durationLabel[selectedPlan] || selectedPlan}
                  </span>
                </div>

                <ul className="space-y-2 flex-1 mb-6">
                  {tier.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-foreground break-words">
                      <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  className="w-full"
                  size="lg"
                  variant={isMiddle ? 'default' : 'outline'}
                  disabled={loadingTier !== null || !currentDuration}
                  onClick={() => handleSelect(idx)}
                >
                  {loadingTier === idx ? 'Processing...' : 'Get Started'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Pricing;

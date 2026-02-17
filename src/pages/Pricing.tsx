
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

const tiers = [
  {
    name: "Tier 1: Scanner Only",
    price: "$19/week",
    features: [
      "Real-time triangular arbitrage opportunities on Binance & Bybit",
      "Historical data: 7 days of opportunity tracking",
      "Basic filters: Minimum profit threshold settings",
      "Assumed Monthly Profit: $150"
    ],
    plans: [
      { label: "Weekly", price: "$19" },
      { label: "Monthly", price: "$60" },
      { label: "Quarterly", price: "$150" }
    ]
  },
  {
    name: "Tier 2: Trader Pro ($500 Max)",
    price: "$195/week",
    features: [
      "Everything in Tier 1 plus:",
      "Automated trading via Binance & Bybit APIs",
      "Position limit: $500 maximum per trade",
      "Basic analytics: Trade history, P&L tracking",
      "Assumed Monthly Profit: $1,500"
    ],
    plans: [
      { label: "Weekly", price: "$195" },
      { label: "Monthly", price: "$600" },
      { label: "Quarterly", price: "$1,500" }
    ]
  },
  {
    name: "Tier 3: Trader Elite ($1,000 Max)",
    price: "$395/week",
    features: [
      "Everything in Tier 2 plus:",
      "Position limit: $1,000 maximum per trade",
      "Priority execution: Faster opportunity detection & execution",
      "Advanced analytics: Success rate tracking, Average profit per trade, Best performing pairs analysis, Time-of-day performance metrics",
      "Historical data: 90 days",
      "Custom settings: Personalized trading parameters",
      "Priority support: Email support with faster response",
      "Assumed Monthly Profit: $3,000"
    ],
    plans: [
      { label: "Weekly", price: "$395" },
      { label: "Monthly", price: "$1,200" },
      { label: "Quarterly", price: "$3,000" }
    ]
  }
];



const USDT_ADDRESS = "TQzjbHBa9ckat52PtVn7m2SSEM7dJXQ2uP"; // Your USDT-TRC20 address

const planValueToLabel = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly"
};

const Pricing = () => {
  const [selectedPlan, setSelectedPlan] = useState("weekly");
  const [selectedTier, setSelectedTier] = useState<number | null>(null);
  const [loadingTier, setLoadingTier] = useState<number | null>(null);
  const [availablePlans, setAvailablePlans] = useState<any[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  // Load available plans on mount to verify they exist
  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 2;

    const loadPlans = async (isRetry: boolean = false) => {
      try {
        const { data, error } = await supabase
          .from('subscription_plans')
          .select('name, duration_type, active, price')
          .eq('active', true)
          .order('name', { ascending: true });

        if (error) {
          console.error('Error loading plans:', error);
          
          // Check if it's a network error and retry
          if (isNetworkError(error) && !isRetry && retryCount < maxRetries) {
            retryCount++;
            console.log(`Retrying plan load (attempt ${retryCount}/${maxRetries})...`);
            setTimeout(() => loadPlans(true), 2000);
            return;
          }
          
          // Check if it's a network error
          if (isNetworkError(error)) {
            toast({
              title: "Connection Error",
              description: getErrorMessage(error, "Failed to connect to the database. Please check your internet connection and try again."),
              variant: "destructive",
            });
          } else {
            // Handle Supabase-specific errors
            const errorMsg = error.message || 'Unknown database error';
            const errorCode = error.code || 'N/A';
            const errorHint = error.hint || '';
            
            toast({
              title: "Database Error",
              description: `Could not verify plans. ${errorMsg}${errorCode !== 'N/A' ? ` (Code: ${errorCode})` : ''}${errorHint ? ` - ${errorHint}` : ''}`,
              variant: "destructive",
            });
          }
        } else {
          setAvailablePlans(data || []);
          console.log('Available plans:', data);
          // Reset retry count on success
          retryCount = 0;
        }
      } catch (error: any) {
        console.error('Error loading plans:', error);
        
        // Handle network errors in catch block and retry
        if (isNetworkError(error) && !isRetry && retryCount < maxRetries) {
          retryCount++;
          console.log(`Retrying plan load (attempt ${retryCount}/${maxRetries})...`);
          setTimeout(() => loadPlans(true), 2000);
          return;
        }
        
        // Handle network errors in catch block
        if (isNetworkError(error)) {
          toast({
            title: "Connection Error",
            description: getErrorMessage(error, "Failed to connect to the server. Please check your internet connection and try again."),
            variant: "destructive",
          });
        } else {
          // Handle other unexpected errors
          const errorMsg = error?.message || 'Unknown error occurred';
          const errorCode = error?.code || error?.name || 'N/A';
          
          toast({
            title: "Error Loading Plans",
            description: getErrorMessage(error, `Failed to load plans: ${errorMsg}${errorCode !== 'N/A' ? ` (${errorCode})` : ''}`),
            variant: "destructive",
          });
        }
      } finally {
        if (retryCount === 0 || retryCount >= maxRetries) {
          setPlansLoading(false);
        }
      }
    };

    loadPlans();
  }, [toast]);

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
    // Only allow plans that exist for the toggle
    const plan = tiers[tierIdx].plans.find(p => p.label.toLowerCase().replace(/\s/g, "") === planValueToLabel[selectedPlan].toLowerCase());
    if (!plan) {
      toast({
        title: "Plan Not Available",
        description: "Selected plan is not available for this tier.",
        variant: "destructive",
      });
      setLoadingTier(null);
      return;
    }
    // Fetch plan_id from subscription_plans table
    const { data: plans, error: planError } = await supabase
      .from('subscription_plans')
      .select('id, name, duration_type, active, price')
      .eq('name', tiers[tierIdx].name)
      .eq('duration_type', selectedPlan)
      .eq('active', true)
      .limit(1)
      .maybeSingle();

    if (planError) {
      console.error('Plan lookup error:', planError);
      console.error('Looking for:', { name: tiers[tierIdx].name, duration_type: selectedPlan });
      console.log('Available plans in database:', availablePlans);

      toast({
        title: "Plan Not Found",
        description: `Could not find plan "${tiers[tierIdx].name}" (${selectedPlan}). Please contact support.`,
        variant: "destructive",
      });
      setLoadingTier(null);
      return;
    }

    if (!plans) {
      console.error('Plan not found. Looking for:', { name: tiers[tierIdx].name, duration_type: selectedPlan });
      console.log('Available plans in database:', availablePlans);

      // Show which plans are actually available
      const availableForTier = availablePlans.filter(p =>
        p.name === tiers[tierIdx].name || p.name.includes(tiers[tierIdx].name.split(':')[0])
      );

      toast({
        title: "Plan Not Available",
        description: `Plan "${tiers[tierIdx].name}" (${selectedPlan}) is not available. ${availableForTier.length > 0 ? `Available durations: ${[...new Set(availableForTier.map(p => p.duration_type))].join(', ')}` : 'Please contact support.'}`,
        variant: "destructive",
      });
      setLoadingTier(null);
      return;
    }
    const plan_id = plans.id;
    const amount = parseFloat(plan.price.replace(/[^\d.]/g, ""));
    if (!amount || isNaN(amount)) {
      toast({
        title: "Invalid Amount",
        description: `Invalid plan amount: ${plan.price}. Please contact support.`,
        variant: "destructive",
      });
      setLoadingTier(null);
      return;
    }
    const transaction_id = generateTransactionId();
    const { data: txn, error } = await supabase.from("transactions").insert({
      user_id: user.id,
      plan_id,
      transaction_id,
      status: "pending",
      amount,
      usdt_address: USDT_ADDRESS,
      payment_method: "USDT-TRC20"
    }).select().single();
    setLoadingTier(null);
    if (error || !txn) {
      console.error("Transaction creation failed:", error);
      toast({
        title: "Transaction Error",
        description: getErrorMessage(error, "Failed to create transaction. Please try again."),
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Success",
      description: "Redirecting to payment page...",
    });
    navigate(`/payment/${transaction_id}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        {/* Header */}
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
        {!plansLoading && availablePlans.length === 0 && (
          <div className="text-center text-destructive mb-6 p-4 bg-destructive/10 rounded-lg">
            ⚠️ No subscription plans are currently available. Please contact support.
          </div>
        )}

        <div className="flex justify-center mb-10">
          <PlanToggle value={selectedPlan} onChange={setSelectedPlan} />
        </div>

        {/* Pricing Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
          {tiers.length === 0 ? (
            <div className="text-muted-foreground text-lg col-span-full text-center">
              No pricing tiers available.
            </div>
          ) : (
            tiers.map((tier, idx) => {
              const currentPrice =
                tier.plans.find(
                  (p) => p.label.toLowerCase().replace(/\s/g, '') === selectedPlan
                )?.price || tier.plans[0].price;
              const isMiddle = idx === 1;

              return (
                <div
                  key={tier.name}
                  role="button"
                  tabIndex={0}
                  aria-label={`Select ${tier.name}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setSelectedTier(idx);
                  }}
                  className={`
                    relative flex flex-col border rounded-2xl p-6 bg-card text-card-foreground
                    transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                    ${isMiddle ? 'ring-2 ring-primary shadow-xl scale-[1.02]' : 'shadow-md'}
                    ${loadingTier === idx ? 'border-primary border-2' : 'border-border'}
                    ${loadingTier !== null ? 'cursor-not-allowed' : 'cursor-pointer hover:shadow-lg'}
                    ${loadingTier !== null && loadingTier !== idx ? 'opacity-60' : ''}
                  `}
                  onClick={() => setSelectedTier(idx)}
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
                      /{selectedPlan === 'weekly' ? 'wk' : selectedPlan === 'monthly' ? 'mo' : 'qtr'}
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
                    disabled={loadingTier !== null}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelect(idx);
                    }}
                  >
                    {loadingTier === idx ? 'Processing...' : 'Get Started'}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default Pricing;

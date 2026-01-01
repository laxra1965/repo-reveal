
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PlanToggle } from "../components/ui/PlanToggle";
import { supabase } from "../integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/utils/networkUtils";

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
    const loadPlans = async () => {
      try {
        const { data, error } = await supabase
          .from('subscription_plans')
          .select('name, duration_type, active, price')
          .eq('active', true)
          .order('name', { ascending: true });

        if (error) {
          console.error('Error loading plans:', error);
          toast({
            title: "Database Error",
            description: `Could not verify plans. Msg: ${error.message}. Hint: ${error.hint || 'No hint'}. Code: ${error.code}`,
            variant: "destructive",
          });
        } else {
          setAvailablePlans(data || []);
          console.log('Available plans:', data);
        }
      } catch (error: any) {
        console.error('Error loading plans:', error);
        toast({
          title: "Error Loading Plans",
          description: `Details: ${error.message || 'Unknown error'} (Code: ${error.code || 'N/A'})`,
          variant: "destructive",
        });
      } finally {
        setPlansLoading(false);
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
    <div style={{ minHeight: '100vh', background: '#f7f7fa', maxWidth: 1200, margin: "2rem auto", padding: 16 }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 24, textAlign: 'center', color: '#111' }}>Pricing</h1>
      {plansLoading && (
        <div style={{ textAlign: 'center', color: '#888', marginBottom: 16 }}>
          Loading plans...
        </div>
      )}
      {!plansLoading && availablePlans.length === 0 && (
        <div style={{ textAlign: 'center', color: '#d32f2f', marginBottom: 16, padding: 16, background: '#ffebee', borderRadius: 8 }}>
          ⚠️ No subscription plans are currently available. Please contact support.
        </div>
      )}
      <PlanToggle value={selectedPlan} onChange={setSelectedPlan} />
      <div style={{
        display: "flex",
        flexDirection: "row",
        gap: 24,
        justifyContent: "center",
        overflowX: "auto",
        width: "100%"
      }}>
        {tiers.length === 0 ? (
          <div style={{ color: '#888', fontSize: 18 }}>No pricing tiers available.</div>
        ) : (
          tiers.map((tier, idx) => (
            <div
              key={tier.name}
              style={{
                border: loadingTier === idx ? "2px solid #0070f3" : "1px solid #ccc",
                borderRadius: 12,
                padding: 24,
                minWidth: 320,
                background: "#fff",
                boxShadow: "0 2px 12px 0 rgba(0,0,0,0.07)",
                color: '#222',
                cursor: loadingTier !== null ? 'not-allowed' : 'pointer',
                opacity: loadingTier !== null && loadingTier !== idx ? 0.7 : 1,
                flex: '0 0 340px',
                marginBottom: 12
              }}
              onClick={() => setSelectedTier(idx)}
            >
              <h2 style={{ fontSize: 22, fontWeight: 600, color: '#111' }}>{tier.name}</h2>
              <ul style={{ margin: "12px 0", paddingLeft: 20 }}>
                {tier.features.map((f, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>{f}</li>
                ))}
              </ul>
              <div style={{ margin: "12px 0" }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#0070f3', marginBottom: 8 }}>
                  {tier.plans.find(p => p.label.toLowerCase().replace(/\s/g, "") === selectedPlan)?.price || tier.plans[0].price}
                </div>
              </div>
              <button
                style={{
                  marginTop: 12,
                  padding: '10px 24px',
                  borderRadius: 8,
                  background: '#0070f3',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: 16,
                  width: '100%',
                  cursor: loadingTier !== null ? 'not-allowed' : 'pointer',
                  opacity: loadingTier !== null && loadingTier !== idx ? 0.7 : 1
                }}
                disabled={loadingTier !== null}
                onClick={e => {
                  e.stopPropagation();
                  handleSelect(idx);
                }}
              >
                {loadingTier === idx ? 'Processing...' : 'Select Plan'}
              </button>
            </div>
          ))
        )}
      </div>
      {/* USDT-TRC20 address will be shown on the payment page after plan selection */}
    </div>
  );
};

export default Pricing;


import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PlanToggle } from "../components/ui/PlanToggle";
import { supabase } from "../integrations/supabase/client";

function generateTransactionId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'txn_' + Math.random().toString(36).substr(2, 9) + Date.now();
}

const tiers = [
  {
    name: "Tier 1: Scanner Only",
    price: "$9/week",
    features: [
      "Real-time triangular arbitrage opportunities on Binance & Bybit",
      "Historical data: 7 days of opportunity tracking",
      "Basic filters: Minimum profit threshold settings"
    ],
    plans: [
      { label: "Weekly", price: "$9" },
      { label: "Monthly", price: "$35 (3% discount)" },
      { label: "6 Months", price: "$195 (28% discount)" },
      { label: "Annual", price: "$360 (31% discount)" }
    ]
  },
  {
    name: "Tier 2: Trader Pro ($500 Max)",
    price: "$25/week",
    features: [
      "Everything in Tier 1 plus:",
      "Automated trading via Binance & Bybit APIs",
      "Position limit: $500 maximum per trade",
      "Basic analytics: Trade history, P&L tracking"
    ],
    plans: [
      { label: "Weekly", price: "$25" },
      { label: "Monthly", price: "$95 (5% discount)" },
      { label: "6 Months", price: "$540 (17% discount)" },
      { label: "Annual", price: "$1,000 (23% discount)" }
    ]
  },
  {
    name: "Tier 3: Trader Elite ($1,000 Max)",
    price: "$50/week",
    features: [
      "Everything in Tier 2 plus:",
      "Position limit: $1,000 maximum per trade",
      "Priority execution: Faster opportunity detection & execution",
      "Advanced analytics: Success rate tracking, Average profit per trade, Best performing pairs analysis, Time-of-day performance metrics",
      "Historical data: 90 days",
      "Custom settings: Personalized trading parameters",
      "Priority support: Email support with faster response"
    ],
    plans: [
      { label: "Weekly", price: "$50" },
      { label: "Monthly", price: "$190 (5% discount)" },
      { label: "6 Months", price: "$1,080 (17% discount)" },
      { label: "Annual", price: "$2,000 (23% discount)" }
    ]
  }
];



const USDT_ADDRESS = "TLDsH3QUGsQJBhTsNjdT2g4Lk4U9Uw7hTH"; // Your USDT-TRC20 address

const planValueToLabel = {
  weekly: "Weekly",
  monthly: "Monthly",
  annual: "Annual"
};

const Pricing = () => {
  const [selectedPlan, setSelectedPlan] = useState("weekly");
  const [selectedTier, setSelectedTier] = useState<number | null>(null);
  const [loadingTier, setLoadingTier] = useState<number | null>(null);
  const navigate = useNavigate();

  const handleSelect = async (tierIdx: number) => {
    setLoadingTier(tierIdx);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert("Please log in to subscribe.");
      setLoadingTier(null);
      return navigate("/auth");
    }
    // Only allow plans that exist for the toggle
    const plan = tiers[tierIdx].plans.find(p => p.label.toLowerCase().replace(/\s/g,"") === planValueToLabel[selectedPlan].toLowerCase());
    if (!plan) {
      alert("Selected plan is not available for this tier.");
      setLoadingTier(null);
      return;
    }
    // Fetch plan_id from subscription_plans table
    const { data: plans, error: planError } = await supabase
      .from('subscription_plans')
      .select('id')
      .eq('name', tiers[tierIdx].name)
      .eq('duration_type', selectedPlan)
      .limit(1)
      .single();
    if (planError || !plans) {
      alert("Could not find plan in database. Please contact support.");
      setLoadingTier(null);
      return;
    }
    const plan_id = plans.id;
    const amount = parseFloat(plan.price.replace(/[^\d.]/g, ""));
    if (!amount) {
      alert("Invalid plan amount.");
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
      alert("Failed to create transaction. Please try again.");
      return;
    }
    navigate(`/payment/${txn.id}`);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f7f7fa', maxWidth: 1200, margin: "2rem auto", padding: 16 }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 24, textAlign: 'center', color: '#111' }}>Pricing</h1>
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
                <strong>Pricing:</strong>
                <ul style={{ paddingLeft: 20, margin: 0 }}>
                  {tier.plans.filter(plan => ["weekly","monthly","annual"].includes(plan.label.toLowerCase().replace(/\s/g, ""))).map((plan, i) => (
                    <li
                      key={i}
                      style={{
                        fontWeight: plan.label.toLowerCase().replace(/\s/g,"") === selectedPlan ? 700 : 400,
                        color: plan.label.toLowerCase().replace(/\s/g,"") === selectedPlan ? '#0070f3' : '#222'
                      }}
                    >
                      {plan.label}: {plan.price}
                    </li>
                  ))}
                </ul>
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

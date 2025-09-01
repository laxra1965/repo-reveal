
import { useEffect, useState } from "react";
import { supabase } from "../integrations/supabase/client";

const ADMIN_EMAILS = ["laxracorp@gmail.com", "admin@arbitrage.com"];

export default function AdminApprove() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    async function checkAuthAndFetch() {
      const { data: { user } } = await supabase.auth.getUser();
      setUserEmail(user?.email ?? null);
      setCheckingAuth(false);
      if (user?.email && ADMIN_EMAILS.includes(user.email)) {
        const { data } = await supabase
          .from("transactions")
          .select("*")
          .eq("status", "proof_submitted");
        setTransactions(data ?? []);
      }
      setLoading(false);
    }
    checkAuthAndFetch();
  }, []);

  async function handleAction(id: string, status: "confirmed" | "failed") {
    // Update transaction status
    await supabase
      .from("transactions")
      .update({ status })
      .eq("id", id);

    // If approved, create a user_subscriptions record
    if (status === "confirmed") {
      // Fetch the transaction to get user_id, plan_id, etc.
      const { data: transaction } = await supabase
        .from("transactions")
        .select("*")
        .eq("id", id)
        .single();

      if (transaction) {
        // Calculate start and end dates as needed
        const start_date = new Date().toISOString();
        // Example: 30 days subscription
        const end_date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        await supabase.from("user_subscriptions").insert({
          user_id: transaction.user_id,
          plan_id: transaction.plan_id,
          start_date,
          end_date,
          status: "active",
          transaction_id: transaction.id,
        });
      }
    }

    setTransactions((prev) => prev.filter((t) => t.id !== id));
  }

  if (checkingAuth || loading) return <div>Loading...</div>;
  if (!userEmail || !ADMIN_EMAILS.includes(userEmail)) {
    return <div>Access denied. Admins only.</div>;
  }
  if (transactions.length === 0) return <div>No pending approvals.</div>;

  return (
    <div>
      <h2>Pending Payment Proofs</h2>
      <ul>
        {transactions.map((t) => (
          <li key={t.id}>
            User: {t.user_id} | Proof: {t.payment_proof}
            <button onClick={() => handleAction(t.id, "confirmed")}>Approve</button>
            <button onClick={() => handleAction(t.id, "failed")}>Reject</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Shield, CheckCircle, XCircle, ArrowLeft, Loader2 } from "lucide-react";
import { format } from "date-fns";

interface Transaction {
  id: string;
  transaction_id: string;
  user_id: string;
  plan_id: string;
  amount: number;
  payment_proof: string;
  status: string;
  created_at: string;
  subscription_plans?: {
    name: string;
    duration_type: string;
  };
  users?: {
    email: string;
  };
}

const AdminApprove = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const { user } = useAuth();
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (!adminLoading && !isAdmin) {
      navigate('/admin');
      return;
    }
    if (user && isAdmin) {
      fetchTransactions();
    }
  }, [user, isAdmin, adminLoading, navigate]);

  const fetchTransactions = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("transactions")
        .select(`
          *,
          subscription_plans (
            name,
            duration_type
          )
        `)
        .eq("status", "proof_submitted")
        .order("created_at", { ascending: false });

      if (error) throw error;
      
      // Fetch user emails separately since there's no direct relation
      const transactionsWithUsers: Transaction[] = [];
      for (const tx of data || []) {
        // Get user email from profiles table
        const { data: profile } = await supabase
          .from('profiles')
          .select('email')
          .eq('user_id', tx.user_id)
          .maybeSingle();
        
        transactionsWithUsers.push({
          ...tx,
          users: profile ? { email: profile.email } : undefined
        });
      }
      
      setTransactions(transactionsWithUsers);
    } catch (error: any) {
      console.error("Error fetching transactions:", error);
      toast({
        title: "Error",
        description: "Failed to load pending transactions",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const calculateEndDate = (durationType: string): string => {
    const startDate = new Date();
    let endDate = new Date();

    switch (durationType) {
      case "weekly":
        endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
        break;
      case "monthly":
        endDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
        break;
      case "quarterly":
        endDate = new Date(startDate.getTime() + 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        endDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    }

    return endDate.toISOString();
  };

  const handleAction = async (id: string, status: "confirmed" | "failed") => {
    setProcessingId(id);

    try {
      // Fetch the transaction with plan details
      const { data: transaction, error: fetchError } = await supabase
        .from("transactions")
        .select(`
          *,
          subscription_plans (
            name,
            duration_type
          )
        `)
        .eq("id", id)
        .single();

      if (fetchError) throw fetchError;

      // Update transaction status
      const { error: updateError } = await supabase
        .from("transactions")
        .update({ status })
        .eq("id", id);

      if (updateError) throw updateError;

      // If approved, create a user_subscriptions record
      if (status === "confirmed" && transaction) {
        const start_date = new Date().toISOString();
        const end_date = calculateEndDate(
          transaction.subscription_plans?.duration_type || "monthly"
        );

        const { error: insertError } = await supabase
          .from("user_subscriptions")
          .insert({
            user_id: transaction.user_id,
            plan_id: transaction.plan_id,
            start_date,
            end_date,
            status: "active",
            transaction_id: transaction.id,
          });

        if (insertError) throw insertError;

        toast({
          title: "Success",
          description: "Transaction approved and subscription created",
        });
      } else {
        toast({
          title: "Transaction Rejected",
          description: "Transaction has been marked as failed",
        });
      }

      // Remove from list
      setTransactions((prev) => prev.filter((t) => t.id !== id));
    } catch (error: any) {
      console.error("Error processing transaction:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to process transaction",
        variant: "destructive",
      });
    } finally {
      setProcessingId(null);
    }
  };

  if (adminLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-xl text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-3">
              <Shield className="h-6 w-6 text-destructive" />
              <CardTitle>Access Denied</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              You don't have permission to access this page.
            </p>
            <Button onClick={() => navigate('/admin')}>
              Go to Admin Panel
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <Shield className="h-8 w-8" />
                Payment Approvals
              </h1>
              <p className="text-muted-foreground">Review and approve pending payment proofs</p>
            </div>
          </div>
        </div>

        {/* Transactions Table */}
        <Card>
          <CardHeader>
            <CardTitle>Pending Transactions</CardTitle>
            <CardDescription>
              {transactions.length} transaction{transactions.length !== 1 ? 's' : ''} awaiting approval
            </CardDescription>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <div className="text-center py-12">
                <CheckCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-lg text-muted-foreground">No pending approvals</p>
                <p className="text-sm text-muted-foreground mt-2">
                  All transactions have been processed
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Transaction ID</TableHead>
                      <TableHead>User Email</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Payment Proof</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((transaction) => (
                      <TableRow key={transaction.id}>
                        <TableCell className="font-mono text-xs">
                          {transaction.transaction_id}
                        </TableCell>
                        <TableCell>
                          {transaction.users?.email || transaction.user_id}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {transaction.subscription_plans?.name || 'Unknown Plan'}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-semibold">
                          ${transaction.amount} USDT
                        </TableCell>
                        <TableCell>
                          <div className="max-w-xs">
                            <code className="text-xs bg-muted p-1 rounded break-all">
                              {transaction.payment_proof || 'No proof provided'}
                            </code>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(transaction.created_at), 'MMM dd, yyyy HH:mm')}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleAction(transaction.id, "confirmed")}
                              disabled={processingId === transaction.id}
                              className="gap-2"
                            >
                              {processingId === transaction.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <CheckCircle className="h-4 w-4" />
                              )}
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleAction(transaction.id, "failed")}
                              disabled={processingId === transaction.id}
                              className="gap-2"
                            >
                              {processingId === transaction.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <XCircle className="h-4 w-4" />
                              )}
                              Reject
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminApprove;

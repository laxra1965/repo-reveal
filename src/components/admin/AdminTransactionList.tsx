import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, XCircle, Eye, Copy } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

interface Transaction {
  id: string;
  transaction_id: string;
  amount: number;
  usdt_address: string;
  status: string;
  payment_proof: string;
  created_at: string;
  confirmed_at: string;
  plan_id: string;
  user_id: string;
  user_email?: string;
  subscription_plans: {
    name: string;
    duration_type: string;
  } | null;
}

export const AdminTransactionList = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchTransactions();
  }, []);

  const fetchTransactions = async () => {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select(`
          *,
          subscription_plans (
            name,
            duration_type
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Get user emails for each transaction
      const transactionsWithEmails = await Promise.all(
        (data || []).map(async (transaction) => {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('email')
            .eq('user_id', transaction.user_id)
            .single();
          
          return {
            ...transaction,
            user_email: profileData?.email || 'Unknown'
          };
        })
      );
      
      setTransactions(transactionsWithEmails);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch transactions",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const approveTransaction = async (transaction: Transaction) => {
    if (processing) return; // guard against concurrent clicks
    try {
      setProcessing(transaction.id);

      console.log('Starting transaction approval for:', transaction.id);

      // Idempotency: bail if this transaction is already confirmed
      // or already has a linked subscription.
      const { data: existingTxn } = await supabase
        .from('transactions')
        .select('status')
        .eq('id', transaction.id)
        .maybeSingle();

      if (existingTxn?.status === 'confirmed') {
        toast({
          title: 'Already approved',
          description: 'This transaction was already confirmed.',
        });
        fetchTransactions();
        return;
      }

      const { data: existingSub } = await supabase
        .from('user_subscriptions')
        .select('id')
        .eq('transaction_id', transaction.id)
        .maybeSingle();

      if (existingSub) {
        // Sub already exists — just make sure the txn is marked confirmed.
        await supabase
          .from('transactions')
          .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
          .eq('id', transaction.id);
        toast({
          title: 'Already activated',
          description: 'A subscription already exists for this transaction.',
        });
        fetchTransactions();
        return;
      }

      // Update transaction status
      const { error: transactionError } = await supabase
        .from('transactions')
        .update({ 
          status: 'confirmed',
          confirmed_at: new Date().toISOString()
        })
        .eq('id', transaction.id);

      if (transactionError) {
        console.error('Transaction update error:', transactionError);
        throw transactionError;
      }

      console.log('Transaction status updated successfully');

      // Calculate subscription end date
      const startDate = new Date();
      const endDate = new Date(startDate);
      
      const durationType = transaction.subscription_plans?.duration_type;
      if (durationType === 'lifetime') {
        endDate.setFullYear(endDate.getFullYear() + 100);
      } else if (durationType === 'weekly') {
        endDate.setDate(endDate.getDate() + 7);
      } else if (durationType === 'quarterly') {
        endDate.setDate(endDate.getDate() + 90);
      } else {
        endDate.setMonth(endDate.getMonth() + 1);
      }

      console.log('Creating subscription with dates:', {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      });

      // Create user subscription
      const { error: subscriptionError } = await supabase
        .from('user_subscriptions')
        .insert({
          user_id: transaction.user_id,
          plan_id: transaction.plan_id,
          transaction_id: transaction.id,
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
          status: 'active'
        });

      if (subscriptionError) {
        console.error('Subscription creation error:', subscriptionError);
        throw subscriptionError;
      }

      console.log('Subscription created successfully');

      toast({
        title: "Success",
        description: "Transaction approved and subscription activated",
      });

      fetchTransactions();
    } catch (error) {
      console.error('Approval process failed:', error);
      toast({
        title: "Error",
        description: `Failed to approve transaction: ${error.message || 'Unknown error'}`,
        variant: "destructive",
      });
    } finally {
      setProcessing(null);
    }
  };

  const rejectTransaction = async (transactionId: string) => {
    try {
      setProcessing(transactionId);

      const { error } = await supabase
        .from('transactions')
        .update({ status: 'rejected' })
        .eq('id', transactionId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Transaction rejected",
      });

      fetchTransactions();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to reject transaction",
        variant: "destructive",
      });
    } finally {
      setProcessing(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Text copied to clipboard",
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary">Pending</Badge>;
      case 'proof_submitted':
        return <Badge variant="outline">Proof Submitted</Badge>;
      case 'confirmed':
        return <Badge className="bg-green-500 text-white">Confirmed</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Loading transactions...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Transaction Management</h2>
        <Button onClick={fetchTransactions} variant="outline">
          Refresh
        </Button>
      </div>

      {transactions.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No transactions found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {transactions.map((transaction) => (
            <Card key={transaction.id}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-lg">
                      {transaction.subscription_plans?.name || 'Unknown Plan'}
                    </CardTitle>
                    <CardDescription>
                      {transaction.user_email} • ${transaction.amount} USDT
                    </CardDescription>
                  </div>
                  {getStatusBadge(transaction.status)}
                </div>
              </CardHeader>
              
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <strong>Transaction ID:</strong>
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{transaction.transaction_id}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyToClipboard(transaction.transaction_id)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <strong>Created:</strong>
                    <div>{new Date(transaction.created_at).toLocaleString()}</div>
                  </div>
                  <div>
                    <strong>Plan Duration:</strong>
                    <div>{transaction.subscription_plans?.duration_type || 'N/A'}</div>
                  </div>
                  <div>
                    <strong>USDT Address:</strong>
                    <div className="font-mono text-xs">{transaction.usdt_address}</div>
                  </div>
                </div>

                {transaction.payment_proof && (
                  <div>
                    <strong>Payment Proof:</strong>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{transaction.payment_proof}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyToClipboard(transaction.payment_proof)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}

                {transaction.status === 'proof_submitted' && (
                  <div className="flex gap-2">
                    <Button
                      onClick={() => approveTransaction(transaction)}
                      disabled={processing === transaction.id}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      {processing === transaction.id ? 'Processing...' : 'Approve'}
                    </Button>
                    <Button
                      onClick={() => rejectTransaction(transaction.id)}
                      disabled={processing === transaction.id}
                      variant="destructive"
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Reject
                    </Button>
                  </div>
                )}

                {transaction.status === 'pending' && (
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        if (confirm(`Force approve transaction ${transaction.transaction_id}? This will activate the subscription without payment proof.`)) {
                          approveTransaction(transaction);
                        }
                      }}
                      disabled={processing === transaction.id}
                      variant="outline"
                      className="border-orange-500 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950"
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      {processing === transaction.id ? 'Processing...' : 'Force Approve'}
                    </Button>
                    <Button
                      onClick={() => rejectTransaction(transaction.id)}
                      disabled={processing === transaction.id}
                      variant="destructive"
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Reject
                    </Button>
                  </div>
                )}

                {transaction.confirmed_at && (
                  <div className="text-sm text-green-600">
                    <strong>Confirmed at:</strong> {new Date(transaction.confirmed_at).toLocaleString()}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
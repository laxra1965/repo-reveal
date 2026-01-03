import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useAdminSettings } from '@/hooks/useAdminSettings';
import { Copy, Upload } from 'lucide-react';

interface Transaction {
  id: string;
  transaction_id: string;
  amount: number;
  usdt_address: string;
  status: string;
  plan_id: string;
  subscription_plans: {
    name: string;
    duration_type: string;
  };
}

const Payment = () => {
  const { transactionId } = useParams<{ transactionId: string }>();
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [paymentProof, setPaymentProof] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const { getSetting: getAdminSetting } = useAdminSettings();
  const navigate = useNavigate();

  const USDT_ADDRESS = getAdminSetting('usdt_address', 'TQzjbHBa9ckat52PtVn7m2SSEM7dJXQ2uP');

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    if (transactionId) {
      fetchTransaction();
    }
  }, [transactionId, user, navigate]);

  const fetchTransaction = async () => {
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
        .eq('transaction_id', transactionId)
        .eq('user_id', user?.id)
        .single();

      if (error) throw error;
      
      // Update the USDT address in the transaction
      await supabase
        .from('transactions')
        .update({ usdt_address: USDT_ADDRESS })
        .eq('id', data.id);

      setTransaction({ ...data, usdt_address: USDT_ADDRESS });
    } catch (error) {
      toast({
        title: "Error",
        description: "Transaction not found",
        variant: "destructive",
      });
      navigate('/dashboard');
    } finally {
      setLoading(false);
    }
  };

  const copyAddress = () => {
    navigator.clipboard.writeText(USDT_ADDRESS);
    toast({
      title: "Address Copied",
      description: "USDT address copied to clipboard",
    });
  };

  const submitPaymentProof = async () => {
    if (!paymentProof.trim()) {
      toast({
        title: "Error",
        description: "Please provide payment proof",
        variant: "destructive",
      });
      return;
    }

    try {
      setSubmitting(true);
      
      if (!transaction?.id) {
        throw new Error('Transaction not found');
      }
      
      const { error } = await supabase
        .from('transactions')
        .update({ 
          payment_proof: paymentProof.trim(),
          status: 'proof_submitted'
        })
        .eq('id', transaction.id);

      if (error) {
        console.error('Payment proof submission error:', error);
        throw error;
      }

      toast({
        title: "Success",
        description: "Payment proof submitted successfully. We'll verify your payment shortly.",
      });

      navigate('/dashboard');
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to submit payment proof",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-xl text-muted-foreground">Loading transaction...</p>
        </div>
      </div>
    );
  }

  if (!transaction) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-xl text-muted-foreground">Transaction not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="container mx-auto px-4 max-w-2xl">
        <div className="mb-6">
          <Button variant="outline" onClick={() => navigate('/dashboard')}>
            ← Back to Dashboard
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Complete Your Payment</CardTitle>
            <CardDescription>
              <div className="mt-2 mb-2">
                <span className="font-semibold text-primary">Transaction ID:</span>
                <span className="font-mono ml-2 text-foreground">{transaction.transaction_id}</span>
              </div>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Info Message */}
            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100 rounded-lg p-3 text-sm">
              Please send the exact amount to the address below. Double-check the network and transaction ID. Your plan will be activated after payment is confirmed by admin.
            </div>
            {/* Plan Details */}
            <div className="bg-muted p-4 rounded-lg">
              <h3 className="font-semibold mb-2">Plan Details</h3>
              <div className="space-y-1 text-sm">
                <p><strong>Plan:</strong> {transaction.subscription_plans.name}</p>
                <p><strong>Duration:</strong> {transaction.subscription_plans.duration_type}</p>
                <p><strong>Amount:</strong> <span className="text-primary font-semibold">${transaction.amount} USDT</span></p>
              </div>
            </div>
            {/* Payment Address Section */}
            <div className="bg-card p-4 rounded-lg border">
              <h3 className="font-semibold mb-2">USDT-TRC20 Payment Address</h3>
              <div className="flex items-center gap-2 mt-2">
                <Input 
                  value={USDT_ADDRESS} 
                  readOnly 
                  className="font-mono text-base font-bold bg-muted text-primary"
                />
                <Button onClick={copyAddress} size="icon" variant="outline">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Network: <b>TRON (TRC20)</b> &nbsp; | &nbsp; Amount: <b>${transaction.amount} USDT</b>
              </p>
            </div>
            {/* Payment Proof */}
            <div>
              <Label htmlFor="payment-proof" className="text-base font-semibold">
                Payment Proof (Transaction Hash)
              </Label>
              <div className="mt-2">
                <Input
                  id="payment-proof"
                  placeholder="Enter transaction hash from your wallet"
                  value={paymentProof}
                  onChange={(e) => setPaymentProof(e.target.value)}
                />
                <p className="text-sm text-muted-foreground mt-1">
                  Copy the transaction hash from your USDT wallet after sending the payment
                </p>
              </div>
            </div>
            <Button 
              onClick={submitPaymentProof} 
              disabled={submitting || !paymentProof.trim()}
              className="w-full"
              size="lg"
            >
              <Upload className="h-4 w-4 mr-2" />
              {submitting ? 'Submitting...' : 'Submit Payment Proof'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Payment;
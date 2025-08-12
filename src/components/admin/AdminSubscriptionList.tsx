import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Calendar, User, DollarSign, Trash2, CheckCircle, Pause, Play, X, Check } from 'lucide-react';

interface Subscription {
  id: string;
  status: string;
  start_date: string;
  end_date: string;
  created_at: string;
  user_id: string;
  plan_id: string;
  transaction_id: string;
  user_email?: string;
  subscription_plans: {
    name: string;
    price: number;
    duration_type: string;
  };
  transactions: {
    transaction_id: string;
    amount: number;
    status: string;
  };
}

export const AdminSubscriptionList = () => {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchSubscriptions();
  }, []);

  const fetchSubscriptions = async () => {
    try {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select(`
          *,
          subscription_plans (
            name,
            price,
            duration_type
          ),
          transactions (
            transaction_id,
            amount,
            status
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Get user emails for each subscription
      const subscriptionsWithEmails = await Promise.all(
        (data || []).map(async (subscription) => {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('email')
            .eq('user_id', subscription.user_id)
            .single();
          
          return {
            ...subscription,
            user_email: profileData?.email || 'Unknown'
          };
        })
      );
      
      setSubscriptions(subscriptionsWithEmails);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch subscriptions",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const reactivateSubscription = async (subscriptionId: string) => {
    try {
      setProcessing(subscriptionId);

      const { error } = await supabase
        .from('user_subscriptions')
        .update({ 
          status: 'active'
        })
        .eq('id', subscriptionId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Subscription reactivated",
      });

      fetchSubscriptions();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to reactivate subscription",
        variant: "destructive",
      });
    } finally {
      setProcessing(null);
    }
  };

  const suspendSubscription = async (subscriptionId: string) => {
    try {
      setProcessing(subscriptionId);

      const { error } = await supabase
        .from('user_subscriptions')
        .update({ 
          status: 'suspended'
        })
        .eq('id', subscriptionId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Subscription suspended",
      });

      fetchSubscriptions();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to suspend subscription",
        variant: "destructive",
      });
    } finally {
      setProcessing(null);
    }
  };

  const cancelSubscription = async (subscriptionId: string) => {
    try {
      setProcessing(subscriptionId);

      const { error } = await supabase
        .from('user_subscriptions')
        .update({ 
          status: 'cancelled',
          end_date: new Date().toISOString()
        })
        .eq('id', subscriptionId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Subscription cancelled",
      });

      fetchSubscriptions();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to cancel subscription",
        variant: "destructive",
      });
    } finally {
      setProcessing(null);
    }
  };

  const approveSubscription = async (subscriptionId: string) => {
    try {
      setProcessing(subscriptionId);

      const { error } = await supabase
        .from('user_subscriptions')
        .update({ 
          status: 'active'
        })
        .eq('id', subscriptionId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Subscription approved",
      });

      fetchSubscriptions();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to approve subscription",
        variant: "destructive",
      });
    } finally {
      setProcessing(null);
    }
  };

  const rejectSubscription = async (subscriptionId: string) => {
    try {
      setProcessing(subscriptionId);

      const { error } = await supabase
        .from('user_subscriptions')
        .update({ 
          status: 'rejected'
        })
        .eq('id', subscriptionId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Subscription rejected",
      });

      fetchSubscriptions();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to reject subscription",
        variant: "destructive",
      });
    } finally {
      setProcessing(null);
    }
  };

  const getStatusBadge = (status: string, endDate: string) => {
    const isExpired = new Date(endDate) < new Date();
    
    if (status === 'cancelled') {
      return <Badge variant="destructive">Cancelled</Badge>;
    }
    
    if (status === 'rejected') {
      return <Badge variant="destructive">Rejected</Badge>;
    }
    
    if (status === 'pending') {
      return <Badge className="bg-yellow-500 text-white">Pending Approval</Badge>;
    }
    
    if (status === 'suspended') {
      return <Badge className="bg-orange-500 text-white">Suspended</Badge>;
    }
    
    if (isExpired) {
      return <Badge variant="secondary">Expired</Badge>;
    }
    
    if (status === 'active') {
      return <Badge className="bg-green-500 text-white">Active</Badge>;
    }
    
    return <Badge variant="outline">{status}</Badge>;
  };

  const isSubscriptionActive = (status: string, endDate: string) => {
    return status === 'active' && new Date(endDate) > new Date();
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Loading subscriptions...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Active Subscriptions</h2>
        <Button onClick={fetchSubscriptions} variant="outline">
          Refresh
        </Button>
      </div>

      {subscriptions.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No subscriptions found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {subscriptions.map((subscription) => (
            <Card key={subscription.id}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-lg">
                      {subscription.subscription_plans.name}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      {subscription.user_email}
                    </CardDescription>
                  </div>
                  {getStatusBadge(subscription.status, subscription.end_date)}
                </div>
              </CardHeader>
              
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <DollarSign className="h-4 w-4" />
                      <strong>Amount Paid:</strong>
                    </div>
                    <div>${subscription.transactions?.amount || subscription.subscription_plans.price}</div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      <strong>Duration:</strong>
                    </div>
                    <div className="capitalize">{subscription.subscription_plans.duration_type}</div>
                  </div>
                  <div>
                    <strong>Start Date:</strong>
                    <div>{new Date(subscription.start_date).toLocaleDateString()}</div>
                  </div>
                  <div>
                    <strong>End Date:</strong>
                    <div>{new Date(subscription.end_date).toLocaleDateString()}</div>
                  </div>
                </div>

                {subscription.transactions?.transaction_id && (
                  <div className="text-sm">
                    <strong>Transaction ID:</strong>
                    <div className="font-mono">{subscription.transactions.transaction_id}</div>
                  </div>
                )}

                <div className="flex gap-2 flex-wrap">
                  {subscription.status === 'pending' && (
                    <>
                      <Button
                        onClick={() => approveSubscription(subscription.id)}
                        disabled={processing === subscription.id}
                        variant="outline"
                        size="sm"
                        className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
                      >
                        <Check className="h-4 w-4 mr-2" />
                        {processing === subscription.id ? 'Approving...' : 'Approve'}
                      </Button>
                      <Button
                        onClick={() => rejectSubscription(subscription.id)}
                        disabled={processing === subscription.id}
                        variant="destructive"
                        size="sm"
                      >
                        <X className="h-4 w-4 mr-2" />
                        {processing === subscription.id ? 'Rejecting...' : 'Reject'}
                      </Button>
                    </>
                  )}

                  {subscription.status === 'active' && (
                    <Button
                      onClick={() => suspendSubscription(subscription.id)}
                      disabled={processing === subscription.id}
                      variant="outline"
                      size="sm"
                      className="bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100"
                    >
                      <Pause className="h-4 w-4 mr-2" />
                      {processing === subscription.id ? 'Suspending...' : 'Suspend'}
                    </Button>
                  )}
                  
                  {subscription.status === 'suspended' && (
                    <Button
                      onClick={() => reactivateSubscription(subscription.id)}
                      disabled={processing === subscription.id}
                      variant="outline"
                      size="sm"
                      className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
                    >
                      <Play className="h-4 w-4 mr-2" />
                      {processing === subscription.id ? 'Reactivating...' : 'Reactivate'}
                    </Button>
                  )}
                  
                  {(subscription.status === 'active' || subscription.status === 'suspended') && (
                    <Button
                      onClick={() => cancelSubscription(subscription.id)}
                      disabled={processing === subscription.id}
                      variant="destructive"
                      size="sm"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      {processing === subscription.id ? 'Cancelling...' : 'Cancel'}
                    </Button>
                  )}
                </div>

                <div className="text-xs text-muted-foreground">
                  Created: {new Date(subscription.created_at).toLocaleString()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
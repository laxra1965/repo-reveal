import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { ArbitrageScanner } from '@/components/arbitrage/ArbitrageScanner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Crown } from 'lucide-react';

const Dashboard = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const { hasActiveSubscription, subscription, loading: subscriptionLoading } = useSubscription();
  const navigate = useNavigate();

  // Redirect to /auth if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  // Determine the overall loading state
  const isLoading = authLoading || subscriptionLoading;

  // If still loading authentication or subscription, show loading indicator
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-xl text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // If user is not logged in (after loading is false), redirect will handle it.
  // This check is technically redundant if the useEffect handles redirection,
  // but it's good for clarity if the redirect logic were to change.
  if (!user) {
    return null; // Or navigate('/auth') explicitly here if preferred
  }

  // Conditional rendering based on subscription status
  // This part is inspired by the second component's logic:
  if (!hasActiveSubscription) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
        <div className="text-center max-w-md">
          <h1 className="text-3xl font-bold mb-4 text-primary">Subscription Required</h1>
          <p className="text-lg text-muted-foreground mb-6">
            Your subscription is not active. Please complete payment and wait for admin approval to access the Arbitrage Scanner.
          </p>
          <Button onClick={() => navigate('/pricing')}>Upgrade Now</Button> {/* Example: navigate to a pricing page */}
        </div>
      </div>
    );
  }

  // Render the full dashboard if the user is authenticated and has an active subscription
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Arbitrage Scanner</h1>
            {/* Badge can still be shown, but its logic might need refinement if it's always "active" here */}
            <Badge variant="default" className="flex items-center gap-1">
              <Crown className="h-3 w-3" />
              {subscription?.subscription_plans.name || "Premium"} {/* Assuming subscription is available here */}
            </Badge>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              Welcome, {user.email}
            </span>
            {subscription && ( // Show expiry only if subscription data is available
              <span className="text-xs text-muted-foreground">
                Expires: {new Date(subscription.end_date).toLocaleDateString()}
              </span>
            )}
            <Button variant="outline" onClick={signOut}>
              Sign Out
            </Button>
          </div>
        </div>
      </header>
      
      <main className="container mx-auto px-4 py-8">
        <ArbitrageScanner />
      </main>
    </div>
  );
};

export default Dashboard;
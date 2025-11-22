import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { ArbitrageScanner } from '@/components/arbitrage/ArbitrageScanner';
import { StatisticsDashboard } from '@/components/dashboard/StatisticsDashboard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Crown, History } from 'lucide-react';

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
        <div className="absolute top-4 right-4">
          <Button variant="outline" onClick={signOut}>
            Sign Out
          </Button>
        </div>
        <div className="text-center max-w-md">
          <h1 className="text-3xl font-bold mb-4 text-primary">Subscription Required</h1>
          <p className="text-lg text-muted-foreground mb-6">
            Your subscription is not active. Please complete payment and wait for admin approval to access the Arbitrage Scanner.
          </p>
          <Button onClick={() => navigate('/pricing')}>Upgrade Now</Button>
        </div>
      </div>
    );
  }

  const getInitials = (email: string) => {
    return email.substring(0, 2).toUpperCase();
  };

  // Render the full dashboard if the user is authenticated and has an active subscription
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Arbitrage Scanner</h1>
            <Badge variant="default" className="flex items-center gap-1">
              <Crown className="h-3 w-3" />
              {subscription?.subscription_plans.name || "Premium"}
            </Badge>
          </div>
          <div className="flex items-center gap-4">
            {subscription && (
              <span className="text-xs text-muted-foreground">
                Expires: {new Date(subscription.end_date).toLocaleDateString()}
              </span>
            )}
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => navigate('/trade-history')}
              className="flex items-center gap-2"
            >
              <History className="h-4 w-4" />
              Trade History
            </Button>
            <Avatar 
              className="h-10 w-10 cursor-pointer hover:opacity-80 transition-opacity" 
              onClick={() => navigate('/profile')}
            >
              <AvatarImage src="" alt={user.email} />
              <AvatarFallback>{getInitials(user.email || '')}</AvatarFallback>
            </Avatar>
            <Button variant="outline" onClick={signOut}>
              Sign Out
            </Button>
          </div>
        </div>
      </header>
      
      <main className="container mx-auto px-4 py-8 space-y-6">
        <StatisticsDashboard />
        <ArbitrageScanner />
      </main>
    </div>
  );
};

export default Dashboard;
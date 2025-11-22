// src/pages/Dashboard.tsx - Improved version
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
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
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // Only redirect after loading is complete
    if (!authLoading && !subscriptionLoading) {
      setIsInitialized(true);
      if (!user) {
        navigate('/auth', { replace: true });
      }
    }
  }, [user, authLoading, subscriptionLoading, navigate]);

  // Show loading state while checking auth
  if (authLoading || subscriptionLoading || !isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-xl text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // Don't render anything if not authenticated (redirect will happen)
  if (!user) {
    return null;
  }

  // Show subscription required screen
  if (!hasActiveSubscription) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
        <div className="absolute top-4 right-4">
          <Button variant="outline" onClick={signOut}>
            Sign Out
          </Button>
        </div>
        <div className="text-center max-w-md">
          <Crown className="h-16 w-16 text-yellow-500 mx-auto mb-4" />
          <h1 className="text-3xl font-bold mb-4 text-primary">Subscription Required</h1>
          <p className="text-lg text-muted-foreground mb-6">
            Your subscription is not active. Please complete payment and wait for admin approval to access the Arbitrage Scanner.
          </p>
          <Button onClick={() => navigate('/pricing')} size="lg">
            View Plans
          </Button>
        </div>
      </div>
    );
  }

  const getInitials = (email: string) => {
    return email.substring(0, 2).toUpperCase();
  };

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

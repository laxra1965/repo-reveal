import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { ArbitrageScanner } from '@/components/arbitrage/ArbitrageScanner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Crown } from 'lucide-react';

const Dashboard = () => {
  const { user, loading, signOut } = useAuth();
  const { hasActiveSubscription, subscription, loading: subscriptionLoading } = useSubscription();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-xl text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Arbitrage Scanner</h1>
            {!subscriptionLoading && (
              <Badge variant={hasActiveSubscription ? "default" : "secondary"} className="flex items-center gap-1">
                <Crown className="h-3 w-3" />
                {hasActiveSubscription ? subscription?.subscription_plans.name || "Premium" : "No Subscription"}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              Welcome, {user.email}
            </span>
            {hasActiveSubscription && subscription && (
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
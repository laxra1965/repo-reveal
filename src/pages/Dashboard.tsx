import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { ArbitrageScanner } from '@/components/arbitrage/ArbitrageScanner';
import { StatisticsDashboard } from '@/components/dashboard/StatisticsDashboard';
import { SystemHealthStatus } from '@/components/dashboard/SystemHealthStatus';
import { LiveMetricsPanel } from '@/components/dashboard/LiveMetricsPanel';
import { VPSHealthMonitor } from '@/components/dashboard/VPSHealthMonitor';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Crown, History, Bot, Zap } from 'lucide-react';

const Dashboard = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const { hasActiveSubscription, subscription, loading: subscriptionLoading } = useSubscription();
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const navigate = useNavigate();

  // Redirect to /auth if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  // Redirect Admin to /admin (Admins should not use User Dashboard)
  useEffect(() => {
    if (!adminLoading && isAdmin) {
      navigate('/admin');
    }
  }, [isAdmin, adminLoading, navigate]);

  // Determine the overall loading state
  const isLoading = authLoading || subscriptionLoading || adminLoading;

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
  // Admin users bypass subscription check
  if (!hasActiveSubscription && !isAdmin) {
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
      <header className="border-b bg-card/30 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg premium-gradient flex items-center justify-center shadow-lg shadow-primary/20">
                <Zap className="h-5 w-5 text-black" />
              </div>
              <h1 className="text-xl font-black tracking-tighter uppercase px-1">
                Arb<span className="text-primary/60">Surge</span>
              </h1>
            </div>
            <div className="hidden md:flex items-center gap-2 border-l pl-6 border-primary/10">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-70">
                Global Surveillance Active
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <nav className="hidden lg:flex items-center gap-1 mr-4">
              <Button variant="ghost" size="sm" onClick={() => navigate('/auto-trade')} className="text-[11px] font-bold uppercase tracking-wider gap-2">
                <Bot className="h-4 w-4" />
                Auto-Pilot
              </Button>
              <Button variant="ghost" size="sm" onClick={() => navigate('/trade-history')} className="text-[11px] font-bold uppercase tracking-wider gap-2">
                <History className="h-4 w-4" />
                History
              </Button>
            </nav>

            <div className="h-8 w-[1px] bg-primary/10 mx-2 hidden sm:block" />

            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter">{user.email}</div>
                <div className="text-[11px] font-black text-primary">{subscription?.subscription_plans.name || "BASIC"} NODE</div>
              </div>
              <Avatar
                className="h-9 w-9 border-2 border-primary/20 cursor-pointer hover:border-primary transition-all shadow-md"
                onClick={() => navigate('/profile')}
              >
                <AvatarFallback className="bg-primary text-black font-bold text-xs">{getInitials(user.email || '')}</AvatarFallback>
              </Avatar>
              <Button variant="outline" size="sm" onClick={signOut} className="text-[10px] font-bold uppercase border-primary/20">
                Exit
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-8 animate-in">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <SystemHealthStatus />
          </div>
          <LiveMetricsPanel />
        </div>
        
        {/* VPS Health Section */}
        <VPSHealthMonitor />
        
        <StatisticsDashboard />
        <ArbitrageScanner />
      </main>
    </div>
  );
};

export default Dashboard;
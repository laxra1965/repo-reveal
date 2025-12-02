import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Crown, ArrowLeft, Bot, BarChart3, Activity } from 'lucide-react';
import { AutoTradeMonitor } from '@/components/autotrade/AutoTradeMonitor';
import { AutoTradeAnalytics } from '@/components/autotrade/AutoTradeAnalytics';

const AutoTrade = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const { hasActiveSubscription, subscription, loading: subscriptionLoading } = useSubscription();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  const isLoading = authLoading || subscriptionLoading;

  if (isLoading) {
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
            You need an active subscription to access Auto Trading features.
          </p>
          <Button onClick={() => navigate('/pricing')}>Upgrade Now</Button>
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
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => navigate('/dashboard')}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Dashboard
            </Button>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Bot className="h-6 w-6" />
                Auto Trade
              </h1>
              <Badge variant="default" className="flex items-center gap-1">
                <Crown className="h-3 w-3" />
                {subscription?.subscription_plans.name || "Premium"}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {subscription && (
              <span className="text-xs text-muted-foreground">
                Expires: {new Date(subscription.end_date).toLocaleDateString()}
              </span>
            )}
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
      
      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="monitor" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="monitor" className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Monitor
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Analytics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="monitor">
            <AutoTradeMonitor />
          </TabsContent>

          <TabsContent value="analytics">
            <AutoTradeAnalytics />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default AutoTrade;

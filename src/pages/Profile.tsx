import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { ProfileSection } from '@/components/profile/ProfileSection';
import { ExchangeCredentialsManager } from '@/components/profile/ExchangeCredentialsManager';
import { EnabledExchangesManager } from '@/components/profile/EnabledExchangesManager';
import { CredentialsMigrationPanel } from '@/components/profile/CredentialsMigrationPanel';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ArrowLeft } from 'lucide-react';

const Profile = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const { subscription, loading: subscriptionLoading } = useSubscription();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading]);

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

  const getInitials = (email: string) => {
    return email.substring(0, 2).toUpperCase();
  };

  return (
    <div className="min-h-screen bg-background antialiased">
      <header className="border-b bg-card/30 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Button variant="ghost" onClick={() => navigate('/dashboard')} className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider">
            <ArrowLeft className="h-4 w-4" />
            Control Center
          </Button>
          <Button variant="outline" size="sm" onClick={signOut} className="text-[10px] font-bold uppercase border-primary/20">
            Exit
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl space-y-8 animate-in">
        <div className="flex items-center gap-6 p-6 glass-card border-primary/10 rounded-2xl mb-8 overflow-hidden relative">
          <div className="absolute top-0 left-0 w-2 h-full premium-gradient" />
          <Avatar className="h-20 w-20 border-4 border-primary/10 shadow-2xl">
            <AvatarFallback className="text-3xl font-black premium-gradient text-black">{getInitials(user.email || '')}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-4xl font-black tracking-tighter uppercase">Identity</h1>
            <p className="text-sm font-bold text-muted-foreground tracking-widest opacity-60 mt-1">{user.email}</p>
          </div>
        </div>

        <div className="space-y-8">
          <ProfileSection subscription={subscription} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-8">
              <EnabledExchangesManager />
            </div>
            <div className="space-y-8">
              <CredentialsMigrationPanel />
            </div>
          </div>

          <ExchangeCredentialsManager />
        </div>
      </main>
    </div>
  );
};

export default Profile;

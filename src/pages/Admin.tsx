import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdminTransactionList } from '@/components/admin/AdminTransactionList';
import { AdminSubscriptionList } from '@/components/admin/AdminSubscriptionList';
import { AdminUsersList } from '@/components/admin/AdminUsersList';
import { AdminSystemMaintenance } from '@/components/admin/AdminSystemMaintenance';
import { ArrowLeft, Settings, CreditCard, Users, Shield, UserCog, Wrench } from 'lucide-react';

const ADMIN_EMAILS = ['laxracorp@gmail.com', 'admin@arbitrage.com'];

const Admin = () => {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  
  const isAdmin = user?.email && ADMIN_EMAILS.includes(user.email);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    } else if (!loading && user && !isAdmin) {
      // Handle non-admin users in effect, not render
      return;
    }
  }, [user, loading, navigate, isAdmin]);

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
    return null; // useEffect will handle navigation
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Shield className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
          <p className="text-xl text-muted-foreground mb-4">Access Denied</p>
          <p className="text-sm text-muted-foreground mb-4">You don't have permission to access this page.</p>
          <Button onClick={() => navigate('/dashboard')}>
            Go to Dashboard
          </Button>
        </div>
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => navigate('/dashboard')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Button>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Settings className="h-6 w-6" />
              Admin Panel
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {user.email}
            </span>
            <Button variant="outline" onClick={signOut}>
              Sign Out
            </Button>
          </div>
        </div>
      </header>
      
      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="users" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="users" className="flex items-center gap-2">
              <UserCog className="h-4 w-4" />
              All Users
            </TabsTrigger>
            <TabsTrigger value="subscriptions" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Subscription Requests
            </TabsTrigger>
            <TabsTrigger value="transactions" className="flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Transactions
            </TabsTrigger>
            <TabsTrigger value="maintenance" className="flex items-center gap-2">
              <Wrench className="h-4 w-4" />
              Maintenance
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="users">
            <AdminUsersList />
          </TabsContent>
          
          <TabsContent value="subscriptions">
            <AdminSubscriptionList />
          </TabsContent>
          
          <TabsContent value="transactions">
            <AdminTransactionList />
          </TabsContent>
          
          <TabsContent value="maintenance">
            <AdminSystemMaintenance />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Admin;
import { useAuth } from '@/hooks/useAuth';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AdminTransactionList } from '@/components/admin/AdminTransactionList';
import { AdminSubscriptionList } from '@/components/admin/AdminSubscriptionList';
import { AdminUsersList } from '@/components/admin/AdminUsersList';
import { AdminSystemMaintenance } from '@/components/admin/AdminSystemMaintenance';
import { AdminPlanManagement } from '@/components/admin/AdminPlanManagement';
import { AdminSystemConfig } from '@/components/admin/AdminSystemConfig';
import { AdminSecurityDashboard } from '@/components/admin/AdminSecurityDashboard';
import { AdminOnboardingTour } from '@/components/admin/AdminOnboardingTour';
import { SystemHealthStatus } from '@/components/dashboard/SystemHealthStatus';
import { LiveMetricsPanel } from '@/components/dashboard/LiveMetricsPanel';
import { VPSHealthMonitor } from '@/components/dashboard/VPSHealthMonitor';
import { ArrowLeft, Settings, CreditCard, Users, Shield, UserCog, Wrench, Package, Cpu, ShieldCheck, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

const Admin = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const navigate = useNavigate();
  const location = useLocation();

  const loading = authLoading || adminLoading;

  // Get current tab from URL hash or default to users
  const currentTab = location.hash.replace('#', '') || 'users';

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    } else if (!loading && user && !isAdmin) {
      // Handle non-admin users in effect, not render
      return;
    }
  }, [user, loading, navigate, isAdmin]);

  // Set default hash on initial load
  useEffect(() => {
    if (!location.hash && !loading && user && isAdmin) {
      navigate('/admin#users', { replace: true });
    }
  }, [location.hash, loading, user, isAdmin, navigate]);

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

  // Monitoring tab component combining all system health panels
  const AdminMonitoring = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <SystemHealthStatus />
        </div>
        <LiveMetricsPanel />
      </div>
      <VPSHealthMonitor />
    </div>
  );

  const navItems = [
    { id: 'users', label: 'Users', icon: UserCog, component: AdminUsersList },
    { id: 'subscriptions', label: 'Subscriptions', icon: Users, component: AdminSubscriptionList },
    { id: 'plans', label: 'Plans', icon: Package, component: AdminPlanManagement },
    { id: 'transactions', label: 'Transactions', icon: CreditCard, component: AdminTransactionList },
    { id: 'monitoring', label: 'Monitoring', icon: Activity, component: AdminMonitoring },
    { id: 'security', label: 'Security', icon: ShieldCheck, component: AdminSecurityDashboard },
    { id: 'maintenance', label: 'Maintenance', icon: Wrench, component: AdminSystemMaintenance },
    { id: 'config', label: 'Config', icon: Cpu, component: AdminSystemConfig },
  ];

  const handleTabChange = (tabId: string) => {
    navigate(`/admin#${tabId}`, { replace: true });
  };

  const CurrentComponent = navItems.find(item => item.id === currentTab)?.component || AdminUsersList;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/30 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Dashboard
              </Button>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Admin Panel
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground hidden sm:block">
                {user.email}
              </span>
              <Button variant="outline" size="sm" onClick={signOut}>
                Sign Out
              </Button>
            </div>
          </div>
          
          {/* Navigation Bar */}
          <nav className="flex items-center gap-1 overflow-x-auto pb-2 scrollbar-hide">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <Button
                  key={item.id}
                  variant={isActive ? "default" : "ghost"}
                  size="sm"
                  onClick={() => handleTabChange(item.id)}
                  className={cn(
                    "flex items-center gap-2 whitespace-nowrap",
                    isActive && "bg-primary text-primary-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </Button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <AdminOnboardingTour onNavigate={handleTabChange} />
        <CurrentComponent />
      </main>
    </div>
  );
};

export default Admin;
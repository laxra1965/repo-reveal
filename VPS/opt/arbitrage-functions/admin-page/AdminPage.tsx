import { useState, useEffect } from 'react';
import { AdminFilterManager } from './components/AdminFilterManager';
import { TradingExecutionManager } from './components/TradingExecutionManager';
import { LayoutDashboard, Filter, Activity } from 'lucide-react';

/**
 * Main Admin Page
 */
export const AdminPage = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ email?: string; id?: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'filters' | 'execution'>('filters');

  // Initialize Supabase auth on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { supabase } = await import('./supabaseClient');
        const { data: { user } } = await supabase.auth.getUser();
        
        if (user) {
          const isAdmin = user?.user_metadata?.is_admin === true;
          if (isAdmin) {
            setUser(user);
            setIsAuthenticated(true);
          } else {
            setIsAuthenticated(false);
            alert('Access denied: Admin privileges required');
          }
        }
      } catch (error) {
        console.error('Auth check failed:', error);
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="text-white text-lg">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="bg-red-900/20 border border-red-700 p-6 rounded-lg text-white max-w-md w-full">
          <h2 className="text-xl font-bold mb-2">Access Denied</h2>
          <p className="mb-4">You must be logged in as an admin to access this page.</p>
          <a href="/auth" className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded inline-block w-full text-center font-medium">
            Go to Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 font-sans">
      {/* Header */}
      <header className="bg-slate-900/50 backdrop-blur-md border-b border-slate-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Triangular Arbitrage</h1>
              <p className="text-[10px] text-blue-400 uppercase tracking-widest font-bold">Admin Control Center</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-xs text-slate-400">Connected Account</p>
              <p className="text-sm font-mono text-slate-200">{user?.email}</p>
            </div>
            <div className="h-8 w-px bg-slate-800" />
            <button 
              onClick={async () => {
                const { supabase } = await import('./supabaseClient');
                await supabase.auth.signOut();
                window.location.reload();
              }}
              className="text-xs text-slate-400 hover:text-white transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="bg-slate-900 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-8">
            <button 
              onClick={() => setActiveTab('filters')}
              className={`py-4 text-sm font-medium border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'filters' 
                  ? 'border-blue-500 text-blue-400' 
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Filter className="w-4 h-4" />
              Opportunity Filters
            </button>
            <button 
              onClick={() => setActiveTab('execution')}
              className={`py-4 text-sm font-medium border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'execution' 
                  ? 'border-blue-500 text-blue-400' 
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              Trading Execution
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          {activeTab === 'filters' ? (
            <AdminFilterManager />
          ) : (
            <TradingExecutionManager />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 py-8 text-xs text-slate-500 border-t border-slate-900 mt-auto">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <p>© 2026 Triangular Arbitrage Bot | Hetzner VPS Instance</p>
          <div className="flex gap-4">
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              System Online
            </span>
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              Paper Mode Active
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default AdminPage;

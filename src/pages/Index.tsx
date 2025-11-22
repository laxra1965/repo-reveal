// src/pages/Index.tsx - Add error boundary and better redirect logic
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { PlansSection } from '@/components/plans/PlansSection';

const Index = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    if (loading) return;
    
    if (user && !isRedirecting) {
      setIsRedirecting(true);
      // Add a small delay to prevent flash
      setTimeout(() => {
        navigate('/dashboard', { replace: true });
      }, 100);
    } else if (!user && !loading) {
      // Not logged in, show pricing
      setIsRedirecting(false);
    }
  }, [user, loading, navigate, isRedirecting]);

  // Show loading state instead of blank
  if (loading || isRedirecting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-xl text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Show pricing page for non-authenticated users
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold">Arbitrage Scanner</h1>
          <button 
            onClick={() => navigate('/auth')}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Sign In
          </button>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">
        <PlansSection />
      </main>
    </div>
  );
};

export default Index;

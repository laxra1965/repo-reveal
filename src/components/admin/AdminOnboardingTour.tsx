import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, Circle, Users, CreditCard, Package, ArrowRight, X, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface CheckItem {
  id: string;
  label: string;
  description: string;
  tab: string;
  icon: React.ElementType;
  check: () => Promise<boolean>;
}

interface AdminOnboardingTourProps {
  onNavigate: (tab: string) => void;
}

export const AdminOnboardingTour = ({ onNavigate }: AdminOnboardingTourProps) => {
  const [dismissed, setDismissed] = useState(false);
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const checks: CheckItem[] = [
    {
      id: 'users',
      label: 'Review registered users',
      description: 'Check that user accounts are appearing correctly.',
      tab: 'users',
      icon: Users,
      check: async () => {
        const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true });
        return (count ?? 0) > 0;
      },
    },
    {
      id: 'plans',
      label: 'Verify subscription plans',
      description: 'Ensure at least one active plan exists for users to purchase.',
      tab: 'plans',
      icon: Package,
      check: async () => {
        const { count } = await supabase.from('subscription_plans').select('id', { count: 'exact', head: true }).eq('active', true);
        return (count ?? 0) > 0;
      },
    },
    {
      id: 'subscriptions',
      label: 'Check active subscriptions',
      description: 'See if any users have subscribed to a plan.',
      tab: 'subscriptions',
      icon: CreditCard,
      check: async () => {
        const { count } = await supabase.from('user_subscriptions').select('id', { count: 'exact', head: true });
        return (count ?? 0) > 0;
      },
    },
    {
      id: 'transactions',
      label: 'Review transactions',
      description: 'Confirm the payment flow is generating transaction records.',
      tab: 'transactions',
      icon: CreditCard,
      check: async () => {
        const { count } = await supabase.from('transactions').select('id', { count: 'exact', head: true });
        return (count ?? 0) > 0;
      },
    },
  ];

  useEffect(() => {
    const stored = localStorage.getItem('admin_onboarding_dismissed');
    if (stored === 'true') {
      setDismissed(true);
      setLoading(false);
      return;
    }

    const runChecks = async () => {
      const results: Record<string, boolean> = {};
      await Promise.all(
        checks.map(async (c) => {
          try {
            results[c.id] = await c.check();
          } catch {
            results[c.id] = false;
          }
        })
      );
      setCompleted(results);
      setLoading(false);
    };

    runChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDismiss = () => {
    localStorage.setItem('admin_onboarding_dismissed', 'true');
    setDismissed(true);
  };

  if (dismissed || loading) return null;

  const doneCount = Object.values(completed).filter(Boolean).length;
  const total = checks.length;
  const allDone = doneCount === total;
  const progressPct = Math.round((doneCount / total) * 100);

  return (
    <Card className="mb-6 border-primary/30 bg-card shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Admin Onboarding</CardTitle>
            <Badge variant="secondary" className="ml-2 text-xs">
              {doneCount}/{total} complete
            </Badge>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDismiss} aria-label="Dismiss onboarding">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <Progress value={progressPct} className="mt-2 h-2" />
      </CardHeader>
      <CardContent className="pt-0">
        {allDone ? (
          <p className="text-sm text-muted-foreground">
            🎉 All checks passed! Your admin dashboard is ready. You can dismiss this banner.
          </p>
        ) : (
          <ul className="space-y-3">
            {checks.map((item) => {
              const done = completed[item.id];
              const Icon = item.icon;
              return (
                <li key={item.id} className="flex items-start gap-3">
                  {done ? (
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                      {item.label}
                    </p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                  {!done && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 gap-1"
                      onClick={() => onNavigate(item.tab)}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      Go
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};

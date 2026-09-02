import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Bot, History, User, Shield } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { cn } from '@/lib/utils';

const HIDDEN_ROUTES = ['/', '/auth', '/admin-login', '/pricing'];

/**
 * Bottom tab bar for the Android/mobile shell so the app exposes the same
 * dashboard surfaces as the web app instead of stopping at the login screen.
 */
export const MobileNav = () => {
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const location = useLocation();

  if (!user) return null;
  if (HIDDEN_ROUTES.includes(location.pathname)) return null;

  const items = [
    { to: '/dashboard', label: 'Scanner', icon: LayoutDashboard },
    { to: '/auto-trade', label: 'Auto-Pilot', icon: Bot },
    { to: '/trade-history', label: 'History', icon: History },
    { to: '/profile', label: 'Settings', icon: User },
    ...(isAdmin ? [{ to: '/admin', label: 'Trade Ops', icon: Shield }] : []),
  ];

  return (
    <>
      <div className="h-20 lg:hidden" aria-hidden="true" />
      <nav
        aria-label="Primary"
        className="fixed bottom-0 inset-x-0 z-50 lg:hidden border-t border-primary/10 bg-card/90 backdrop-blur-xl"
      >
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
          {items.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-bold uppercase tracking-tight transition-colors',
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  )
                }
              >
                <Icon className="h-5 w-5" />
                <span>{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </nav>
    </>
  );
};

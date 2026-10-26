import React from 'react';
import { cn } from '@/lib/utils';

const Switch = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { checked?: boolean; onCheckedChange?: (checked: boolean) => void }
>(({ className, checked, onCheckedChange, ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-50',
      checked ? 'bg-slate-50' : 'bg-slate-700',
      className
    )}
    role="switch"
    aria-checked={checked}
    onClick={() => onCheckedChange?.(!checked)}
    {...props}
  >
    <span
      className={cn(
        'pointer-events-none block h-5 w-5 rounded-full bg-slate-800 shadow-lg ring-0 transition-transform',
        checked ? 'translate-x-5' : 'translate-x-0'
      )}
    />
  </button>
));
Switch.displayName = 'Switch';

export { Switch };

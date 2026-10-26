import React from 'react';
import { cn } from '@/lib/utils';

const Badge = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    variant?: 'default' | 'secondary' | 'destructive' | 'outline';
  }
>(({ className, variant = 'default', ...props }, ref) => {
  const variants = {
    default: 'border-transparent bg-slate-50 text-slate-950',
    secondary: 'border-transparent bg-slate-700 text-slate-50',
    destructive: 'border-transparent bg-red-600 text-slate-50',
    outline: 'text-slate-50 border-slate-600',
  };

  return (
    <div
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-900',
        variants[variant],
        className
      )}
      {...props}
    />
  );
});
Badge.displayName = 'Badge';

export { Badge };

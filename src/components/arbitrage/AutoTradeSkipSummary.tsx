import { memo } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import type { SkipReason } from '@/lib/opportunityEligibility';

export interface SkipEntry {
  opportunityId?: string;
  reason: SkipReason;
  count?: number;
}

interface Props {
  /** Reasons opportunities were filtered out of auto trading. */
  skipped: SkipEntry[];
  /** Blocking configuration error that stops every trade (paper and live). */
  blocking?: SkipReason | null;
  mode: 'paper' | 'live';
}

/**
 * Shows exactly why auto trades were skipped or blocked: which field and which
 * validation rule failed, grouped by field so the list stays readable.
 */
export const AutoTradeSkipSummary = memo(({ skipped, blocking, mode }: Props) => {
  if (!blocking && skipped.length === 0) return null;

  const grouped = new Map<string, { reason: SkipReason; count: number }>();
  for (const entry of skipped) {
    const key = `${entry.reason.field}|${entry.reason.rule}`;
    const existing = grouped.get(key);
    if (existing) existing.count += entry.count ?? 1;
    else grouped.set(key, { reason: entry.reason, count: entry.count ?? 1 });
  }

  return (
    <div className="space-y-2">
      {blocking && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            Auto trade blocked ({mode} mode) — {blocking.field}
          </AlertTitle>
          <AlertDescription className="space-y-1">
            <p>{blocking.message}</p>
            <p className="text-xs opacity-80">Rule: {blocking.rule}</p>
          </AlertDescription>
        </Alert>
      )}

      {grouped.size > 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Skipped opportunities ({mode} mode)</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-1.5">
              {Array.from(grouped.values()).map(({ reason, count }) => (
                <li key={`${reason.field}-${reason.rule}`} className="text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {reason.field}
                    </Badge>
                    <Badge variant={reason.source === 'configuration' ? 'secondary' : 'outline'} className="text-[10px]">
                      {reason.source}
                    </Badge>
                    <span className="text-muted-foreground">x{count}</span>
                  </div>
                  <p className="mt-0.5">{reason.message}</p>
                  <p className="opacity-70">Rule: {reason.rule}</p>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
});

AutoTradeSkipSummary.displayName = 'AutoTradeSkipSummary';

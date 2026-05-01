import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { Server, Cloud, Loader2 } from 'lucide-react';

type Status = 'checking' | 'online' | 'offline';

const PING_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 5_000;

async function pingVps(): Promise<boolean> {
  const url = import.meta.env.VITE_FUNCTIONS_URL;
  if (!url) return false;
  try {
    const res = await fetch(`${url}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function pingEdge(): Promise<boolean> {
  try {
    // Lightweight no-op invocation; rate-limiter responds quickly
    const { error } = await supabase.functions.invoke('rate-limiter', {
      body: { action: 'ping' },
    });
    // Even non-2xx responses prove reachability
    return error == null || (error as any)?.context?.status != null;
  } catch {
    return false;
  }
}

export const ExecutionRouteIndicator = () => {
  const [vps, setVps] = useState<Status>('checking');
  const [edge, setEdge] = useState<Status>('checking');
  const vpsConfigured = Boolean(import.meta.env.VITE_FUNCTIONS_URL);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const [vpsOk, edgeOk] = await Promise.all([
        vpsConfigured ? pingVps() : Promise.resolve(false),
        pingEdge(),
      ]);
      if (cancelled) return;
      setVps(vpsConfigured ? (vpsOk ? 'online' : 'offline') : 'offline');
      setEdge(edgeOk ? 'online' : 'offline');
    };

    check();
    const id = setInterval(check, PING_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [vpsConfigured]);

  const activeRoute =
    vps === 'online' ? 'VPS' : edge === 'online' ? 'Edge Function' : 'None';

  const dot = (s: Status) =>
    s === 'checking'
      ? 'bg-muted-foreground animate-pulse'
      : s === 'online'
      ? 'bg-green-500'
      : 'bg-red-500';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 px-2 py-1 rounded-md border border-primary/10 bg-card/60">
            <div className="flex items-center gap-1.5">
              <Server className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                VPS
              </span>
              {vps === 'checking' ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
              ) : (
                <span className={`w-2 h-2 rounded-full ${dot(vps)}`} />
              )}
            </div>
            <span className="text-muted-foreground/40">·</span>
            <div className="flex items-center gap-1.5">
              <Cloud className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Edge
              </span>
              {edge === 'checking' ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
              ) : (
                <span className={`w-2 h-2 rounded-full ${dot(edge)}`} />
              )}
            </div>
            <Badge
              variant="outline"
              className="ml-1 text-[9px] uppercase font-bold border-primary/20"
            >
              {activeRoute}
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs max-w-xs">
          <div className="space-y-1">
            <div>
              <strong>Execution route:</strong> trades try VPS first, then fall
              back to the Supabase Edge Function.
            </div>
            <div>
              VPS:{' '}
              {!vpsConfigured
                ? 'not configured'
                : vps === 'online'
                ? 'reachable'
                : 'unreachable'}
            </div>
            <div>Edge Function: {edge === 'online' ? 'reachable' : 'unreachable'}</div>
            <div className="text-muted-foreground">
              Active route: <strong>{activeRoute}</strong>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

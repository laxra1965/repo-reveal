import { memo } from 'react';
import { Activity } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useBrowserScanner } from '@/hooks/useBrowserScanner';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const BrowserScannerPanel = memo(() => {
  const scanner = useBrowserScanner();
  const price = (n: number | null) => n === null ? 'Unavailable' : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <section className="border-y py-5 space-y-4" aria-label="Browser scanner">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><Activity className="h-5 w-5" />Browser scanner</h2>
      <div className="flex items-center gap-3"><Label htmlFor="browser-scanner">Scan in browser</Label><Switch id="browser-scanner" checked={scanner.enabled} onCheckedChange={scanner.toggle} /><Button asChild variant="outline" size="sm"><Link to="/live-trades">Live trades</Link></Button></div>
    </div>
    <div className="grid gap-4 sm:grid-cols-3">
      {scanner.feeds.map((feed) => <div key={feed.exchange} className="border rounded-md p-3 space-y-2">
        <div className="flex justify-between gap-2"><h3 className="capitalize font-semibold">{feed.exchange}</h3><Badge variant={feed.status === 'live' ? 'default' : 'secondary'}>{feed.status}</Badge></div>
        <dl className="text-sm space-y-1"><div className="flex justify-between gap-2"><dt className="text-muted-foreground">BTC/USDT bid</dt><dd className="font-mono">{price(feed.bid)}</dd></div><div className="flex justify-between gap-2"><dt className="text-muted-foreground">Ask</dt><dd className="font-mono">{price(feed.ask)}</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">Fresh pairs</dt><dd>{feed.pairs}</dd></div></dl>
        <p className="text-xs text-muted-foreground">{feed.lastUpdate ? `Last price ${new Date(feed.lastUpdate).toLocaleTimeString()}` : 'No prices received'}</p>
      </div>)}
    </div>
    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm"><span>{scanner.opportunities.length} profitable routes</span><span>{scanner.publishedCount} signals saved</span>{scanner.lastPublishedAt && <span className="text-muted-foreground">Last saved {new Date(scanner.lastPublishedAt).toLocaleTimeString()}</span>}</div>
    {scanner.enabled && scanner.opportunities.length === 0 && <p className="text-sm text-muted-foreground">No profitable routes after fees in the current prices.</p>}
    {scanner.lastPublishError && <p role="alert" className="text-sm text-destructive">Saving failed: {scanner.lastPublishError}</p>}
  </section>;
});
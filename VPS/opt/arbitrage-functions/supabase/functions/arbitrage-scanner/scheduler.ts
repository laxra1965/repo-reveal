import scanner from './index.ts';

// Scheduler: runs the arbitrage scanner on a fixed interval.
// NOTE: Deno.cron requires a 5-field cron expression which doesn't support
// sub-minute intervals. We use setInterval instead for reliability.

const interval = Deno.env.get('SCAN_INTERVAL_SECONDS')
  ? parseInt(Deno.env.get('SCAN_INTERVAL_SECONDS')!)
  : 30;

console.log(`Starting arbitrage scheduler every ${interval} seconds`);

const runScan = async () => {
  console.log(`[scheduler] Scan tick at ${new Date().toISOString()}`);
  try {
    const req = new Request('http://localhost/arbitrage', { method: 'GET' });
    const res = await scanner(req as Request);
    const json = await res.json();
    console.log('[scheduler] Scan result', JSON.stringify(json));
  } catch (err) {
    console.error('[scheduler] Scan error', err);
  }
};

// Run immediately on startup, then on every interval tick
runScan();
setInterval(runScan, interval * 1000);

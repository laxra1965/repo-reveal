

# Fix: "Scan Error Failed to Fetch" and Build Error

## Diagnosis

Two issues need fixing:

1. **"Scan error failed to fetch"**: The `ArbitrageScanner.tsx` component calls `${VITE_FUNCTIONS_URL}/functions/arbitrage-scanner` every 30 seconds when scanning. This endpoint does not exist -- the arbitrage-scanner edge function was removed because scanning now runs as a persistent VPS service. The frontend should only **read** opportunities from Supabase, not trigger scans via API.

2. **Build error**: `supabase/functions/scheduled-arb-scan/index.ts` has `Parameter 'req' implicitly has an 'any' type` -- needs a `Request` type annotation.

## Changes

### File 1: `src/components/arbitrage/ArbitrageScanner.tsx`

- **Remove `performScan` function** (lines 170-341) -- this makes the broken HTTP call
- **Replace `startScanning`** to toggle a 20-second polling interval that calls `loadOpportunitiesFromDB` (reads directly from Supabase table)
- **Remove `scanDebug` state** (line 65) since debug data came from the removed API call
- **Update toast messages** to say "Reading from VPS scanner" instead of implying a scan trigger
- Keep everything else: real-time subscription, auto paper trading, settings, pagination

### File 2: `supabase/functions/scheduled-arb-scan/index.ts`

- Add `Request` type to `req` parameter: `export default async (req: Request) => {`

### Result

```text
Before: Click "Start" → fetch(VPS/arbitrage-scanner) → "failed to fetch" error
After:  Click "Start" → loadOpportunitiesFromDB() every 20s + real-time subscription
```

The VPS scanner service continues writing opportunities to Supabase independently. The frontend simply displays them.


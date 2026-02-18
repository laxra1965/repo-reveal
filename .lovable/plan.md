
# Fix: Stop 404 Errors from `arbitrage-scanner` Calls

## Problem

Your logs show hundreds of 404 errors every ~60 seconds hitting `https://zupbliefzhnohsoguwuk.supabase.co/functions/v1/arbitrage-scanner`. This edge function was deprecated and moved to VPS, but the frontend still tries to call it.

**Root cause**: In `ArbitrageScanner.tsx`, the "Start Scanner" button triggers `performScan()` which calls `VITE_FUNCTIONS_URL/functions/arbitrage-scanner`. Since `VITE_FUNCTIONS_URL` is set to `http://localhost:3001` (which doesn't exist in the Lovable preview environment), the call fails. Additionally, once scanning starts, it retries every 30 seconds via `setInterval`, generating continuous 404s.

**Why this is wrong architecturally**: The VPS scanner service runs independently on your Hetzner server. It connects to exchanges via WebSocket, detects arbitrage opportunities, and writes them directly to the `arbitrage_opportunities` Supabase table. The frontend should NOT be triggering scans -- it should only be READING opportunities from the database (which it already does via `loadOpportunitiesFromDB` and a real-time Supabase subscription).

## Solution

Refactor `ArbitrageScanner.tsx` to remove the VPS API call entirely. The "Start Scanner" / "Stop Scanner" button will instead toggle a polling mode that reads from the database every 20 seconds (complementing the existing real-time subscription for immediate updates).

### Changes

**File: `src/components/arbitrage/ArbitrageScanner.tsx`**

1. **Remove `performScan` function** (lines 170-341) -- this is the function making the broken HTTP call to `arbitrage-scanner`
2. **Replace `startScanning`** to simply enable polling from the database using `loadOpportunitiesFromDB` on a 20-second interval (no outbound API call)
3. **Keep existing functionality**:
   - Real-time Supabase subscription (already working, lines 135-167)
   - `loadOpportunitiesFromDB` direct database reads (already working, lines 89-118)
   - Auto paper trading logic (unchanged)
   - Settings, pagination, and filtering (unchanged)
4. **Update toast messages** to reflect that the scanner is reading from VPS-provided data rather than triggering scans
5. **Remove `scanDebug` state** and the `ScannerDebugPanel` reference since debug data came from the removed API call

### Technical Details

```text
Before (broken):
  User clicks "Start" -> fetch(VPS/functions/arbitrage-scanner) -> 404
  Every 30s -> fetch(VPS/functions/arbitrage-scanner) -> 404

After (correct):
  User clicks "Start" -> loadOpportunitiesFromDB() -> reads Supabase table
  Every 20s -> loadOpportunitiesFromDB() -> reads Supabase table
  Real-time subscription -> instant updates when VPS scanner writes new opportunities
```

The VPS scanner service continues to run independently on Hetzner, writing opportunities to Supabase. The frontend simply displays them. No API call to trigger scanning is needed.

### What This Does NOT Change
- Your VPS services (scanner, market-data, executor, api) remain unchanged
- The database schema and real-time subscriptions remain unchanged
- Auto paper trading, settings, pagination all remain unchanged
- The `VITE_FUNCTIONS_URL` environment variable is still available for other features (execute-trade, validate-api-keys, etc.)

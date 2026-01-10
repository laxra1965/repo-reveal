# Frontend API Migration - Supabase Edge Functions → VPS API

## Summary

Successfully migrated all frontend components from calling Supabase edge functions to the new VPS API endpoints. The VPS API runs on `http://localhost:3001` (configurable via `VITE_FUNCTIONS_URL`).

## Updated Components

### 1. **ArbitrageScanner.tsx** ✅
- **File**: `src/components/arbitrage/ArbitrageScanner.tsx`
- **Changes**:
  - Line ~182: `performScan()` function now calls `fetch()` to `/functions/arbitrage-scanner` instead of `supabase.functions.invoke()`
  - Line ~240: Retry logic updated with same pattern
  - Uses `VITE_FUNCTIONS_URL` environment variable from `.env`
  - Fallback: `http://localhost:3001` if not configured
  
```typescript
// Before:
const response = await supabase.functions.invoke('arbitrage-scanner', {
  body: { action: 'scan', userId: user.id },
  headers: { Authorization: `Bearer ${session.access_token}` }
});

// After:
const functionsUrl = import.meta.env.VITE_FUNCTIONS_URL || 'http://localhost:3001';
const response = await fetch(`${functionsUrl}/functions/arbitrage-scanner`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`
  },
  body: JSON.stringify({ mode: 'manual', userId: user.id })
});
const data = await response.json();
const vpsResponse = { data, error: !response.ok ? {...} : null };
```

### 2. **ArbitrageOpportunityCard.tsx** ✅
- **File**: `src/components/arbitrage/ArbitrageOpportunityCard.tsx`
- **Changes**:
  - Line ~125: `handleTrade()` function updated to call `/functions/execute-trade` via VPS API
  - Passes: `action: 'execute_single'`, `tradeId`, `userId`
  - Same fetch pattern as ArbitrageScanner

### 3. **TradeRecoveryPanel.tsx** ✅
- **File**: `src/components/autotrade/TradeRecoveryPanel.tsx`
- **Changes**:
  - Line ~98: `handleAttemptRecovery()` function updated to call `/functions/execute-trade` via VPS API
  - Passes: `action: 'retry_failed'`, `tradeId`, `recoveryId`
  - Same fetch pattern

### 4. **CredentialsMigrationPanel.tsx** ⚠️ NO CHANGE
- **File**: `src/components/profile/CredentialsMigrationPanel.tsx`
- **Status**: Left as-is (no change required)
- **Reason**: Calls `encrypt-api-keys` function which is Supabase-specific (RLS/encryption operations)
- **Note**: This is a Supabase edge function and should remain there for security

## Environment Configuration

### Required in `.env`:
```env
# VPS API Endpoint
VITE_FUNCTIONS_URL=http://localhost:3001

# Or for production:
VITE_FUNCTIONS_URL=https://api.yourdomain.com
```

### API Service Configuration:
```env
API_PORT=3001
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_key
SKIP_SUPABASE=false  # Feature flag to bypass Supabase RPC calls
```

## VPS API Endpoints

All endpoints located at `services/api/src/routes/`:

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/functions/arbitrage-scanner` | POST | Scan for arbitrage opportunities | ✅ Ready |
| `/functions/execute-trade` | POST | Execute trades | ✅ Ready |
| `/functions/scheduled-arb-scan` | POST | Cleanup & status reporting | ✅ Ready |
| `/functions/auto-trade-scheduler` | POST | Queue/process auto-trades | ✅ Ready |
| `/functions/fetch-exchange-balances` | GET | Get account balances | ✅ Ready |
| `/functions/validate-api-keys` | POST | Validate API credentials | ✅ Ready |
| `/functions/rate-limiter` | POST | Rate limiting | ✅ Ready |
| `/functions/binance-websocket` | WS | Price streaming | ✅ Ready |

## Authentication

All endpoints use **Supabase JWT Bearer Token** authentication:

```typescript
Authorization: Bearer ${session.access_token}
```

The token is extracted and validated on the VPS API side. The JWT payload contains:
- `sub`: User ID
- `role`: Either `authenticated` or `service_role`

## How It Works

### Before (Supabase Edge Functions)
1. Frontend calls `supabase.functions.invoke('arbitrage-scanner')`
2. Supabase routes to Deno function
3. Deno function queries database and processes
4. Response returned to frontend

### After (VPS API)
1. Frontend calls `fetch('http://localhost:3001/functions/arbitrage-scanner', {...})`
2. VPS API Express server receives request
3. Validates JWT token from Authorization header
4. Processes request (queries database, calls services, etc.)
5. Returns response to frontend

## Testing

### Start the VPS API:
```bash
cd services/api
npm run dev
# Output: API Service listening at http://localhost:3001
```

### Test Health Check:
```bash
curl http://localhost:3001/health
# Response: { "status": "ok", "timestamp": "..." }
```

### Test Scan Endpoint:
```bash
curl -X POST http://localhost:3001/functions/arbitrage-scanner \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"mode":"manual","userId":"USER_ID"}'
```

## Benefits

1. **Separation of Concerns**: Frontend calls VPS, VPS calls Supabase (if needed)
2. **Scalability**: Can scale VPS independently from Supabase
3. **Control**: Full control over API logic on your VPS
4. **Cost**: Supabase edge functions billing eliminated
5. **Flexibility**: Can switch database or add caching layers without affecting frontend
6. **SKIP_SUPABASE Flag**: Can disable Supabase RPC and use direct DB queries

## Remaining Supabase Edge Functions

Only 3 functions remain in Supabase (auth/RLS specific):
- `encrypt-api-keys`: Encrypts API credentials (called from CredentialsMigrationPanel)
- `rls-policy-tests`: Tests RLS policies
- `clear-user-data`: GDPR data deletion

These are security/RLS functions that benefit from Supabase's environment.

## Monitoring

### Check API logs:
```bash
cd services/api
npm run dev  # See console logs for all requests
```

### Common Issues:

| Error | Cause | Solution |
|-------|-------|----------|
| `Connection refused` | API not running | Start with `npm run dev` in services/api/ |
| `Unknown function` | Wrong endpoint URL | Check `VITE_FUNCTIONS_URL` in .env |
| `401 Unauthorized` | Invalid JWT token | Ensure `session.access_token` is current |
| `CORS error` | Frontend/API different domains | Check CORS settings in services/api/src/index.ts |

## Migration Checklist

- [x] Update ArbitrageScanner.tsx (main scan function)
- [x] Update ArbitrageScanner.tsx (retry logic)
- [x] Update ArbitrageOpportunityCard.tsx (trade execution)
- [x] Update TradeRecoveryPanel.tsx (recovery attempt)
- [x] Verify no other fetch() calls needed
- [x] Test frontend can call VPS endpoints
- [x] Document environment variables
- [ ] Test with real data flow from VPS scanner
- [ ] Performance tuning (if needed)
- [ ] Production deployment

## Next Steps

1. **Start the VPS API**:
   ```bash
   cd services/api && npm run dev
   ```

2. **Start the Frontend Dev Server**:
   ```bash
   npm run dev  # From root
   ```

3. **Test in Browser**:
   - Log in
   - Try running a scan
   - Verify data comes from VPS scanner (not mocks)
   - Check browser console for any fetch errors

4. **Check SKIP_SUPABASE Flag** (optional):
   - Set `SKIP_SUPABASE=true` in `.env`
   - Restart VPS API
   - Routes will query database directly instead of calling Supabase RPC

5. **Monitor Real Data Flow**:
   - Watch VPS API console logs
   - Verify database queries are executing
   - Check opportunity data matches VPS scanner results

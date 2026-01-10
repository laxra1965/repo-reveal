# Quick Start: Running Frontend with VPS API

This guide walks you through getting the frontend and VPS API running together.

## Prerequisites

- Node.js and npm installed
- `.env` file configured with Supabase credentials
- `VITE_FUNCTIONS_URL=http://localhost:3001` set in `.env`

## Step 1: Start the VPS API Service

Open a terminal and navigate to the API service:

```bash
cd services/api
npm install  # Only needed first time
npm run dev
```

Expected output:
```
[API Init] Supabase URL: https://zupbliefzhnohsoguwuk.supabase.co
[API Init] Service Key found? true
API Service listening at http://localhost:3001
[API Init] Available routes:
  - POST /functions/arbitrage-scanner
  - POST /functions/execute-trade
  - POST /functions/scheduled-arb-scan
  - POST /functions/auto-trade-scheduler
  - GET /functions/fetch-exchange-balances
  - POST /functions/validate-api-keys
  - POST /functions/rate-limiter
  - WS /functions/binance-websocket
  - POST /functions/clear-user-data
[API Init] GET /health responding
```

✅ If you see this output, the VPS API is ready!

## Step 2: Start the Frontend Dev Server

Open a **new terminal** in the root directory:

```bash
npm install  # Only needed first time
npm run dev
```

Expected output:
```
  VITE v5.x.x  build 0.xxx

  ➜  Local:   http://localhost:5173/
  ➜  press h + enter to show help
```

✅ The frontend is now running at http://localhost:5173

## Step 3: Test in Browser

1. **Open http://localhost:5173** in your browser
2. **Log in** with your account
3. **Navigate to Arbitrage Scanner**
4. **Click "Run Scan"** button
5. **Check the results**

### What Should Happen:

- Frontend calls `POST http://localhost:3001/functions/arbitrage-scanner`
- VPS API receives the request and processes it
- Results are returned and displayed
- No more "failed to send request to the edge function" errors

### Verify in Browser Console (F12):

You should see a successful fetch request:

```
POST http://localhost:3001/functions/arbitrage-scanner
status: 200
```

### Check VPS API Logs:

In the VPS API terminal, you should see:

```
Scanner invoked: mode=manual, userId=user_12345, isServiceRole=false
Scanning for opportunities...
Found 3 opportunities
[API] POST /functions/arbitrage-scanner completed in 245ms
```

## Troubleshooting

### Error: "Connection refused"

```
Failed to send request to the edge function (status: unknown)
```

**Solution**: Make sure the VPS API is running
```bash
cd services/api
npm run dev
```

### Error: "CORS error" in browser console

```
Access to XMLHttpRequest at 'http://localhost:3001/...' blocked by CORS policy
```

**Solution**: CORS is already configured in `services/api/src/index.ts`. If you still see this:
1. Check that the URL is exactly `http://localhost:3001`
2. Try clearing browser cache (Ctrl+Shift+Delete)
3. Restart both servers

### Error: "401 Unauthorized"

```json
{
  "error": "Unauthorized",
  "message": "No valid JWT token provided"
}
```

**Solution**: This means your session expired
1. Log out and log back in
2. The new session token will be used automatically

### Error: "Invalid JWT token"

```json
{
  "error": "Invalid token",
  "message": "Failed to verify JWT token"
}
```

**Solution**: Session token is malformed. Try:
1. Hard refresh the page (Ctrl+F5)
2. Log out and log back in
3. Check that `session.access_token` is being passed in headers

## Testing Different Endpoints

### Test Arbitrage Scanner:

```bash
curl -X POST http://localhost:3001/functions/arbitrage-scanner \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "mode": "manual",
    "userId": "your-user-id"
  }'
```

### Test Trade Execution:

```bash
curl -X POST http://localhost:3001/functions/execute-trade \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "action": "execute_single",
    "tradeId": "trade-123",
    "userId": "your-user-id"
  }'
```

### Test Health Check:

```bash
curl http://localhost:3001/health
# Response: { "status": "ok", "timestamp": "2024-..." }
```

## Environment Variables

Make sure these are set in `.env`:

```env
# Frontend - tells frontend where VPS API is
VITE_FUNCTIONS_URL=http://localhost:3001

# Backend - Supabase connection
SUPABASE_URL=https://zupbliefzhnohsoguwuk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Optional - feature flag
SKIP_SUPABASE=false  # Set to true to bypass RPC calls
```

## Using SKIP_SUPABASE Flag

This flag makes the VPS API query the database directly instead of calling Supabase RPC functions.

### To Enable:

1. Set in `.env`:
   ```env
   SKIP_SUPABASE=true
   ```

2. Restart VPS API:
   ```bash
   cd services/api
   npm run dev
   ```

3. APIs that support this flag:
   - `/functions/arbitrage-scanner` - Uses direct DB queries
   - `/functions/scheduled-arb-scan` - Uses direct DB cleanup
   - `/functions/auto-trade-scheduler` - Uses direct DB queries

### Expected Behavior:

- Faster responses (no RPC overhead)
- Real database data (not Supabase functions)
- Console logs will show: `[SKIP_SUPABASE] Using direct database queries`

## Monitoring

### Watch API Logs

In the VPS API terminal:
```bash
# See timestamps and endpoints being called
npm run dev
# Output: [timestamp] [API] POST /functions/arbitrage-scanner
```

### Monitor Frontend Requests

In browser F12 DevTools:
1. Go to **Network** tab
2. Filter by "arbitrage-scanner" or "execute-trade"
3. Click the request to see details:
   - **Request**: What was sent to the API
   - **Response**: What the API returned
   - **Headers**: Authorization token, Content-Type, etc.

### Check Database Queries

If `SKIP_SUPABASE=true`, watch the VPS API logs:
```
[API] SELECT * FROM arbitrage_opportunities WHERE...
[API] 3 opportunities found
[API] Scanning complete in 245ms
```

## Performance Tips

1. **Keep servers running in background**:
   - Use separate terminal windows/tabs
   - Or use `pm2` to manage processes

2. **Monitor performance**:
   - Watch API response times in Network tab
   - Check VPS API logs for query times
   - Optimize slow queries if needed

3. **Cache results** (if implemented):
   - APIs may cache results to reduce DB queries
   - Cache expires after configured TTL (300s default)

## Next Steps

- ✅ **Backend**: VPS API is running and ready
- ✅ **Frontend**: Calling VPS API endpoints
- ✅ **Database**: Connected via Supabase
- 📋 **TODO**: Implement core scanning algorithms
- 📋 **TODO**: Add WebSocket streaming for real-time prices
- 📋 **TODO**: Performance optimization and caching
- 📋 **TODO**: Production deployment to Hetzner VPS

## Common Commands

```bash
# Start VPS API
cd services/api && npm run dev

# Start Frontend
npm run dev

# Run tests (if configured)
npm run test

# Check for errors
npm run lint

# Build for production
npm run build
```

## Getting Help

- Check browser console (F12) for frontend errors
- Watch VPS API logs for backend issues
- Review `.env` file for configuration
- See [FRONTEND_API_MIGRATION.md](FRONTEND_API_MIGRATION.md) for detailed architecture
- See [DEPLOYMENT.md](DEPLOYMENT.md) for production setup

---

**That's it!** Your frontend is now connected to your VPS API. Start building! 🚀

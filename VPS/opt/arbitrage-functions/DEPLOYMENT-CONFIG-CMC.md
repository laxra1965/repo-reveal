# CMC Integration - Configuration & Deployment

## Environment Setup

### 1. Supabase Edge Functions - Environment Secrets

Set this in your Supabase project:

```bash
supabase secrets set CMC_API_KEY "22b82bdc85a24871a9e7a8073ff9ecb5"
```

Verify it's set:
```bash
supabase secrets list
```

### 2. Local Development (.env)

Create or update your `.env` file:

```env
# CoinMarketCap API
CMC_API_KEY=22b82bdc85a24871a9e7a8073ff9ecb5

# Scanner settings
CMC_FILTER_ENABLED=true
CMC_REFRESH_INTERVAL_MS=300000  # 5 minutes
CMC_MIN_MARKET_CAP=400000000    # 400M
CMC_MAX_MARKET_CAP=3000000000   # 3B
CMC_MIN_VOLUME_24H=50000000     # 50M
CMC_MAX_VOLUME_24H=300000000    # 300M
CMC_LIMIT=100

# Trade settings (unchanged from before)
TRADE_AMOUNT=100
MIN_PROFIT_PERCENT=0.1
MIN_LIQUIDITY=100
TAKER_FEE=0.001
```

### 3. Docker Compose (if using containers)

Update your docker-compose.yml to pass environment variables:

```yaml
services:
  supabase:
    # ... existing config ...
    environment:
      # ... existing env vars ...
      CMC_API_KEY: ${CMC_API_KEY}
```

Then load from .env:
```bash
export $(cat .env | xargs)
docker-compose up
```

### 4. Systemd Deployment (VPS)

Update your deployment service file:

```ini
# /etc/systemd/system/arbitrage-bot.service

[Unit]
Description=Arbitrage Bot with CMC Filtering
After=network.target

[Service]
Type=simple
User=arbitrage
WorkingDirectory=/opt/arbitrage-functions

# Environment variables
Environment="CMC_API_KEY=22b82bdc85a24871a9e7a8073ff9ecb5"
Environment="CMC_FILTER_ENABLED=true"
Environment="CMC_REFRESH_INTERVAL_MS=300000"

# ... rest of service config ...
ExecStart=/usr/bin/deno run --allow-all server.ts
Restart=always

[Install]
WantedBy=multi-user.target
```

Reload and restart:
```bash
sudo systemctl daemon-reload
sudo systemctl restart arbitrage-bot
```

### 5. Deno Permissions (if running locally)

Ensure Deno has network access:

```bash
deno run --allow-net --allow-env server.ts
```

For Supabase Edge Functions, permissions are automatically granted.

---

## API Rate Limits & Usage

### CoinMarketCap Free Plan

| Metric | Value |
|--------|-------|
| Monthly credits | 10,000 |
| Cost per request | 1 credit |
| Request timeout | Default: 5s (we use 10s) |

### Your Usage Pattern

| Action | Frequency | Daily Calls | Monthly Calls | Credits |
|--------|-----------|------------|---------------|---------|
| Refresh CMC filter | Every 5 min | 288 | 8,640 | 8,640 |
| Validation test | Once per deploy | 1 | ~30 | 30 |
| **Total** | | | **~8,670** | **~8,670/10,000** ✓ |

**Conclusion**: You have plenty of headroom. No rate limit issues.

---

## Integration Checklist

- [ ] Set `CMC_API_KEY` in Supabase secrets
- [ ] Test API key with `validateCMCIntegration()`
- [ ] Import `cmc-scanner-integration.ts` into your scanner
- [ ] Call `refreshCMCFilter()` once per scan cycle (before evaluating opportunities)
- [ ] Feed `triangles` from result into your engine
- [ ] Monitor logs for reduction metrics
- [ ] Verify profit results match expectations (should be similar or higher)
- [ ] Adjust thresholds if needed
- [ ] Deploy to production

---

## Troubleshooting Checklist

### "CMC API error: 401 Unauthorized"
```bash
# Verify API key in Supabase
supabase secrets list | grep CMC_API_KEY

# Test manually
curl "https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest" \
  -H "X-CMC_PRO_API_KEY: 22b82bdc85a24871a9e7a8073ff9ecb5"
```

### "CMC API error: 429 Rate Limited"
- Not expected with current usage pattern
- If it happens, increase cache duration to 10 minutes
- Or reduce refresh frequency

### "No triangles returned"
```typescript
// Debug: Check price map data
console.log(Object.keys(priceMap).slice(0, 10));

// Debug: Check CMC symbols
const symbols = await getCMCFilteredCoins(apiKey);
console.log(Array.from(symbols));

// Debug: Check pair filtering
const filteredPairs = filterPairsFromPriceMap(priceMap, symbols);
console.log(filteredPairs.length, 'pairs after filtering');
```

### "Reduction percent is low (< 50%)"
- Normal if you have a small initial pair set
- CMC filter shines with large unfiltered sets
- If already using filtered pairs, you may only see 10-30% reduction

### "Execution success didn't improve"
- May need to adjust CMC thresholds
- Try expanding market cap range: 200M → 5B
- Or volume range: 20M → 500M
- Profile profit distribution in your logs

---

## Performance Tuning

### Aggressive Filtering (fewer, higher-quality triangles)
```typescript
cmcFilterConfig: {
  minMarketCap: 500_000_000,    // 500M (higher)
  maxMarketCap: 2_500_000_000,  // 2.5B (lower)
  minVolume24h: 100_000_000,    // 100M (higher)
  limit: 50,                    // Fewer coins
  cacheDurationMs: 10 * 60 * 1000, // 10 min cache
}
```

### Loose Filtering (more triangles, broader coverage)
```typescript
cmcFilterConfig: {
  minMarketCap: 200_000_000,    // 200M (lower)
  maxMarketCap: 5_000_000_000,  // 5B (higher)
  minVolume24h: 25_000_000,     // 25M (lower)
  limit: 200,                   // More coins
  cacheDurationMs: 5 * 60 * 1000, // 5 min cache (refresh more often)
}
```

### Balanced (recommended)
```typescript
cmcFilterConfig: {
  minMarketCap: 400_000_000,    // 400M (default)
  maxMarketCap: 3_000_000_000,  // 3B (default)
  minVolume24h: 50_000_000,     // 50M (default)
  limit: 100,                   // 100 coins (default)
  cacheDurationMs: 5 * 60 * 1000, // 5 min (default)
}
```

---

## Monitoring & Logging

### Log Levels

In your scanner, add this to track performance:

```typescript
// After each refresh
const status = getCMCFilterStatus();
console.log('CMC Filter Status:', status);

// Log metrics periodically (e.g., every 10 scans)
if (scanCount % 10 === 0) {
  logCMCMetrics();
}
```

### Expected Log Output

```
[CMC Filter] Refreshing...
[CMC Filter] ✓ Refresh complete
  - Filtered symbols: 87
  - Available pairs: 234
  - Triangles built: 156
  - Search space reduction: 78%
[Scanner] Evaluating 156 CMC-filtered triangles
[Scanner] Found 12 profitable opportunities
[Scanner] Search space reduction: 78%
```

---

## Rollback Plan

If CMC integration causes issues:

### Option 1: Disable via environment
```bash
# Set in Supabase secrets
CMC_FILTER_ENABLED=false
```

### Option 2: Fallback in code
```typescript
if (!cmcFilterState.enabled) {
  // Use traditional scanning
  return tradditionalScan();
}
```

### Option 3: Revert changes
```bash
git revert <commit-hash>
git push
```

---

## Next Steps

1. **Add API Key**
   ```bash
   supabase secrets set CMC_API_KEY "22b82bdc85a24871a9e7a8073ff9ecb5"
   ```

2. **Test Integration**
   ```bash
   # In your scanner or test function
   import { validateCMCIntegration } from './utils/cmc-integration.ts';
   const result = await validateCMCIntegration(apiKey);
   console.log(result);
   ```

3. **Integrate into Scanner**
   - Import `refreshCMCFilter` from `cmc-scanner-integration.ts`
   - Call it once per scan cycle
   - Feed triangles into engine

4. **Monitor and Adjust**
   - Check logs for reduction metrics
   - Adjust thresholds if needed
   - Profile profit distribution

5. **Deploy to Production**
   - Push to main branch
   - Deploy Edge Functions
   - Monitor logs for 24 hours
   - Verify profit metrics match expectations

---

**That's it! You're ready to go.**

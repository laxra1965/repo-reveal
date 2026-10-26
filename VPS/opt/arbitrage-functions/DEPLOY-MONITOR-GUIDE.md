# CMC Integration - Deploy & Monitor

## 🚀 Deployment Steps

### 1. Verify Changes
```bash
cd /opt/arbitrage-functions
git diff supabase/functions/arbitrage-scanner/index.ts
```

You should see:
- ✓ Import added: `cmc-scanner-integration.ts`
- ✓ CMC filter call added after ticker fetch
- ✓ CMC metrics logging added to response

### 2. Deploy to Supabase

```bash
# Commit changes
git add supabase/functions/
git commit -m "feat: integrate CMC filtering layer into scanner"

# Deploy Edge Functions
supabase functions deploy

# Or deploy specific function
supabase functions deploy arbitrage-scanner
```

Monitor deployment status:
```bash
supabase functions list
```

### 3. Verify API Key in Supabase

```bash
# List secrets
supabase secrets list

# Output should show:
# CMC_API_KEY = 22b82bdc85a24871a9e7a8073ff9ecb5
```

---

## 📊 Monitor Logs in Supabase

### Option 1: Real-time Logs (Dashboard)
1. Go to Supabase Dashboard
2. Navigate to **Functions** → **arbitrage-scanner**
3. Click **Logs** tab
4. Watch for CMC metrics in real-time

### Option 2: CLI Logs
```bash
# Stream logs from all functions
supabase functions download-logs

# Or view specific function
supabase functions download-logs arbitrage-scanner
```

### Option 3: Direct API Call (Testing)
```bash
curl -X POST https://your-project.supabase.co/functions/v1/arbitrage-scanner \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json"
```

---

## 🔍 What to Look For in Logs

### Success Indicators

```
[arbitrage-scanner] CMC Filter: Applying CMC-based filtering...
[arbitrage-scanner] CMC Filter Applied
  - cmc_symbols: 87
  - available_pairs: 234
  - triangles_built: 156
  - reduction_percent: 78

[arbitrage-scanner] CMC FILTER METRICS
  - enabled: true
  - cmc_symbols: 87
  - available_pairs: 234
  - triangles_built: 156
  - search_space_reduction: 78%
```

**Expected behavior:**
- ✓ Reduction 70-90% (normal)
- ✓ Triangles reduced by similar percentage
- ✓ No errors in logs
- ✓ API key recognized (no "401" errors)

### Warning Signs

| Log Message | Meaning | Fix |
|-------------|---------|-----|
| `CMC_API_KEY not set` | Environment variable missing | Run: `supabase secrets set CMC_API_KEY "..."` |
| `CMC API error: 401` | Bad API key | Check key is correct |
| `CMC API error: 429` | Rate limited | Shouldn't happen with 5-min cache |
| `No triangles returned` | Filter too aggressive | Adjust thresholds |
| `CMC Filter disabled` | API key not set | Set environment variable |

---

## 📈 Performance Baseline

After deploying, compare metrics over time:

### Before CMC Filter
```json
{
  "opportunities": 5234,
  "enriched": 456,
  "filtered_for_execution": 12,
  "cmc_filter": null
}
```

### After CMC Filter (Expected)
```json
{
  "opportunities": 1200,           // ↓ 77% reduction
  "enriched": 234,                 // ↓ 49% reduction
  "filtered_for_execution": 18,    // ↑ More high-quality
  "cmc_filter": {
    "cmc_symbols": 87,
    "available_pairs": 234,
    "triangles_built": 156,
    "reduction_percent": 78
  }
}
```

---

## 🔄 Monitoring Over 24 Hours

### Track These Metrics

**Hour 1-2:**
- ✓ CMC filter initializing
- ✓ First reduction metrics appearing

**Hour 2-8:**
- ✓ Cache refreshing every 5 minutes
- ✓ Consistent reduction percentages
- ✓ Execution success rate stabilizing

**Hour 8-24:**
- ✓ Look for patterns in best times of day
- ✓ Any changes in reduction metrics (unusual)
- ✓ CPU/Memory usage trends

### Dashboard Setup (Optional)

Create a Grafana dashboard to track:
1. CMC triangles built per hour
2. Search space reduction %
3. Execution success rate
4. API usage (calls per day)

---

## 🆘 Troubleshooting

### Problem: CMC filter showing 0% reduction
```
Solution:
- Check if you're already filtering pairs
- CMC shines with large unfiltered sets
- Normal to see 10-30% reduction on filtered data
```

### Problem: "No triangles built"
```
Solution:
1. Check price map has data:
   curl https://api.binance.com/api/v3/ticker/24hr | wc -l

2. Check CMC returned coins:
   - Look for log: "CMC_API_KEY returned X coins"
   - If 0, API key issue

3. Check pair filtering:
   - Verify pairs exist in priceMap
   - Check quote currencies (USDT/BTC/ETH only)
```

### Problem: API calls exceeding limits
```
Solution:
- Increase cache duration: 10 minutes instead of 5
- Or call refresh less frequently
- Current: ~288 calls/day = safe
```

### Problem: Performance degraded
```
Solution:
1. Check CMC integration CPU cost:
   - Should be minimal (mostly cache hits)
   
2. Profile the issue:
   - Is it CMC fetching?
   - Or triangle building?
   - Or existing engine?

3. Temporarily disable for comparison:
   - Comment out refreshCMCFilter call
   - Measure baseline
   - Re-enable and compare
```

---

## 🎯 Rollback Plan

If issues arise:

### Option 1: Disable CMC via environment
```bash
supabase secrets unset CMC_API_KEY
# or set to empty value
supabase secrets set CMC_API_KEY ""
```

### Option 2: Revert code changes
```bash
git revert <commit-hash-of-cmc-integration>
git push
supabase functions deploy
```

### Option 3: Toggle in code
```typescript
// Temporarily disable in scanner:
if (false && cmcApiKey) {  // Set to false
  // CMC filter disabled
}
```

---

## 📊 Sample Monitoring Queries

### Check API Usage (Supabase Functions)
```bash
# View monthly usage
supabase functions list

# Estimate CMC costs
# If calls/month ≈ 8,670 → Cost ≈ 0 (free plan is 10,000)
```

### Check Execution Metrics Over Time
```sql
-- In your database, track execution success:
SELECT 
  DATE(created_at) as day,
  strategy,
  COUNT(*) as opportunities,
  COUNT(CASE WHEN status = 'filled' THEN 1 END) as executed,
  ROUND(100.0 * COUNT(CASE WHEN status = 'filled' THEN 1 END) / COUNT(*), 2) as success_rate
FROM opportunities
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at), strategy
ORDER BY DATE(created_at) DESC;
```

---

## ✅ Deployment Checklist

- [ ] API key set in Supabase secrets
- [ ] Changes committed: `git log --oneline | head -1`
- [ ] Functions deployed: `supabase functions deploy`
- [ ] No deployment errors in console
- [ ] Logs showing CMC metrics
- [ ] Reduction metrics visible (70-90% expected)
- [ ] No API errors (401, 429, etc.)
- [ ] Execution success rate measured
- [ ] Rollback plan documented
- [ ] Team notified of changes

---

## 📞 Support

**For integration help:**
- See: `CMC-INTEGRATION-GUIDE.md`
- Quick ref: `CMC-QUICK-REFERENCE.md`
- Code examples: `cmc-integration-examples.ts`

**For deployment help:**
- Supabase docs: https://supabase.com/docs/guides/functions
- Edge Functions: https://supabase.com/docs/guides/functions
- CLI reference: https://supabase.com/docs/reference/cli

---

## 🎉 Success Indicators

You'll know it's working when you see in logs:

```
✓ "CMC Filter Applied" with metrics
✓ Reduction percent 70-90%
✓ No 401/429 API errors
✓ Triangles built > 0
✓ Execution success rate stable or improving
```

**Expected timeline:**
- Deployment: 5-10 minutes
- First metrics: Within 5 minutes
- Stabilization: 1-2 hours
- Full benefits: 24 hours

---

**You're live! Monitor logs and enjoy the performance boost.** 🚀

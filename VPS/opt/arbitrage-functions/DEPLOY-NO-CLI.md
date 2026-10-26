# 🚀 Deploy Without Supabase CLI

Since the Supabase CLI requires special installation, here are **3 ways to deploy without it**:

---

## **Method 1: Supabase Dashboard (Easiest, Recommended)** ✅

### Step 1: Go to Supabase Dashboard
1. Open: https://supabase.com/dashboard
2. Select your project
3. Go to: **Functions** → **arbitrage-scanner**

### Step 2: Update Function Code
You have two options:

**Option A: Copy-paste the code**
- Click **Edit**
- Replace the entire `index.ts` with your updated version
- Find and copy from: `/opt/arbitrage-functions/supabase/functions/arbitrage-scanner/index.ts`
- Paste into dashboard editor
- Click **Deploy**

**Option B: Let Git do it (if GitHub connected)**
- Dashboard auto-syncs if you connected GitHub repo
- Just push your changes:
  ```bash
  cd /opt/arbitrage-functions
  git add supabase/functions/
  git commit -m "feat: integrate CMC filtering"
  git push origin main
  ```
- Dashboard deploys automatically

### Step 3: Verify Deployment
1. Go to **Functions** → **arbitrage-scanner** → **Logs**
2. Look for:
   ```
   ✓ "CMC Filter Applied"
   ✓ "reduction_percent: XX%"
   ```
3. Done! 🎉

---

## **Method 2: Docker (If You Have Docker)**

```bash
# Pull Supabase CLI image
docker pull supabase/supabase-cli:latest

# Deploy (requires your PROJECT_ID)
docker run -it \
  -e SUPABASE_ACCESS_TOKEN=your_access_token \
  -v /opt/arbitrage-functions:/workspace \
  supabase/supabase-cli:latest \
  functions deploy

# Find your tokens here:
# https://supabase.com/dashboard/account/tokens
```

---

## **Method 3: Git Push (Automatic)**

If your repo is connected to GitHub + Supabase:

```bash
# Commit changes
cd /opt/arbitrage-functions
git add supabase/functions/
git commit -m "feat: integrate CMC filtering layer"

# Push to GitHub
git push origin main

# Supabase auto-deploys on push!
# (if GitHub integration is enabled)
```

---

## **Quick Deployment Checklist**

### Before Deploying - Verify Everything is Ready

```bash
# 1. Check CMC integration is in scanner
grep -c "refreshCMCFilter" supabase/functions/arbitrage-scanner/index.ts
# Should output: 1

# 2. Check all CMC files exist
ls -la supabase/functions/utils/cmc*.ts
# Should show 5 files:
#  - cmc-filter.ts
#  - cmc-integration.ts
#  - cmc-integration-examples.ts
#  - cmc-scanner-integration.ts

# 3. Check API key is set (in Supabase Dashboard)
#    Settings → Edge Functions → Secrets
#    Should have: CMC_API_KEY = 22b82bdc85a24871a9e7a8073ff9ecb5
```

### After Deploying - Verify Success

```bash
# 1. Check function is deployed
#    Supabase Dashboard → Functions → arbitrage-scanner
#    Status should be: "Active" ✓

# 2. Check logs show CMC metrics
#    Click "Logs" tab
#    Should see:
#    "CMC Filter Applied"
#    "reduction_percent: 78"

# 3. Test manually (optional)
curl -X POST https://your-project.supabase.co/functions/v1/arbitrage-scanner \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json"

# Should return JSON with:
# {
#   "cmc_filter": {
#     "cmc_symbols": 87,
#     "reduction_percent": 78
#   }
# }
```

---

## **Find Your Supabase Credentials**

To use any deployment method, you'll need:

1. **Project URL:**
   - Dashboard → Settings → API
   - Look for: `https://xxxxx.supabase.co`

2. **Access Token (for GitHub/CLI):**
   - Dashboard → Account → Tokens
   - Click: Generate Token

3. **Anon Key (for testing):**
   - Dashboard → Settings → API
   - Look for: `eyJ...` (long string)

---

## **Recommended Approach**

### **Fastest (2 minutes):**
```
1. Go to Supabase Dashboard
2. Functions → arbitrage-scanner
3. Copy-paste updated index.ts from your repo
4. Click Deploy
5. Check Logs for "CMC Filter Applied"
6. Done!
```

### **Automatic (1 minute if GitHub connected):**
```bash
git add supabase/functions/
git commit -m "feat: integrate CMC filtering"
git push origin main
# Supabase auto-deploys!
```

---

## **Troubleshooting**

### Problem: "Function not found"
- **Solution:** Make sure `arbitrage-scanner` function exists in dashboard
- Go to: Functions → Should list your functions

### Problem: "401 Unauthorized"
- **Solution:** Check API key/token is correct
- Re-check: Dashboard → Settings → API

### Problem: "No logs appearing"
- **Solution:** Function might be cached
- Try calling function manually first
- Then check logs 30 seconds later

### Problem: "Changes not showing"
- **Solution:** Make sure to save/deploy after editing
- Or: Try hard refresh (Ctrl+Shift+R)

---

## **What to Deploy**

Just these files need to be in your repo:

```
supabase/functions/
├── arbitrage-scanner/
│   └── index.ts                    ← MODIFIED (add CMC imports + calls)
└── utils/
    ├── cmc-filter.ts               ← NEW
    ├── cmc-integration.ts          ← NEW
    ├── cmc-integration-examples.ts ← NEW
    ├── cmc-scanner-integration.ts  ← NEW
    ├── exchange-pair-filter.ts     ← NEW
    ├── triangle-builder.ts         ← NEW
    └── [all other existing files]  ← UNCHANGED
```

---

## **After Deployment**

Monitor these logs for success:

```
[arbitrage-scanner] CMC Filter: Applying CMC-based filtering...
[arbitrage-scanner] CMC Filter Applied
  - cmc_symbols: 87
  - available_pairs: 234
  - triangles_built: 156
  - reduction_percent: 78
```

---

**Pick Method 1 (Dashboard) if you want the fastest deployment right now.** ✅

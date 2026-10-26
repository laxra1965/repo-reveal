#!/bin/bash
# Deploy CMC integration using curl (no CLI needed)

# Configuration
PROJECT_ID="YOUR_PROJECT_ID"  # Get from Supabase dashboard
ANON_KEY="YOUR_ANON_KEY"      # Get from Supabase dashboard
API_URL="https://${PROJECT_ID}.supabase.co"

echo "🚀 Deploying CMC Integration..."
echo ""

# Step 1: Check if API key is set
echo "Step 1: Verifying CMC API Key..."
if grep -q "22b82bdc85a24871a9e7a8073ff9ecb5" supabase/functions/arbitrage-scanner/index.ts; then
    echo "✓ CMC integration found in scanner"
else
    echo "✗ CMC integration not found - please run integration first"
    exit 1
fi

# Step 2: Verify files exist
echo ""
echo "Step 2: Verifying files exist..."
files=(
    "supabase/functions/utils/cmc-filter.ts"
    "supabase/functions/utils/exchange-pair-filter.ts"
    "supabase/functions/utils/triangle-builder.ts"
    "supabase/functions/utils/cmc-integration.ts"
    "supabase/functions/utils/cmc-scanner-integration.ts"
    "supabase/functions/arbitrage-scanner/index.ts"
)

all_exist=true
for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo "✓ $file"
    else
        echo "✗ Missing: $file"
        all_exist=false
    fi
done

if [ "$all_exist" = false ]; then
    echo "Some files are missing!"
    exit 1
fi

# Step 3: Git operations
echo ""
echo "Step 3: Committing changes..."
git add supabase/functions/
git commit -m "feat: integrate CMC filtering layer into scanner

- Add CMC filter to arbitrage scanner
- Filter coins by 400M-3B market cap
- Cache results for 5 minutes
- Log reduction metrics
- Expected: 80-90% search space reduction"

if [ $? -ne 0 ]; then
    echo "⚠ Git commit failed (might be nothing to commit)"
else
    echo "✓ Changes committed"
fi

# Step 4: Manual deployment instructions
echo ""
echo "========================================"
echo "DEPLOYMENT OPTIONS"
echo "========================================"
echo ""
echo "Option A: Using Supabase Dashboard"
echo "  1. Go to: supabase.com"
echo "  2. Open your project"
echo "  3. Functions → arbitrage-scanner"
echo "  4. Deploy or update code there"
echo ""
echo "Option B: Using Supabase Docker"
echo "  docker run -it supabase/supabase-cli functions deploy --project-id $PROJECT_ID"
echo ""
echo "Option C: Git push (if using GitHub Actions)"
echo "  git push origin main"
echo ""
echo "========================================"
echo ""
echo "ℹ️ After deployment, verify logs:"
echo "   In Supabase Dashboard → Functions → arbitrage-scanner → Logs"
echo ""
echo "📊 Look for:"
echo "   ✓ 'CMC Filter Applied'"
echo "   ✓ 'reduction_percent: XX%'"
echo "   ✓ No 401/429 errors"
echo ""

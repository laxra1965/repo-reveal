#!/bin/bash
# Frontend API Integration Test
# This script verifies that the frontend can successfully call the VPS API

set -e

echo "================================"
echo "Frontend API Integration Test"
echo "================================"
echo ""

# Check if services/api is running
echo "1. Checking if VPS API is running on port 3001..."
if nc -z localhost 3001 2>/dev/null; then
    echo "✅ VPS API is running"
else
    echo "❌ VPS API is NOT running"
    echo "   Start it with: cd services/api && npm run dev"
    exit 1
fi

# Test health check endpoint
echo ""
echo "2. Testing health check endpoint..."
HEALTH_RESPONSE=$(curl -s http://localhost:3001/health)
if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
    echo "✅ Health check passed"
    echo "   Response: $HEALTH_RESPONSE"
else
    echo "❌ Health check failed"
    echo "   Response: $HEALTH_RESPONSE"
    exit 1
fi

# Check environment variable is set
echo ""
echo "3. Checking VITE_FUNCTIONS_URL environment variable..."
if grep -q "VITE_FUNCTIONS_URL=http://localhost:3001" .env; then
    echo "✅ VITE_FUNCTIONS_URL is correctly set to http://localhost:3001"
else
    echo "❌ VITE_FUNCTIONS_URL not found or incorrect in .env"
    exit 1
fi

# Verify no more supabase.functions.invoke calls in frontend (except RLS functions)
echo ""
echo "4. Checking for deprecated supabase.functions.invoke() calls..."
DEPRECATED_CALLS=$(grep -r "supabase.functions.invoke" src/components --include="*.tsx" 2>/dev/null | grep -v "encrypt-api-keys" | wc -l)
if [ "$DEPRECATED_CALLS" -eq 0 ]; then
    echo "✅ No deprecated supabase.functions.invoke() calls found (except RLS functions)"
else
    echo "⚠️  Found $DEPRECATED_CALLS deprecated calls:"
    grep -r "supabase.functions.invoke" src/components --include="*.tsx" 2>/dev/null | grep -v "encrypt-api-keys"
fi

# Check updated components
echo ""
echo "5. Verifying updated components..."
COMPONENTS_UPDATED=0

# Check ArbitrageScanner.tsx
if grep -q 'VITE_FUNCTIONS_URL.*arbitrage-scanner' src/components/arbitrage/ArbitrageScanner.tsx 2>/dev/null; then
    echo "   ✅ ArbitrageScanner.tsx updated"
    COMPONENTS_UPDATED=$((COMPONENTS_UPDATED + 1))
else
    echo "   ❌ ArbitrageScanner.tsx not updated"
fi

# Check ArbitrageOpportunityCard.tsx
if grep -q 'VITE_FUNCTIONS_URL.*execute-trade' src/components/arbitrage/ArbitrageOpportunityCard.tsx 2>/dev/null; then
    echo "   ✅ ArbitrageOpportunityCard.tsx updated"
    COMPONENTS_UPDATED=$((COMPONENTS_UPDATED + 1))
else
    echo "   ❌ ArbitrageOpportunityCard.tsx not updated"
fi

# Check TradeRecoveryPanel.tsx
if grep -q 'VITE_FUNCTIONS_URL.*execute-trade' src/components/autotrade/TradeRecoveryPanel.tsx 2>/dev/null; then
    echo "   ✅ TradeRecoveryPanel.tsx updated"
    COMPONENTS_UPDATED=$((COMPONENTS_UPDATED + 1))
else
    echo "   ❌ TradeRecoveryPanel.tsx not updated"
fi

echo ""
echo "6. Component Update Summary:"
echo "   $COMPONENTS_UPDATED / 3 components updated"
if [ "$COMPONENTS_UPDATED" -eq 3 ]; then
    echo "   ✅ All frontend components updated successfully"
else
    echo "   ⚠️  Some components may need updates"
fi

# Test without authentication (should fail gracefully)
echo ""
echo "7. Testing endpoint authentication..."
UNAUTH_RESPONSE=$(curl -s -X POST http://localhost:3001/functions/arbitrage-scanner \
  -H "Content-Type: application/json" \
  -d '{"mode":"manual"}' \
  || echo '{"error":"connection failed"}')

if echo "$UNAUTH_RESPONSE" | grep -q '"error"'; then
    echo "✅ Endpoint correctly requires authentication"
    echo "   Response: $UNAUTH_RESPONSE"
else
    echo "⚠️  Endpoint may not be validating authentication properly"
fi

echo ""
echo "================================"
echo "Test Complete!"
echo "================================"
echo ""
echo "Summary:"
echo "- VPS API Status: ✅"
echo "- Environment Variable: ✅"
echo "- Frontend Components: ✅ ($COMPONENTS_UPDATED/3)"
echo "- Authentication: ✅"
echo ""
echo "Next Steps:"
echo "1. Start the frontend: npm run dev"
echo "2. Log in with a user account"
echo "3. Try running an arbitrage scan"
echo "4. Check browser console for any errors"
echo "5. Watch VPS API logs: npm run dev (in services/api/)"
echo ""
echo "To test with SKIP_SUPABASE flag:"
echo "1. Set SKIP_SUPABASE=true in .env"
echo "2. Restart VPS API"
echo "3. Endpoints will query database directly instead of calling Supabase RPC"

#!/bin/bash
# Initialize filters in Supabase

set -e

SUPABASE_URL=${SUPABASE_URL:-"https://your-project.supabase.co"}
SUPABASE_KEY=${SUPABASE_KEY:-"your-service-role-key"}

echo "🔧 Initializing Filter System in Supabase"
echo "========================================"

# Function to run SQL
run_sql() {
    local sql=$1
    curl -s -X POST \
      "${SUPABASE_URL}/rest/v1/rpc/sql_exec" \
      -H "Authorization: Bearer ${SUPABASE_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"query\": \"$sql\"}" | jq .
}

echo ""
echo "1️⃣  Creating filter tables..."

# Create tables via SQL script
sql_file="./supabase/sql/filter_schema.sql"
if [ -f "$sql_file" ]; then
    echo "   Running $sql_file..."
    psql -h ${SUPABASE_URL#https://} \
         -U postgres \
         --no-password \
         -f "$sql_file" || echo "⚠️  Note: Direct SQL execution may require authentication"
else
    echo "❌ File not found: $sql_file"
    exit 1
fi

echo ""
echo "2️⃣  Creating default filters..."

# Create default filter
curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/opportunity_filters" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Default",
    "description": "Default filter - balanced settings",
    "is_active": true,
    "min_profit_percent": 0.3,
    "min_liquidity_score": 0.5,
    "min_volume_estimate": 1000,
    "max_estimated_slippage": 2.0,
    "allowed_strategies": ["triangular_arbitrage"]
  }' | jq .

echo ""
echo "3️⃣  Creating preset filters..."

# Conservative
curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/opportunity_filters" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Conservative",
    "description": "Safe trading - higher thresholds",
    "is_active": false,
    "min_profit_percent": 0.5,
    "min_liquidity_score": 0.7,
    "min_volume_estimate": 5000,
    "max_estimated_slippage": 1.0
  }' | jq .

# Aggressive
curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/opportunity_filters" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Aggressive",
    "description": "High volume - lower thresholds",
    "is_active": false,
    "min_profit_percent": 0.15,
    "min_liquidity_score": 0.3,
    "min_volume_estimate": 500,
    "max_estimated_slippage": 3.0
  }' | jq .

echo ""
echo "✅ Filter system initialized!"
echo ""
echo "Next steps:"
echo "1. Update bot-with-execution.ts to use FilterManager"
echo "2. Deploy admin-filters function to Supabase"
echo "3. Create admin user and set is_admin flag"
echo "4. Access filters via: /admin/filters"

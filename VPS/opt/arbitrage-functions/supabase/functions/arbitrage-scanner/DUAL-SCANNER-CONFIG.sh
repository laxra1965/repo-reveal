#!/bin/bash

# ============================================================================
# INTEGRATED DUAL-SCANNER CONFIGURATION
# ============================================================================
# 
# This guide shows how to enable and configure the integrated scanner system
# that combines:
# 1. Old Scanner class (systematic triangular path generation)
# 2. CMC filter (reduces search space by 83%)
# 3. Legacy functions (specialized pattern detection)
# 4. Depth enrichment (order book analysis)
# 

# ============================================================================
# ENVIRONMENT VARIABLES
# ============================================================================

# Enable/disable Scanner V2 (old Scanner class with systematic path generation)
# Default: true (enabled)
# Set to false to use ONLY legacy detection functions
export ENABLE_SCANNER_V2=true

# CMC API key for filter initialization
# REQUIRED for CMC filtering (Phase 1)
# Get from: https://coinmarketcap.com/api/
export CMC_API_KEY="your_cmc_api_key_here"

# Minimum profit threshold (%)
# Legacy: 0.8%
# Scanner V2: 0.5% (stricter, better quality)
export MIN_PROFIT_PERCENT=0.5

# Trade amount in USDT
# How much capital to assume per trade
export TRADE_AMOUNT=100

# Top mover limit (affects search diversity)
# Reduce for faster scans, increase for more opportunities
export TOP_MOVER_LIMIT=50

# Runtime environment
export RUNTIME=vps  # or 'serverless' for Supabase Functions

# ============================================================================
# PERFORMANCE TUNING
# ============================================================================

# Number of parallel exchanges to scan
# Default: 6 (binance, bybit, gate, mexc, kucoin, okx)
# Can reduce for VPS with limited resources
EXCHANGES=("binance" "bybit" "gate" "mexc" "kucoin" "okx")

# Cache paths in Scanner V2
# Improves performance for repeated scans
# Default: true
CACHE_PATHS=true

# ============================================================================
# WHAT EACH COMPONENT DOES
# ============================================================================

# 1. CMC FILTER (Phase 1)
#    - Fetches top coins from CoinMarketCap
#    - Returns ~30-50 high-quality symbols
#    - Reduces search space from 1000+ to ~30
#    - Time: ~300ms
#
# 2. SCANNER V2 (Phase 2A)
#    - Takes CMC symbols
#    - Generates all triangular paths
#    - Scans with proper fee calculation
#    - Analyzes order book depth
#    - Time: ~500-1000ms (depending on symbols count)
#    - Coverage: Systematic (all possible triangles)
#
# 3. LEGACY DETECTION (Phase 2B)
#    - BNB-centric triangles
#    - Single-exchange triangles
#    - Stablecoin arbitrage
#    - Multi-bridge paths
#    - Cross-exchange patterns
#    - Time: ~200-500ms per exchange
#    - Coverage: Specialized patterns
#
# 4. DEDUPLICATION (Phase 3)
#    - Merges Scanner V2 + Legacy results
#    - Removes duplicates (keeps highest profit)
#    - Sorts by profitability
#    - Time: ~50ms
#
# 5. ENRICHMENT (Phase 4)
#    - Fetches real order book depth
#    - Calculates actual slippage
#    - Simulates execution
#    - Final profit check
#    - Time: ~1-2 seconds (top opportunities only)

# ============================================================================
# EXPECTED RESULTS
# ============================================================================

# Without CMC Filter (SCAN_EVERYTHING=true, ENABLE_CMC=false):
# - Search space: 1000+ pairs
# - Scan time: 30-60 seconds
# - Opportunities: 0-3
# - False positives: High
#
# With CMC Filter only (ENABLE_CMC=true, ENABLE_SCANNER_V2=false):
# - Search space: ~30 pairs
# - Scan time: 5-10 seconds
# - Opportunities: 2-5
# - False positives: Medium
#
# With Scanner V2 + CMC (ENABLE_CMC=true, ENABLE_SCANNER_V2=true):
# - Search space: ~30 pairs (CMC filtered)
# - Scan time: 5-15 seconds
# - Opportunities: 3-8
# - False positives: Low
# - Coverage: Comprehensive
#
# With Full Integration (all enabled):
# - Search space: ~30 pairs (CMC filtered)
# - Scan time: 8-20 seconds
# - Opportunities: 5-12
# - False positives: Very low
# - Coverage: Complete + specialized patterns

# ============================================================================
# QUICK START
# ============================================================================

# Option 1: CMC Filter Only (Recommended for quick scans)
export ENABLE_SCANNER_V2=false
export CMC_API_KEY="your_key"
# Scan time: ~5 seconds
# Opportunities: 2-4

# Option 2: Scanner V2 + CMC (Recommended for best quality)
export ENABLE_SCANNER_V2=true
export CMC_API_KEY="your_key"
# Scan time: ~10 seconds
# Opportunities: 3-8
# Quality: Highest

# Option 3: Legacy Only (No CMC, slower)
export ENABLE_SCANNER_V2=false
export CMC_API_KEY=""
# Scan time: ~15 seconds
# Opportunities: 2-5
# May miss some patterns

# ============================================================================
# MONITORING
# ============================================================================

# Check logs for integration status:
# grep "SCANNER V2" logs.txt        # Scanner V2 execution
# grep "CMC Filter" logs.txt         # CMC filter results
# grep "Legacy detection" logs.txt   # Legacy function results
# grep "Found.*opportunities" logs.txt  # Total opportunities

# ============================================================================
# TROUBLESHOOTING
# ============================================================================

# Problem: No opportunities found
# Solution 1: Check CMC_API_KEY is valid
# Solution 2: Lower MIN_PROFIT_PERCENT to 0.1%
# Solution 3: Increase TOP_MOVER_LIMIT to 100
# Solution 4: Check exchange status (API outages?)

# Problem: Slow scans (>30 seconds)
# Solution 1: Disable ENABLE_SCANNER_V2=false
# Solution 2: Reduce TOP_MOVER_LIMIT to 25
# Solution 3: Reduce number of exchanges
# Solution 4: Increase tradeAmount (faster filtering)

# Problem: Inaccurate profits
# Solution 1: Enable depth enrichment (Phase 4)
# Solution 2: Lower MIN_PROFIT_PERCENT to get more samples
# Solution 3: Check exchange fee configuration

# ============================================================================
# ADVANCED CONFIGURATION
# ============================================================================

# Adjust Scanner V2 parameters in index.ts around line 370:
# minProfitPercent: 0.3     # Lower = more opportunities but lower quality
# enablePhase1PreFilter: true  # Always use pre-filter (huge speedup)
# enablePhase2SlippageAnalysis: true  # Depth analysis
# enableMinLiquidityDepthCheck: false  # Require minimum depth

# ============================================================================
# DEPLOYMENT
# ============================================================================

# 1. Update .env with configuration
# 2. Deploy Supabase function: supabase functions deploy arbitrage-scanner
# 3. Check logs: supabase functions logs arbitrage-scanner
# 4. Monitor: tail -f logs/arbitrage-scanner.log

# ============================================================================

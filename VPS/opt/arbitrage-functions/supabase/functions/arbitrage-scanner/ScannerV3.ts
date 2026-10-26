/**
 * Scanner V3: Production-Optimized Arbitrage Detection
 * 
 * Implements Tier 1/Tier 2 pair prioritization:
 * - Tier 1: Always subscribed, high priority, <10ms recalculation target
 * - Tier 2: Adaptive, event-triggered, 50-200ms acceptable latency
 * 
 * Features:
 * - Volatility-weighted scanning (increase frequency for volatile assets)
 * - Depth-aware profitability analysis
 * - Opportunity decay scoring
 * - Recommended pair counts per exchange
 */

export interface ScannerV3Config {
  tier1Limit: number;      // Tier 1 pairs (always scanned)
  tier2Limit: number;      // Tier 2 pairs (adaptive)
  minProfitPercent: number;
  maxSlippage: number;
  tradeAmount: number;
  enableVolatilityWeighting: boolean;
  enableDepthAnalysis: boolean;
  enableDecayScoring: boolean;
}

export interface PairTier {
  symbol: string;
  tier: 1 | 2;
  bidPrice: number;
  askPrice: number;
  volatility: number;
  volume24h?: number;
  lastUpdate?: number;
}

export interface OpportunityScan {
  type: 'triangular_arbitrage' | 'multi_bridge';
  basePath: string[];
  pairs: string[];
  profit: number;
  profitPercent: number;
  durationMs: number;
  spreadStability: number;     // 0-1, how stable the spread is
  fillProbability: number;     // 0-1, estimated fill success rate
  depthScore: number;          // 0-1, based on order book depth
  decayScore: number;          // 0-1, higher = fresher opportunity
}

// Recommended pair counts by exchange
const RECOMMENDED_COUNTS: Record<string, { tier1: number; tier2: number }> = {
  'binance': { tier1: 50, tier2: 400 },
  'bybit': { tier1: 30, tier2: 250 },
  'gate': { tier1: 30, tier2: 250 },
  'okx': { tier1: 25, tier2: 200 },
  'kucoin': { tier1: 20, tier2: 150 },
  'mexc': { tier1: 20, tier2: 150 }
};

// Tier 1 priority tokens (always include)
const TIER1_TOKENS = {
  bases: ['USDT', 'BTC', 'ETH', 'USDC'],
  quotes: ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE']
};

/**
 * Score a pair's volatility (0-1, higher = more volatile)
 */
export const scoreVolatility = (change24h: number, high24h: number, low24h: number): number => {
  if (!high24h || !low24h || high24h === low24h) return 0;
  const range = (high24h - low24h) / low24h;
  const change = Math.abs(change24h / 100);
  return Math.min(1, (range + change) / 2);
};

/**
 * Score order book depth (0-1, higher = deeper book)
 */
export const scoreDepth = (bids: any[], asks: any[], minLiquidity: number = 10000): number => {
  if (!bids?.length || !asks?.length) return 0;
  
  const bidDepth = bids.slice(0, 10).reduce((sum, [, qty]) => sum + qty, 0);
  const askDepth = asks.slice(0, 10).reduce((sum, [, qty]) => sum + qty, 0);
  const totalDepth = (bidDepth + askDepth) / 2;
  
  return Math.min(1, totalDepth / minLiquidity);
};

/**
 * Score spread stability (0-1, lower spread = higher score)
 */
export const scoreSpreadStability = (bid: number, ask: number, prevBid: number, prevAsk: number): number => {
  if (!prevBid || !prevAsk) return 0.5; // neutral if no previous
  
  const currentSpread = (ask - bid) / bid;
  const prevSpread = (prevAsk - prevBid) / prevBid;
  const spreadChange = Math.abs(currentSpread - prevSpread);
  
  // Lower spread change = higher stability
  return Math.max(0, 1 - (spreadChange * 100));
};

/**
 * Score fill probability based on depth and volatility
 */
export const scoreFillProbability = (depth: number, volatility: number, spreadStability: number): number => {
  // Deep book + stable spread + low volatility = high fill probability
  return (depth * 0.4) + (spreadStability * 0.4) + ((1 - volatility) * 0.2);
};

/**
 * Score opportunity decay (0-1, higher = fresher)
 * Fresh opportunities decay over time as market moves
 */
export const scoreDecay = (ageMs: number, profitPercent: number): number => {
  // Opportunities older than 5s decay significantly
  const maxAgeMs = 5000;
  const ageDecay = Math.max(0, 1 - (ageMs / maxAgeMs));
  
  // Higher profit opportunities have lower decay (worth holding)
  const profitBonus = Math.min(0.3, profitPercent / 10);
  
  return Math.min(1, ageDecay + profitBonus);
};

/**
 * Categorize pairs into Tier 1 and Tier 2
 */
export const stratifyPairs = (
  allPairs: PairTier[],
  exchange: string
): { tier1: PairTier[]; tier2: PairTier[] } => {
  const { tier1: tier1Limit, tier2: tier2Limit } = RECOMMENDED_COUNTS[exchange] || { tier1: 30, tier2: 200 };
  
  const tier1 = new Map<string, PairTier>();
  const tier2: PairTier[] = [];
  
  // First pass: Force Tier 1 priority tokens
  for (const pair of allPairs) {
    const [base, quote] = pair.symbol.split(/(?=[A-Z]{2,}$)/);
    
    if (TIER1_TOKENS.bases.includes(base) || TIER1_TOKENS.quotes.includes(base)) {
      if (tier1.size < tier1Limit) {
        tier1.set(pair.symbol, { ...pair, tier: 1 });
        continue;
      }
    }
  }
  
  // Second pass: Fill remaining Tier 1 by volatility
  const remaining = allPairs.filter(p => !tier1.has(p.symbol));
  remaining.sort((a, b) => b.volatility - a.volatility);
  
  for (const pair of remaining) {
    if (tier1.size >= tier1Limit) break;
    tier1.set(pair.symbol, { ...pair, tier: 1 });
  }
  
  // Remaining pairs go to Tier 2 (top by volume/volatility)
  remaining
    .filter(p => !tier1.has(p.symbol))
    .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
    .slice(0, tier2Limit)
    .forEach(p => tier2.push({ ...p, tier: 2 }));
  
  return {
    tier1: Array.from(tier1.values()),
    tier2
  };
};

/**
 * Validate triangle construction
 * Good: LINK/BTC, BTC/USDT, LINK/USDT (liquid majors)
 * Bad: RANDOMALT/SHIB, SHIB/DOGE, DOGE/RANDOMALT (illiquid alts)
 */
export const validateTriangle = (pairs: string[], priceMap: Record<string, any>): boolean => {
  // All pairs must exist in priceMap
  if (!pairs.every(p => priceMap[p])) return false;
  
  // At least one pair should be a major (BTC/ETH/USDT)
  const majors = ['BTC', 'ETH', 'USDT', 'USDC'];
  const hasMajor = pairs.some(p => majors.some(m => p.includes(m)));
  
  return hasMajor;
};

/**
 * Enrich opportunity with decay and fill scores
 */
export const enrichOpportunity = (
  opp: any,
  priceMap: Record<string, any>,
  depthCache: Record<string, any>
): OpportunityScan => {
  const now = Date.now();
  const ageMs = (opp.detectedAt && now - opp.detectedAt) || 0;
  
  // Calculate depth score from cached order books
  let depthScore = 0;
  if (depthCache && opp.pairs?.length > 0) {
    const depths = opp.pairs
      .map((p: string) => depthCache[p]?.depth || 0)
      .filter((d: number) => d > 0);
    depthScore = depths.length > 0 ? depths.reduce((a: number, b: number) => a + b, 0) / depths.length : 0;
  }
  
  // Estimate spread stability and fill probability
  const spreadStability = scoreSpreadStability(
    priceMap[opp.pairs[0]]?.bidPrice,
    priceMap[opp.pairs[0]]?.askPrice,
    opp.prevBid,
    opp.prevAsk
  );
  
  const fillProbability = scoreFillProbability(
    depthScore,
    opp.volatility || 0,
    spreadStability
  );
  
  const decayScore = scoreDecay(ageMs, opp.profit_percent || 0);
  
  return {
    type: opp.type || 'triangular_arbitrage',
    basePath: opp.path || [],
    pairs: opp.pairs || [],
    profit: opp.profit_amount || 0,
    profitPercent: opp.profit_percent || 0,
    durationMs: ageMs,
    spreadStability,
    fillProbability,
    depthScore,
    decayScore
  };
};

/**
 * Rank opportunities by composite score
 * Higher weights on: profit, fill probability, decay (freshness)
 */
export const rankOpportunities = (opps: OpportunityScan[]): OpportunityScan[] => {
  return opps
    .map(opp => ({
      ...opp,
      _score: (
        (opp.profitPercent / 10) * 0.4 +           // 40% profit
        opp.fillProbability * 0.35 +               // 35% fill probability
        opp.decayScore * 0.15 +                    // 15% freshness
        opp.depthScore * 0.1                       // 10% depth
      )
    }))
    .sort((a, b) => (b as any)._score - (a as any)._score)
    .map(({ _score, ...opp }) => opp);
};

export default {
  scoreVolatility,
  scoreDepth,
  scoreSpreadStability,
  scoreFillProbability,
  scoreDecay,
  stratifyPairs,
  validateTriangle,
  enrichOpportunity,
  rankOpportunities,
  TIER1_TOKENS,
  RECOMMENDED_COUNTS
};

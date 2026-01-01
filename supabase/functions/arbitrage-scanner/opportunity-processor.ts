// Opportunity processing pipeline

import { calculateExpirySeconds } from './config.ts';

/**
 * Calculate quality score for an opportunity
 * @param profit - Profit percentage
 * @param liq - Liquidity score
 * @param vol - Average volume
 * @returns Quality score (0-100)
 */
export function calculateQualityScore(profit: number, liq: number, vol: number): number {
  let score = 0;
  if (profit >= 1.0) score += 50; else if (profit >= 0.5) score += 35; else if (profit >= 0.1) score += 20;
  if (liq >= 80) score += 30; else if (liq >= 60) score += 20; else if (liq >= 50) score += 10;
  if (vol >= 1000) score += 20; else if (vol >= 500) score += 15; else if (vol >= 100) score += 10;
  return score;
}

/**
 * Process opportunities through deduplication, scoring, sorting, and filtering
 * @param tri - Triangular arbitrage opportunities
 * @param cross - Cross-exchange arbitrage opportunities
 * @param short - Short signal opportunities
 * @param minProfit - Minimum profit percentage threshold
 * @param maxResults - Maximum number of results to return
 * @param ml - Whether ML filtering is enabled
 * @returns Processed opportunities with metadata
 */
export function processOpportunitiesPipeline(
  tri: any[],
  cross: any[],
  short: any[],
  minProfit: number,
  maxResults: number,
  ml: boolean
): any {
  const all = [...tri, ...cross, ...short];
  const unique = Array.from(new Map(all.map(o => [`${o.exchange1}_${o.exchange2}_${o.exchange3}_${o.base_symbol}_${o.intermediate_symbol}_${o.quote_symbol}_${o.type}`, o])).values());

  const processed = unique.map(o => ({
    ...o,
    quality_score: calculateQualityScore(o.profit_percent, o.liquidity_score || 0, (o.step1_volume + o.step2_volume + o.step3_volume) / 3),
    expires_at: new Date(Date.now() + calculateExpirySeconds(o.profit_percent) * 1000).toISOString(),
    detected_at: new Date().toISOString()  // Track when opportunity was found
  }))
    .filter(o => o.profit_percent >= minProfit && o.profit_percent <= 50)
    .sort((a, b) => b.quality_score - a.quality_score || b.profit_percent - a.profit_percent)
    .slice(0, maxResults);

  if (all.length > 0) {
    const bestPotential = [...all].sort((a, b) => b.profit_percent - a.profit_percent).slice(0, 3);
    console.log(`Pipeline Status: Input=${all.length}, Best Potential Profit=${bestPotential[0]?.profit_percent.toFixed(4)}%, Threshold=${minProfit.toFixed(4)}%`);
  }

  return { opportunities: processed, mergeStats: { totalInput: all.length, afterDeduplication: unique.length, final: processed.length } };
}

/**
 * Upsert opportunities to database
 * @param supabase - Supabase client instance
 * @param opportunities - Array of opportunities to upsert
 * @returns Number of inserted opportunities
 */
export async function upsertOpportunities(supabase: any, opportunities: any[]) {
  if (opportunities.length === 0) return { inserted: 0 };
  const { data, error } = await supabase.from('arbitrage_opportunities').upsert(opportunities, { onConflict: 'user_id,base_symbol,quote_symbol,intermediate_symbol,exchange1,exchange2,exchange3,type' }).select();
  if (error) console.error('Upsert error:', error);
  return { inserted: data?.length || 0 };
}


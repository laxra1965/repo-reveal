/**
 * Triangle Builder
 * Constructs triangular arbitrage paths using filtered symbols
 * 
 * Structure: BASE → ALT → BASE
 * Where: BASE ∈ {USDT, BTC, ETH}, ALT ∈ filteredSymbols
 * 
 * Output: Efficient triangle structures ready for the execution engine
 */

import { parsePair } from './exchange-pair-filter.ts';

export interface TriangleCandidate {
  exchange: string;
  path: string[];           // e.g., ["USDT", "ARB", "BTC", "USDT"]
  pairs: string[];          // e.g., ["ARB/USDT", "ARB/BTC", "BTC/USDT"]
  bases_used: [string, string]; // e.g., ["USDT", "BTC"]
  intermediate: string;     // e.g., "ARB"
}

export interface TriangleBuildConfig {
  validBases?: string[];    // default: ["USDT", "BTC", "ETH"]
  includeThreeBase?: boolean; // allow USDT-BTC-ETH-USDT triangles (default: true)
  minPairsPerAlt?: number;   // minimum pairs required for each ALT (default: 2)
}

/**
 * Build triangles from filtered pairs and CMC symbols
 * 
 * Strategy:
 * 1. For each pair, extract base and quote
 * 2. If quote is a valid base (USDT/BTC/ETH) and base is a CMC symbol
 * 3. Look for paths: BASE1 -> ALT -> BASE2 -> BASE1
 */
export function buildTriangles(
  availablePairs: string[],
  filteredSymbols: Set<string>,
  exchange: string,
  config: TriangleBuildConfig = {}
): TriangleCandidate[] {
  const validBases = config.validBases ?? ['USDT', 'BTC', 'ETH'];
  const minPairsPerAlt = config.minPairsPerAlt ?? 2;

  const triangles: TriangleCandidate[] = [];
  const pairsBySymbol = buildSymbolIndex(availablePairs);

  // For each filtered symbol (these will be our intermediates/alts)
  for (const alt of filteredSymbols) {
    // Skip if alt is a valid base (we don't want BASE->BASE->BASE)
    if (validBases.includes(alt)) continue;

    // Find all pairs involving this ALT
    const altPairs = (pairsBySymbol.get(alt) || [])
      .filter(p => shouldIncludeAltPair(p, alt, validBases));

    if (altPairs.length < minPairsPerAlt) {
      // Not enough pairs for this ALT to form valid triangles
      continue;
    }

    // Extract all bases this ALT can pair with
    const altBases = new Set<string>();
    for (const pair of altPairs) {
      const parsed = parsePair(pair);
      if (parsed) {
        if (parsed.base === alt && validBases.includes(parsed.quote)) {
          altBases.add(parsed.quote);
        } else if (parsed.quote === alt && validBases.includes(parsed.base)) {
          altBases.add(parsed.base);
        }
      }
    }

    // Build triangles: BASE1 -> ALT -> BASE2 -> BASE1
    const bases = Array.from(altBases);
    for (let i = 0; i < bases.length; i++) {
      for (let j = i + 1; j < bases.length; j++) {
        const base1 = bases[i];
        const base2 = bases[j];

        // Check if we have all three pairs needed
        const pair1 = findPair(availablePairs, alt, base1); // ALT/BASE1
        const pair2 = findPair(availablePairs, alt, base2); // ALT/BASE2
        const pair3 = findPair(availablePairs, base1, base2); // BASE1/BASE2

        if (pair1 && pair2 && pair3) {
          triangles.push({
            exchange,
            path: [base1, alt, base2, base1],
            pairs: [pair1, pair2, pair3],
            bases_used: [base1, base2],
            intermediate: alt,
          });
        }
      }
    }

    // Also allow three-base triangles if configured
    if (config.includeThreeBase && bases.length >= 3) {
      const threeBases = Array.from(altBases).sort();
      // BASE1 -> ALT -> BASE2 -> BASE3 -> BASE1 is too complex, skip
      // Stick to two-base triangles
    }
  }

  return triangles;
}

/**
 * Build index of pairs by symbol (for quick lookups)
 */
function buildSymbolIndex(pairs: string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const pair of pairs) {
    const parsed = parsePair(pair);
    if (parsed) {
      const { base, quote } = parsed;

      // Index by base
      if (!index.has(base)) index.set(base, []);
      index.get(base)!.push(pair);

      // Index by quote
      if (!index.has(quote)) index.set(quote, []);
      index.get(quote)!.push(pair);
    }
  }

  return index;
}

/**
 * Check if a pair should be used with an ALT symbol
 */
function shouldIncludeAltPair(
  pair: string,
  alt: string,
  validBases: string[]
): boolean {
  const parsed = parsePair(pair);
  if (!parsed) return false;

  const { base, quote } = parsed;

  // Pair must involve the ALT
  if (base !== alt && quote !== alt) return false;

  // The other side must be a valid base
  const other = base === alt ? quote : base;
  return validBases.includes(other);
}

/**
 * Find a pair between two symbols (bidirectional)
 */
function findPair(
  pairs: string[],
  symbol1: string,
  symbol2: string
): string | null {
  // Try symbol1/symbol2 format
  for (const pair of pairs) {
    const parsed = parsePair(pair);
    if (parsed) {
      if ((parsed.base === symbol1 && parsed.quote === symbol2) ||
          (parsed.base === symbol2 && parsed.quote === symbol1)) {
        return pair;
      }
    }
  }
  return null;
}

/**
 * Format triangles as StandardOpportunity-compatible objects
 */
export function formatTrianglesForEngine(
  triangles: TriangleCandidate[]
): TriangleInput[] {
  return triangles.map(t => ({
    exchange: t.exchange,
    path: t.path,
    pairs: t.pairs,
    immediate: t.intermediate,
  }));
}

export interface TriangleInput {
  exchange: string;
  path: string[];
  pairs: string[];
  immediate: string;
}

/**
 * Statistics about built triangles
 */
export function getTriangleStats(triangles: TriangleCandidate[]): Record<string, any> {
  const byExchange: Record<string, number> = {};
  const byIntermediate: Record<string, number> = {};

  for (const t of triangles) {
    byExchange[t.exchange] = (byExchange[t.exchange] || 0) + 1;
    byIntermediate[t.intermediate] = (byIntermediate[t.intermediate] || 0) + 1;
  }

  return {
    total: triangles.length,
    byExchange,
    byIntermediate,
    uniqueIntermediates: Object.keys(byIntermediate).length,
  };
}

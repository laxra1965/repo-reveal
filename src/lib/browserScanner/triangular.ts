export interface Quote {
  bid: number;
  ask: number;
  ts: number;
}

/** Order book keyed by `${BASE}/${QUOTE}` */
export type Book = Record<string, Quote>;

export interface LocalOpportunity {
  id: string;
  exchange: string;
  strategy: string;
  path: string;
  pairs: [string, string, string];
  profitPercent: number;
  grossPercent: number;
  detectedAt: number;
}

/** Taker fee applied on every leg (0.1%) */
export const LEG_FEE = 0.001;

/** Quote currency legs always start and end in */
export const QUOTE_CURRENCY = 'USDT';

/** Intermediate assets used to build triangles */
export const DEFAULT_BASES = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'LTC', 'TRX', 'LINK'];

const MAX_AGE_MS = 15_000;

function fresh(q: Quote | undefined, now: number): q is Quote {
  return Boolean(q && q.bid > 0 && q.ask > 0 && now - q.ts < MAX_AGE_MS);
}

/**
 * Scan a single exchange book for triangular routes:
 * USDT -> A -> B -> USDT
 */
export function findTriangular(
  exchange: string,
  book: Book,
  bases: string[] = DEFAULT_BASES,
  quote: string = QUOTE_CURRENCY,
): LocalOpportunity[] {
  const now = Date.now();
  const results: LocalOpportunity[] = [];

  for (const a of bases) {
    const legA = book[`${a}/${quote}`];
    if (!fresh(legA, now)) continue;

    for (const b of bases) {
      if (a === b) continue;
      const legC = book[`${b}/${quote}`];
      if (!fresh(legC, now)) continue;

      const direct = book[`${a}/${b}`];
      const inverse = book[`${b}/${a}`];

      let midRate: number | null = null;
      let midPair: string | null = null;

      if (fresh(direct, now)) {
        // Sell A for B at the bid
        midRate = direct.bid;
        midPair = `${a}/${b}`;
      } else if (fresh(inverse, now)) {
        // Buy B with A at the ask
        midRate = 1 / inverse.ask;
        midPair = `${b}/${a}`;
      }

      if (midRate == null || midPair == null) continue;

      const net = 1 - LEG_FEE;
      const amountA = (1 / legA.ask) * net;
      const amountB = amountA * midRate * net;
      const final = amountB * legC.bid * net;

      const profitPercent = (final - 1) * 100;
      const gross = ((1 / legA.ask) * midRate * legC.bid - 1) * 100;

      if (!Number.isFinite(profitPercent) || profitPercent <= 0) continue;
      // Anything above this is almost certainly a stale or broken quote
      if (profitPercent > 5) continue;

      results.push({
        id: `${exchange}:${a}:${b}:${Math.floor(now / 1000)}`,
        exchange,
        strategy: 'triangular',
        path: `${quote} > ${a} > ${b} > ${quote}`,
        pairs: [`${a}/${quote}`, midPair, `${b}/${quote}`],
        profitPercent: Number(profitPercent.toFixed(4)),
        grossPercent: Number(gross.toFixed(4)),
        detectedAt: now,
      });
    }
  }

  return results.sort((x, y) => y.profitPercent - x.profitPercent);
}

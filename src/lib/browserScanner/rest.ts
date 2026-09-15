import type { SupportedExchange } from './feeds';

interface RestQuote {
  pair: string;
  bid: number;
  ask: number;
}

const TIMEOUT_MS = 8_000;

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Public REST snapshot, used to seed the book before the websocket warms up
 * and as a fallback whenever a socket is down.
 */
export async function fetchSnapshot(
  exchange: SupportedExchange,
  pairs: string[],
): Promise<RestQuote[]> {
  if (exchange === 'binance') {
    const wanted = new Map(pairs.map((p) => [p.replace('/', ''), p]));
    const data = await getJson('https://api.binance.com/api/v3/ticker/bookTicker');
    if (!Array.isArray(data)) return [];
    return data.flatMap((row: any) => {
      const pair = wanted.get(row.symbol);
      if (!pair) return [];
      const bid = Number(row.bidPrice);
      const ask = Number(row.askPrice);
      return bid > 0 && ask > 0 ? [{ pair, bid, ask }] : [];
    });
  }

  if (exchange === 'bybit') {
    const wanted = new Map(pairs.map((p) => [p.replace('/', ''), p]));
    const data = await getJson('https://api.bybit.com/v5/market/tickers?category=spot');
    const list = data?.result?.list;
    if (!Array.isArray(list)) return [];
    return list.flatMap((row: any) => {
      const pair = wanted.get(row.symbol);
      if (!pair) return [];
      const bid = Number(row.bid1Price);
      const ask = Number(row.ask1Price);
      return bid > 0 && ask > 0 ? [{ pair, bid, ask }] : [];
    });
  }

  const wanted = new Map(pairs.map((p) => [p.replace('/', '-'), p]));
  const data = await getJson('https://www.okx.com/api/v5/market/tickers?instType=SPOT');
  const list = data?.data;
  if (!Array.isArray(list)) return [];
  return list.flatMap((row: any) => {
    const pair = wanted.get(row.instId);
    if (!pair) return [];
    const bid = Number(row.bidPx);
    const ask = Number(row.askPx);
    return bid > 0 && ask > 0 ? [{ pair, bid, ask }] : [];
  });
}

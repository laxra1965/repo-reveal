import { logError, logInfo } from './logger.ts';
import type { StandardOpportunity } from './opportunity-types.ts';

type OrderBookSide = Array<{ price: number; size: number }>;

interface OrderBook {
  bids: OrderBookSide;
  asks: OrderBookSide;
}

const DEPTH_LIMIT = parseInt(Deno.env.get('ORDERBOOK_DEPTH_LIMIT') || '50', 10);

const toExchangeSymbol = (exchange: string, standardSymbol: string): string => {
  const base = standardSymbol.toUpperCase();
  switch (exchange) {
    case 'gate':
      return `${base.slice(0, -4)}_${base.slice(-4)}`; // e.g. BNBUSDT -> BNB_USDT
    case 'kucoin':
    case 'okx':
      return `${base.slice(0, -4)}-${base.slice(-4)}`; // e.g. BNBUSDT -> BNB-USDT
    default:
      return base;
  }
};

const fetchOrderBook = async (exchange: string, symbol: string): Promise<OrderBook | null> => {
  const ex = exchange.toLowerCase();
  const stdSymbol = symbol.toUpperCase();
  const exSymbol = toExchangeSymbol(ex, stdSymbol);

  try {
    if (ex === 'binance') {
      const r = await fetch(`https://api.binance.com/api/v3/depth?symbol=${exSymbol}&limit=${DEPTH_LIMIT}`);
      if (!r.ok) throw new Error(`Binance depth failed: ${r.status}`);
      const data = await r.json();
      return {
        bids: (data.bids || []).map((l: [string, string]) => ({ price: parseFloat(l[0]), size: parseFloat(l[1]) })),
        asks: (data.asks || []).map((l: [string, string]) => ({ price: parseFloat(l[0]), size: parseFloat(l[1]) })),
      };
    }

    if (ex === 'bybit') {
      const r = await fetch(
        `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${exSymbol}&limit=${DEPTH_LIMIT}`
      );
      if (!r.ok) throw new Error(`Bybit depth failed: ${r.status}`);
      const data = await r.json();
      const bids: OrderBookSide = [];
      const asks: OrderBookSide = [];
      for (const l of data.result?.list || []) {
        const price = parseFloat(l.price || '0');
        const size = parseFloat(l.size || '0');
        if (!isFinite(price) || !isFinite(size) || price <= 0 || size <= 0) continue;
        if (l.side === 'Buy') bids.push({ price, size });
        else if (l.side === 'Sell') asks.push({ price, size });
      }
      return { bids, asks };
    }

    if (ex === 'gate') {
      const r = await fetch(
        `https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${exSymbol}&limit=${DEPTH_LIMIT}`
      );
      if (!r.ok) throw new Error(`Gate depth failed: ${r.status}`);
      const data = await r.json();
      return {
        bids: (data.bids || []).map((l: [string, string]) => ({ price: parseFloat(l[0]), size: parseFloat(l[1]) })),
        asks: (data.asks || []).map((l: [string, string]) => ({ price: parseFloat(l[0]), size: parseFloat(l[1]) })),
      };
    }

    if (ex === 'mexc') {
      const r = await fetch(`https://api.mexc.com/api/v3/depth?symbol=${exSymbol}&limit=${DEPTH_LIMIT}`);
      if (!r.ok) throw new Error(`MEXC depth failed: ${r.status}`);
      const data = await r.json();
      return {
        bids: (data.bids || []).map((l: [string, string]) => ({ price: parseFloat(l[0]), size: parseFloat(l[1]) })),
        asks: (data.asks || []).map((l: [string, string]) => ({ price: parseFloat(l[0]), size: parseFloat(l[1]) })),
      };
    }

    if (ex === 'kucoin') {
      // KuCoin only supports level2_20 and level2_100
      const kucoinDepth = DEPTH_LIMIT >= 100 ? 100 : 20;
      const r = await fetch(
        `https://api.kucoin.com/api/v1/market/orderbook/level2_${kucoinDepth}?symbol=${exSymbol}`
      );
      if (!r.ok) throw new Error(`KuCoin depth failed: ${r.status}`);
      const data = await r.json();
      return {
        bids: (data.data?.bids || []).map((l: [string, string]) => ({ price: parseFloat(l[0]), size: parseFloat(l[1]) })),
        asks: (data.data?.asks || []).map((l: [string, string]) => ({ price: parseFloat(l[0]), size: parseFloat(l[1]) })),
      };
    }

    if (ex === 'okx') {
      const r = await fetch(
        `https://www.okx.com/api/v5/market/books?instId=${exSymbol}&sz=${DEPTH_LIMIT}`
      );
      if (!r.ok) throw new Error(`OKX depth failed: ${r.status}`);
      const data = await r.json();
      const first = data.data?.[0] || {};
      return {
        bids: (first.bids || []).map((l: [string, string]) => ({ price: parseFloat(l[0]), size: parseFloat(l[1]) })),
        asks: (first.asks || []).map((l: [string, string]) => ({ price: parseFloat(l[0]), size: parseFloat(l[1]) })),
      };
    }

    return null;
  } catch (err) {
    logError('depth-metrics', `Error fetching orderbook for ${exchange} ${symbol}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
};

const computeDepthMetrics = (
  orderbook: OrderBook,
  volumeEstimate: number
): { liquidityScore: number; estimatedSlippage: number; depthQuote: number } => {
  const depthAsk = orderbook.asks.reduce((sum, l) => sum + l.price * l.size, 0);
  const depthBid = orderbook.bids.reduce((sum, l) => sum + l.price * l.size, 0);
  const depthQuote = Math.min(depthAsk, depthBid);

  const requiredDepth = volumeEstimate * 5; // as per spec: trade_size * 5

  let liquidityScore = depthQuote / requiredDepth;
  if (!isFinite(liquidityScore)) liquidityScore = 0;
  if (liquidityScore < 0) liquidityScore = 0;
  if (liquidityScore > 1) liquidityScore = 1;

  let estimatedSlippage = 0;
  if (depthQuote <= 0 || requiredDepth <= 0) {
    estimatedSlippage = 1;
  } else {
    const ratio = requiredDepth / depthQuote;
    estimatedSlippage = Math.min(Math.max(ratio - 1, 0), 1);
  }

  return { liquidityScore, estimatedSlippage, depthQuote };
};

export const enrichOpportunitiesWithDepth = async (
  opps: StandardOpportunity[]
): Promise<StandardOpportunity[]> => {
  if (opps.length === 0) return opps;

  const cache = new Map<string, OrderBook | null>();

  const getBook = async (exchange: string | null, pair: string | null): Promise<OrderBook | null> => {
    if (!exchange || !pair) return null;
    const key = `${exchange.toLowerCase()}:${pair.toUpperCase()}`;
    if (cache.has(key)) return cache.get(key) || null;
    const ob = await fetchOrderBook(exchange, pair);
    cache.set(key, ob);
    return ob;
  };

  const enriched: StandardOpportunity[] = [];

  for (const opp of opps) {
    const books: (OrderBook | null)[] = await Promise.all([
      getBook(opp.exchange1, opp.pair1),
      getBook(opp.exchange2, opp.pair2),
      getBook(opp.exchange3, opp.pair3),
    ]);

    // If any leg is missing order book, treat as illiquid and high slippage so it gets filtered out.
    if (books.some(b => !b)) {
      enriched.push({
        ...opp,
        liquidity_score: 0,
        estimated_slippage: 1,
      });
      continue;
    }

    const volume = opp.volume_estimate || 0;

    const legMetrics = books.map(b => computeDepthMetrics(b as OrderBook, volume));

    const liquidityScore = Math.min(...legMetrics.map(m => m.liquidityScore));
    const estimatedSlippage = Math.min(
      legMetrics.reduce((sum, m) => sum + m.estimatedSlippage, 0),
      1
    );

    enriched.push({
      ...opp,
      liquidity_score: liquidityScore,
      estimated_slippage: estimatedSlippage,
    });
  }

  logInfo('depth-metrics', 'Enriched opportunities with depth metrics', {
    count: enriched.length,
  });

  return enriched;
};


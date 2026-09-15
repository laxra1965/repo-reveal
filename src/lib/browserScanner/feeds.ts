import { Book, DEFAULT_BASES, QUOTE_CURRENCY } from './triangular';

export type FeedStatus = 'idle' | 'connecting' | 'live' | 'error';
export type SupportedExchange = 'binance' | 'bybit' | 'okx';

export const BROWSER_SCANNER_EXCHANGES: SupportedExchange[] = ['binance', 'bybit', 'okx'];

export interface FeedHandle {
  close: () => void;
}

interface FeedCallbacks {
  onQuote: (pair: string, bid: number, ask: number) => void;
  onStatus: (status: FeedStatus) => void;
}

/** All pairs the scanner cares about, in `BASE/QUOTE` form */
export function buildPairUniverse(bases: string[] = DEFAULT_BASES): string[] {
  const pairs = new Set<string>();
  for (const base of bases) pairs.add(`${base}/${QUOTE_CURRENCY}`);
  // Cross pairs are quoted against the majors on most venues
  for (const base of bases) {
    for (const mid of ['BTC', 'ETH', 'BNB']) {
      if (base === mid) continue;
      pairs.add(`${base}/${mid}`);
    }
  }
  return [...pairs];
}

const RECONNECT_MS = 5_000;

function createSocket(
  url: string,
  cb: FeedCallbacks,
  onOpen: (ws: WebSocket) => void,
  onMessage: (raw: any, emit: FeedCallbacks['onQuote']) => void,
): FeedHandle {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const connect = () => {
    if (closed) return;
    cb.onStatus('connecting');
    try {
      ws = new WebSocket(url);
    } catch {
      cb.onStatus('error');
      retry = setTimeout(connect, RECONNECT_MS);
      return;
    }

    ws.onopen = () => {
      cb.onStatus('live');
      onOpen(ws!);
      heartbeat = setInterval(() => {
        try {
          ws?.send('ping');
        } catch {
          /* venues that reject text pings are fine */
        }
      }, 20_000);
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string' || event.data === 'pong') return;
      try {
        onMessage(JSON.parse(event.data), cb.onQuote);
      } catch {
        /* ignore malformed frames */
      }
    };

    ws.onerror = () => cb.onStatus('error');

    ws.onclose = () => {
      if (heartbeat) clearInterval(heartbeat);
      if (closed) return;
      cb.onStatus('error');
      retry = setTimeout(connect, RECONNECT_MS);
    };
  };

  connect();

  return {
    close: () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (heartbeat) clearInterval(heartbeat);
      try {
        ws?.close();
      } catch {
        /* already closed */
      }
    },
  };
}

function binance(pairs: string[], cb: FeedCallbacks): FeedHandle {
  const wanted = new Map(pairs.map((p) => [p.replace('/', ''), p]));
  return createSocket(
    'wss://stream.binance.com:9443/ws/!bookTicker',
    cb,
    () => {},
    (msg, emit) => {
      const pair = wanted.get(msg?.s);
      if (!pair) return;
      const bid = Number(msg.b);
      const ask = Number(msg.a);
      if (bid > 0 && ask > 0) emit(pair, bid, ask);
    },
  );
}

function bybit(pairs: string[], cb: FeedCallbacks): FeedHandle {
  const wanted = new Map(pairs.map((p) => [p.replace('/', ''), p]));
  return createSocket(
    'wss://stream.bybit.com/v5/public/spot',
    cb,
    (ws) => {
      const args = [...wanted.keys()].map((s) => `tickers.${s}`);
      // Bybit caps subscriptions per frame
      for (let i = 0; i < args.length; i += 10) {
        ws.send(JSON.stringify({ op: 'subscribe', args: args.slice(i, i + 10) }));
      }
    },
    (msg, emit) => {
      const d = msg?.data;
      if (!d?.symbol) return;
      const pair = wanted.get(d.symbol);
      if (!pair) return;
      const bid = Number(d.bid1Price);
      const ask = Number(d.ask1Price);
      if (bid > 0 && ask > 0) emit(pair, bid, ask);
    },
  );
}

function okx(pairs: string[], cb: FeedCallbacks): FeedHandle {
  const wanted = new Map(pairs.map((p) => [p.replace('/', '-'), p]));
  return createSocket(
    'wss://ws.okx.com:8443/ws/v5/public',
    cb,
    (ws) => {
      const args = [...wanted.keys()].map((instId) => ({ channel: 'tickers', instId }));
      for (let i = 0; i < args.length; i += 20) {
        ws.send(JSON.stringify({ op: 'subscribe', args: args.slice(i, i + 20) }));
      }
    },
    (msg, emit) => {
      if (!Array.isArray(msg?.data)) return;
      for (const d of msg.data) {
        const pair = wanted.get(d?.instId);
        if (!pair) continue;
        const bid = Number(d.bidPx);
        const ask = Number(d.askPx);
        if (bid > 0 && ask > 0) emit(pair, bid, ask);
      }
    },
  );
}

export function connectExchange(
  exchange: SupportedExchange,
  pairs: string[],
  cb: FeedCallbacks,
): FeedHandle {
  switch (exchange) {
    case 'binance':
      return binance(pairs, cb);
    case 'bybit':
      return bybit(pairs, cb);
    case 'okx':
      return okx(pairs, cb);
  }
}

export function emptyBook(): Book {
  return {};
}

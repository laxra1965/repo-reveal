import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  BROWSER_SCANNER_EXCHANGES,
  buildPairUniverse,
  connectExchange,
  type FeedHandle,
  type FeedStatus,
  type SupportedExchange,
} from '@/lib/browserScanner/feeds';
import { fetchSnapshot } from '@/lib/browserScanner/rest';
import { findTriangular, type Book, type LocalOpportunity } from '@/lib/browserScanner/triangular';

const STORAGE_KEY = 'browser-scanner-enabled';
const COMPUTE_INTERVAL_MS = 2_000;
const SNAPSHOT_INTERVAL_MS = 30_000;
const PUBLISH_INTERVAL_MS = 5_000;

export interface ExchangeFeedState {
  exchange: SupportedExchange;
  status: FeedStatus;
  pairs: number;
  lastUpdate: number | null;
  bid: number | null;
  ask: number | null;
}

export const useBrowserScanner = () => {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [feeds, setFeeds] = useState<Record<SupportedExchange, ExchangeFeedState>>(() =>
    Object.fromEntries(
      BROWSER_SCANNER_EXCHANGES.map((e) => [e, { exchange: e, status: 'idle', pairs: 0, lastUpdate: null, bid: null, ask: null }]),
    ) as Record<SupportedExchange, ExchangeFeedState>,
  );
  const [opportunities, setOpportunities] = useState<LocalOpportunity[]>([]);
  const [publishedCount, setPublishedCount] = useState(0);
  const [lastPublishError, setLastPublishError] = useState<string | null>(null);

  const booksRef = useRef<Record<string, Book>>({});
  const handlesRef = useRef<FeedHandle[]>([]);
  const publishingRef = useRef(false);
  const opportunitiesRef = useRef<LocalOpportunity[]>([]);
  const [lastPublishedAt, setLastPublishedAt] = useState<number | null>(null);
  opportunitiesRef.current = opportunities;

  const toggle = useCallback((next: boolean) => {
    setEnabled(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      handlesRef.current.forEach((h) => h.close());
      handlesRef.current = [];
      booksRef.current = {};
      setOpportunities([]);
      setFeeds((prev) => {
        const next = { ...prev };
        for (const e of BROWSER_SCANNER_EXCHANGES) next[e] = { ...next[e], status: 'idle', pairs: 0, lastUpdate: null, bid: null, ask: null };
        return next;
      });
      return;
    }

    const pairs = buildPairUniverse();
    let cancelled = false;

    const applyQuote = (exchange: SupportedExchange, pair: string, bid: number, ask: number, bidSize?: number, askSize?: number) => {
      if (cancelled || !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid) return;
      const book = (booksRef.current[exchange] ||= {});
      book[pair] = { bid, ask, ts: Date.now(), bidSize, askSize };
    };

    const seed = async () => {
      await Promise.all(BROWSER_SCANNER_EXCHANGES.map(async (exchange) => {
        const snapshot = await fetchSnapshot(exchange, pairs);
        if (cancelled) return;
        snapshot.forEach((q) => applyQuote(exchange, q.pair, q.bid, q.ask, q.bidSize, q.askSize));
      }));
    };

    seed();
    const snapshotTimer = setInterval(seed, SNAPSHOT_INTERVAL_MS);

    handlesRef.current = BROWSER_SCANNER_EXCHANGES.map((exchange) =>
      connectExchange(exchange, pairs, {
        onQuote: (pair, bid, ask, bidSize, askSize) => applyQuote(exchange, pair, bid, ask, bidSize, askSize),
        onStatus: (status) =>
          { if (!cancelled) setFeeds((prev) => ({ ...prev, [exchange]: { ...prev[exchange], status } })); },
      }),
    );

    const computeTimer = setInterval(() => {
      const all: LocalOpportunity[] = [];
      for (const exchange of BROWSER_SCANNER_EXCHANGES) {
        const book = booksRef.current[exchange];
        if (!book) continue;
        all.push(...findTriangular(exchange, book));
      }
      all.sort((a, b) => b.profitPercent - a.profitPercent);
      setOpportunities(all);
      setFeeds((prev) => {
        const next = { ...prev };
        for (const e of BROWSER_SCANNER_EXCHANGES) {
          const book = booksRef.current[e] || {};
          const fresh = Object.values(book).filter((q) => Date.now() - q.ts < 15_000);
          const btc = book['BTC/USDT'];
          const lastUpdate = fresh.length ? Math.max(...fresh.map((q) => q.ts)) : next[e].lastUpdate;
          next[e] = { ...next[e], status: fresh.length ? 'live' : next[e].status === 'live' ? 'error' : next[e].status, pairs: fresh.length, lastUpdate, bid: btc && Date.now() - btc.ts < 15_000 ? btc.bid : null, ask: btc && Date.now() - btc.ts < 15_000 ? btc.ask : null };
        }
        return next;
      });
    }, COMPUTE_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(snapshotTimer);
      clearInterval(computeTimer);
      handlesRef.current.forEach((h) => h.close());
      handlesRef.current = [];
    };
  }, [enabled]);

  // Publish the best finds so the auto trader and the rest of the app can see them
  useEffect(() => {
    if (!enabled || !user) return;

    const publish = async () => {
      if (publishingRef.current) return;
      const payload = opportunitiesRef.current
        .filter((o) => o.profitPercent > 0 && Date.now() - o.detectedAt < 15_000)
        .slice(0, 100)
        .map((o) => ({
          exchange: o.exchange,
          path: o.path,
          pairs: o.pairs,
          gross_percent: o.grossPercent,
          volume_estimate: o.volumeEstimate,
          detected_at: new Date(o.detectedAt).toISOString(),
        }));

      if (payload.length === 0) return;
      publishingRef.current = true;
      try {
        const { data, error } = await supabase.rpc('publish_browser_opportunities', {
          p_opportunities: payload,
        });
        if (error) throw error;
        setPublishedCount((c) => c + (data ?? 0));
        setLastPublishedAt(Date.now());
        window.dispatchEvent(new Event('browser-opportunities-published'));
        setLastPublishError(null);
      } catch (e: any) {
        setLastPublishError(e?.message || 'Could not publish local finds');
      } finally {
        publishingRef.current = false;
      }
    };

    const id = setInterval(publish, PUBLISH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, user?.id]);

  const liveFeeds = Object.values(feeds).filter((f) => f.status === 'live').length;

  return {
    enabled,
    toggle,
    feeds: Object.values(feeds),
    liveFeeds,
    opportunities,
    publishedCount,
    lastPublishError,
    lastPublishedAt,
  };
};

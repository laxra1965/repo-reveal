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
const PUBLISH_INTERVAL_MS = 15_000;
const MIN_PUBLISH_PROFIT = 0.15;

export interface ExchangeFeedState {
  exchange: SupportedExchange;
  status: FeedStatus;
  pairs: number;
  lastUpdate: number | null;
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
      BROWSER_SCANNER_EXCHANGES.map((e) => [e, { exchange: e, status: 'idle', pairs: 0, lastUpdate: null }]),
    ) as Record<SupportedExchange, ExchangeFeedState>,
  );
  const [opportunities, setOpportunities] = useState<LocalOpportunity[]>([]);
  const [publishedCount, setPublishedCount] = useState(0);
  const [lastPublishError, setLastPublishError] = useState<string | null>(null);

  const booksRef = useRef<Record<string, Book>>({});
  const handlesRef = useRef<FeedHandle[]>([]);
  const publishingRef = useRef(false);

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
        for (const e of BROWSER_SCANNER_EXCHANGES) next[e] = { ...next[e], status: 'idle', pairs: 0 };
        return next;
      });
      return;
    }

    const pairs = buildPairUniverse();
    let cancelled = false;

    const applyQuote = (exchange: SupportedExchange, pair: string, bid: number, ask: number) => {
      const book = (booksRef.current[exchange] ||= {});
      book[pair] = { bid, ask, ts: Date.now() };
    };

    const seed = async () => {
      for (const exchange of BROWSER_SCANNER_EXCHANGES) {
        const snapshot = await fetchSnapshot(exchange, pairs);
        if (cancelled) return;
        snapshot.forEach((q) => applyQuote(exchange, q.pair, q.bid, q.ask));
        setFeeds((prev) => ({
          ...prev,
          [exchange]: {
            ...prev[exchange],
            status: prev[exchange].status === 'live' ? 'live' : snapshot.length > 0 ? 'live' : prev[exchange].status,
            pairs: Object.keys(booksRef.current[exchange] || {}).length,
            lastUpdate: snapshot.length ? Date.now() : prev[exchange].lastUpdate,
          },
        }));
      }
    };

    seed();
    const snapshotTimer = setInterval(seed, SNAPSHOT_INTERVAL_MS);

    handlesRef.current = BROWSER_SCANNER_EXCHANGES.map((exchange) =>
      connectExchange(exchange, pairs, {
        onQuote: (pair, bid, ask) => applyQuote(exchange, pair, bid, ask),
        onStatus: (status) =>
          setFeeds((prev) => ({ ...prev, [exchange]: { ...prev[exchange], status } })),
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
      setOpportunities(all.slice(0, 30));
      setFeeds((prev) => {
        const next = { ...prev };
        for (const e of BROWSER_SCANNER_EXCHANGES) {
          const count = Object.keys(booksRef.current[e] || {}).length;
          next[e] = { ...next[e], pairs: count, lastUpdate: count ? Date.now() : next[e].lastUpdate };
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
      const payload = opportunities
        .filter((o) => o.profitPercent >= MIN_PUBLISH_PROFIT)
        .slice(0, 10)
        .map((o) => ({
          strategy: 'triangular',
          path: o.path,
          exchange1: o.exchange,
          exchange2: o.exchange,
          exchange3: o.exchange,
          pair1: o.pairs[0],
          pair2: o.pairs[1],
          pair3: o.pairs[2],
          profit_percent: o.profitPercent,
        }));

      if (payload.length === 0) return;
      publishingRef.current = true;
      try {
        const { data, error } = await supabase.functions.invoke('ingest-opportunities', {
          body: { source: 'browser', opportunities: payload },
        });
        if (error) throw error;
        setPublishedCount((c) => c + (data?.inserted ?? 0));
        setLastPublishError(null);
      } catch (e: any) {
        setLastPublishError(e?.message || 'Could not publish local finds');
      } finally {
        publishingRef.current = false;
      }
    };

    const id = setInterval(publish, PUBLISH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, user, opportunities]);

  const liveFeeds = Object.values(feeds).filter((f) => f.status === 'live').length;

  return {
    enabled,
    toggle,
    feeds: Object.values(feeds),
    liveFeeds,
    opportunities,
    publishedCount,
    lastPublishError,
  };
};

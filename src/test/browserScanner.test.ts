import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { findTriangular, type Book } from '@/lib/browserScanner/triangular';
import { parseTradeLegs } from '@/lib/tradeTimeline';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), quote: null as null | ((pair: string, bid: number, ask: number, bidSize?: number, askSize?: number) => void) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'test-user' } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('@/lib/browserScanner/rest', () => ({ fetchSnapshot: async () => [] }));
vi.mock('@/lib/browserScanner/feeds', () => ({ BROWSER_SCANNER_EXCHANGES: ['binance'], buildPairUniverse: () => [], connectExchange: (_exchange: string, _pairs: string[], callbacks: { onQuote: typeof mocks.quote }) => { mocks.quote = callbacks.onQuote; return { close: vi.fn() }; } }));
import { useBrowserScanner } from '@/hooks/useBrowserScanner';

const book = (ts = Date.now()): Book => ({
  'BTC/USDT': { bid: 99, ask: 100, bidSize: 10, askSize: 10, ts },
  'ETH/USDT': { bid: 51, ask: 52, bidSize: 10, askSize: 10, ts },
  'BTC/ETH': { bid: 2, ask: 2.01, bidSize: 10, askSize: 10, ts },
});
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });
describe('Browser market signals', () => {
  it('subtracts the 0.3% three-leg baseline exactly once', () => {
    const result = findTriangular('binance', book(), ['BTC', 'ETH']);
    expect(result).toHaveLength(1);
    expect(result[0].grossPercent).toBe(2);
    expect(result[0].profitPercent).toBe(1.7);
    expect(result[0].volumeEstimate).toBe(500);
  });
  it('never invents liquidity when quote sizes are missing', () => {
    const prices = book(); delete prices['BTC/ETH'].bidSize;
    expect(findTriangular('binance', prices, ['BTC', 'ETH'])[0].volumeEstimate).toBe(0);
  });
  it('excludes expired, crossed and non-profitable quotes', () => {
    expect(findTriangular('binance', book(Date.now() - 15_001), ['BTC', 'ETH'])).toEqual([]);
    const crossed = book(); crossed['BTC/USDT'].bid = 101;
    expect(findTriangular('binance', crossed, ['BTC', 'ETH'])).toEqual([]);
    const unprofitable = book(); unprofitable['ETH/USDT'].bid = 50.1;
    expect(findTriangular('binance', unprofitable, ['BTC', 'ETH'])).toEqual([]);
  });
  it('publishes a real computed route despite repeated two-second computations', async () => {
    vi.useFakeTimers(); mocks.rpc.mockResolvedValue({ data: 1, error: null });
    const hook = renderHook(() => useBrowserScanner());
    await act(async () => { hook.result.current.toggle(true); });
    act(() => { for (const [pair, q] of Object.entries(book())) mocks.quote?.(pair, q.bid, q.ask, q.bidSize, q.askSize); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    console.log("DBG", hook.result.current.opportunities.length, JSON.stringify(hook.result.current.feeds), hook.result.current.lastPublishError);
    expect(mocks.rpc).toHaveBeenCalledWith('publish_browser_opportunities', { p_opportunities: [expect.objectContaining({ exchange: 'binance', gross_percent: 2, volume_estimate: 500, path: 'USDT > BTC > ETH > USDT' })] });
    expect(hook.result.current.publishedCount).toBe(1);
  });
  it('does not refresh a quote timestamp just because computation runs', async () => {
    vi.useFakeTimers();
    const hook = renderHook(() => useBrowserScanner());
    await act(async () => { hook.result.current.toggle(true); });
    act(() => { mocks.quote?.('BTC/USDT', 99, 100, 10, 10); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    const timestamp = hook.result.current.feeds[0].lastUpdate;
    await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
    expect(hook.result.current.feeds[0].lastUpdate).toBe(timestamp);
    expect(hook.result.current.feeds[0].pairs).toBe(0);
    expect(hook.result.current.feeds[0].bid).toBeNull();
  });
});
describe('Recorded trade timeline', () => {
  it('reads VPS fills and keeps unknown fee assets unknown', () => {
    const legs = parseTradeLegs({ mode: 'live', log: [{ exchange: 'bybit', symbol: 'BTCUSDT', side: 'BUY', fromAsset: 'USDT', toAsset: 'BTC', amountIn: 100, fillAmount: 0.001, fillPrice: 100000, fee: 0.000001, at: '2026-10-20T09:00:00Z' }] });
    expect(legs[0]).toMatchObject({ filled: 0.001, fee: 0.000001, feeAsset: null, simulated: false, time: '2026-10-20T09:00:00Z' });
  });
  it('labels paper fills as simulated and does not fabricate missing fills', () => {
    expect(parseTradeLegs({ log: [{ isPaperTrade: true, step: 1, timestamp: '2026-10-20T09:00:00Z' }] })[0]).toMatchObject({ simulated: true, filled: null, price: null, fee: null });
    expect(parseTradeLegs(null)).toEqual([]);
  });
});
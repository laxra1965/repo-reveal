// Core arbitrage scanning algorithms

import { estimateSlippage, getTakerFee, getWithdrawalFeeUSDT } from './fee-calculator.ts';
import { SHARED_COMMON_BASES } from './config.ts';
import { fetchTopMovers } from './exchange-data-fetcher.ts';

/**
 * Find triangular arbitrage opportunities on a single exchange
 * @param priceMap - Map of price data by symbol_exchange
 * @param quoteCurrency - Base currency (USDT, BNB, etc.)
 * @param tradeAmount - Trade amount in quote currency
 * @param minProfitPercent - Minimum profit percentage threshold
 * @param filterProfitable - Filter to only profitable opportunities
 * @param customPairs - Custom trading pairs to include
 * @param detectShortSignals - Whether to detect short signals
 * @returns Array of triangular arbitrage opportunities
 */
export async function findTriangularArbitrage(
  priceMap: Record<string, any>,
  quoteCurrency: string,
  tradeAmount: number,
  minProfitPercent: number = 0.05,
  filterProfitable: boolean = true,
  customPairs: string[] = [],
  detectShortSignals: boolean = false
): Promise<any[]> {
  const opportunities: any[] = [];
  const topMovers = await fetchTopMovers();
  const availableExchanges = Array.from(new Set(Object.keys(priceMap).map(key => key.split('_')[1])));

  for (const exchange of availableExchanges) {
    const exchangeData = Object.values(priceMap).filter((t: any) => t.exchange === exchange);
    const pairLookup = new Map(exchangeData.map((t: any) => [`${t.base_asset}${t.quote_asset}`, t]));

    // Use exchange-specific taker fee (arbitrage always uses market orders = taker)
    const fee = getTakerFee(exchange);

    // Build Adjacency Graph for O(1) connectivity checks
    const adjacency = new Map<string, Set<string>>();
    for (const t of exchangeData) {
      if (!adjacency.has(t.base_asset)) adjacency.set(t.base_asset, new Set());
      if (!adjacency.has(t.quote_asset)) adjacency.set(t.quote_asset, new Set());
      adjacency.get(t.base_asset)!.add(t.quote_asset);
      adjacency.get(t.quote_asset)!.add(t.base_asset);
    }

    // Assets connected to our pocket currency (e.g. USDT)
    const quoteNeighbors = adjacency.get(quoteCurrency) || new Set<string>();

    // Targeted Search: Only use assets in the computed whitelist (Movers + Custom + Common)
    const whitelist = new Set([
      ...SHARED_COMMON_BASES,
      ...topMovers,
      ...customPairs.map(p => {
        const up = p.toUpperCase().trim();
        // If it's a full pair like XRPUSDT, extract the base
        if (up.endsWith(quoteCurrency)) return up.slice(0, -quoteCurrency.length);
        return up;
      })
    ]);

    let pathCount = 0;
    let bestGross = -999;
    let bestSymbol = '';

    // Optimized Targeted Search: quoteCurrency -> Base -> Intermediate -> quoteCurrency
    // Both 'base' and 'intermediate' must be in our whitelist
    for (const base of quoteNeighbors) {
      if (!whitelist.has(base)) continue;

      const baseNeighbors = adjacency.get(base) || new Set<string>();
      for (const intermediate of baseNeighbors) {
        if (intermediate === quoteCurrency || !quoteNeighbors.has(intermediate)) continue;
        if (!whitelist.has(intermediate)) continue;

        const p1 = pairLookup.get(`${base}${quoteCurrency}`) || pairLookup.get(`${quoteCurrency}${base}`);
        const p2 = pairLookup.get(`${base}${intermediate}`) || pairLookup.get(`${intermediate}${base}`);
        const p3 = pairLookup.get(`${intermediate}${quoteCurrency}`) || pairLookup.get(`${quoteCurrency}${intermediate}`);

        if (!p1 || !p2 || !p3) continue;
        pathCount++;

        try {
          // Step 1: Calculate with slippage
          const s1IsBy = p1.quote_asset === quoteCurrency;
          const s1Slippage = estimateSlippage(tradeAmount, p1.volume);
          const s1P = s1IsBy ? p1.askPrice * (1 + s1Slippage) : 1 / (p1.bidPrice * (1 - s1Slippage));
          const s1A = (tradeAmount * (1 - fee)) / (s1IsBy ? s1P : 1);
          const s1RA = s1IsBy ? s1A : s1A * p1.bidPrice;

          // Step 2: Calculate with slippage
          const s2IsBy = p2.quote_asset === base;
          const s2Slippage = estimateSlippage(s1RA, p2.volume);
          const s2P_raw = s2IsBy ? p2.askPrice : p2.bidPrice;
          const s2P = s2IsBy ? s2P_raw * (1 + s2Slippage) : s2P_raw * (1 - s2Slippage);
          const s2A = s2IsBy ? (s1RA * (1 - fee)) / s2P : (s1RA * (1 - fee)) * s2P;

          // Step 3: Calculate with slippage
          const s3IsSl = p3.base_asset === intermediate;
          const s3Slippage = estimateSlippage(s2A, p3.volume);
          const s3P_raw = s3IsSl ? p3.bidPrice : 1 / p3.askPrice;
          const s3P = s3IsSl ? s3P_raw * (1 - s3Slippage) : s3P_raw * (1 + s3Slippage);
          const s3A = s3IsSl ? (s2A * (1 - fee)) * s3P : (s2A * (1 - fee)) / s3P;

          const netPct = ((s3A - tradeAmount) / tradeAmount) * 100;
          const gr = (tradeAmount / s1P) * (s2IsBy ? 1 / p2.askPrice : p2.bidPrice) * (s3IsSl ? p3.bidPrice : 1 / p3.askPrice);
          const grossPct = ((gr - tradeAmount) / tradeAmount) * 100;

          if (grossPct > bestGross) { bestGross = grossPct; bestSymbol = `${base}->${intermediate}`; }

          if (netPct >= minProfitPercent) {
            opportunities.push({
              base_symbol: base, intermediate_symbol: intermediate, quote_symbol: quoteCurrency,
              exchange1: exchange, exchange2: exchange, exchange3: exchange,
              step1_action: s1IsBy ? `BUY ${base}${quoteCurrency}` : `SELL ${quoteCurrency}${base}`,
              step1_price: p1.bidPrice, step1_amount: s1A,
              step2_action: s2IsBy ? `BUY ${intermediate}${base}` : `SELL ${base}${intermediate}`,
              step2_price: s2P, step2_amount: s2A,
              step3_action: s3IsSl ? `SELL ${intermediate}${quoteCurrency}` : `BUY ${quoteCurrency}${intermediate}`,
              step3_price: p3.askPrice, step3_amount: s3A,
              start_amount: tradeAmount, end_amount: s3A, profit_amount: s3A - tradeAmount, profit_percent: netPct,
              type: 'triangular', signal_type: 'arbitrage',
              step1_volume: p1.volume, step2_volume: p2.volume, step3_volume: p3.volume,
              liquidity_score: Math.min(100, (p1.volume + p2.volume + p3.volume) / 1000)
            });
          }
        } catch (e) { }
      }
    }
    console.log(`${exchange}: Evaluated ${pathCount} paths. Best Gross: ${bestGross.toFixed(4)}% (${bestSymbol}). Net Found: ${opportunities.filter(o => o.exchange1 === exchange).length}`);
  }
  return opportunities;
}

/**
 * Find cross-exchange arbitrage opportunities
 * @param priceMap - Map of price data by symbol_exchange
 * @param quoteCurrency - Base currency (USDT, BNB, etc.)
 * @param tradeAmount - Trade amount in quote currency
 * @param minProfitPercent - Minimum profit percentage threshold
 * @param filterProfitable - Filter to only profitable opportunities
 * @param customPairs - Custom trading pairs to include
 * @param detectShortSignals - Whether to detect short signals
 * @returns Array of cross-exchange arbitrage opportunities
 */
export function findCrossExchangeArbitrage(
  priceMap: Record<string, any>,
  quoteCurrency: string,
  tradeAmount: number,
  minProfitPercent: number = 0.05,
  filterProfitable: boolean = true,
  customPairs: string[] = [],
  detectShortSignals: boolean = false
): any[] {
  const opportunities: any[] = [];
  const commonBases = Array.from(new Set([...SHARED_COMMON_BASES, ...customPairs.map(p => p.toUpperCase().trim())]));
  const availableExchanges = Array.from(new Set(Object.keys(priceMap).map(key => key.split('_')[1])));

  for (const base of commonBases) {
    const symbols = availableExchanges.map(ex => ({ ex, data: priceMap[`${base}${quoteCurrency}_${ex}`] })).filter(s => s.data);
    if (symbols.length < 2) continue;

    for (let i = 0; i < symbols.length; i++) {
      for (let j = 0; j < symbols.length; j++) {
        if (i === j) continue;
        const ex1 = symbols[i];
        const ex2 = symbols[j];

        // Use exchange-specific taker fees
        const fee1 = getTakerFee(ex1.ex);
        const fee2 = getTakerFee(ex2.ex);

        const buyP = ex1.data.askPrice;
        const sellP = ex2.data.bidPrice;

        // Calculate slippage for both trades
        const buySlippage = estimateSlippage(tradeAmount, ex1.data.volume);
        const buyPWithSlippage = buyP * (1 + buySlippage);

        const amountAfterBuy = (tradeAmount * (1 - fee1)) / buyPWithSlippage;
        const amountToSell = amountAfterBuy; // Same amount transfers

        const sellSlippage = estimateSlippage(amountToSell * sellP, ex2.data.volume);
        const sellPWithSlippage = sellP * (1 - sellSlippage);

        const grossReturn = amountToSell * sellPWithSlippage * (1 - fee2);

        // Get realistic withdrawal fee in USDT
        const withdrawalFee = getWithdrawalFeeUSDT(base, ex1.ex, buyP);

        const netProfit = grossReturn - tradeAmount - withdrawalFee;
        const profitPct = (netProfit / tradeAmount) * 100;

        if (profitPct >= minProfitPercent) {
          opportunities.push({
            base_symbol: base, intermediate_symbol: base, quote_symbol: quoteCurrency,
            exchange1: ex1.ex, exchange2: ex2.ex, exchange3: ex2.ex,
            step1_action: `BUY ${base}${quoteCurrency}`, step1_price: buyP, step1_amount: amountAfterBuy,
            step2_action: `TRANSFER`, step2_price: 1, step2_amount: amountAfterBuy,
            step3_action: `SELL ${base}${quoteCurrency}`, step3_price: sellP, step3_amount: amountAfterBuy,
            start_amount: tradeAmount, end_amount: grossReturn, profit_amount: netProfit, profit_percent: profitPct,
            type: 'cross_exchange', signal_type: 'arbitrage',
            step1_volume: ex1.data.volume, step2_volume: 0, step3_volume: ex2.data.volume,
            liquidity_score: Math.min(100, (ex1.data.volume + ex2.data.volume) / 2000)
          });
        }
      }
    }
  }
  return opportunities;
}

/**
 * Find short signal opportunities
 * @param priceMap - Map of price data by symbol_exchange
 * @param quoteCurrency - Base currency (USDT, BNB, etc.)
 * @param tradeAmount - Trade amount in quote currency
 * @param minProfitPercent - Minimum profit percentage threshold
 * @param customPairs - Custom trading pairs to include
 * @returns Array of short signal opportunities
 */
export function findShortSignals(
  priceMap: Record<string, any>,
  quoteCurrency: string,
  tradeAmount: number,
  minProfitPercent: number = 0.05,
  customPairs: string[] = []
): any[] {
  const opportunities: any[] = [];
  const commonBases = Array.from(new Set([...SHARED_COMMON_BASES, ...customPairs.map(p => p.toUpperCase().trim())]));
  const availableExchanges = Array.from(new Set(Object.keys(priceMap).map(key => key.split('_')[1])));

  for (const base of commonBases) {
    const symbols = availableExchanges.map(ex => ({ ex, data: priceMap[`${base}${quoteCurrency}_${ex}`] })).filter(s => s.data);
    if (symbols.length < 2) continue;

    const avgPrice = symbols.reduce((acc, s) => acc + (s.data.bidPrice + s.data.askPrice) / 2, 0) / symbols.length;

    for (const s of symbols) {
      const currentPrice = (s.data.bidPrice + s.data.askPrice) / 2;
      const divergence = ((currentPrice - avgPrice) / avgPrice) * 100;

      if (divergence > 2.0) {
        opportunities.push({
          base_symbol: base, intermediate_symbol: base, quote_symbol: quoteCurrency,
          exchange1: s.ex, exchange2: s.ex, exchange3: s.ex,
          step1_action: `SHORT ${base}${quoteCurrency}`, step1_price: s.data.bidPrice, step1_amount: tradeAmount / s.data.bidPrice,
          step2_action: `HEDGE / WAIT`, step2_price: 1, step2_amount: tradeAmount,
          step3_action: `CLOSE AT ${avgPrice.toFixed(4)}`, step3_price: avgPrice, step3_amount: tradeAmount,
          start_amount: tradeAmount, end_amount: tradeAmount * (1 + (divergence / 100)), profit_amount: (tradeAmount * (divergence / 100)), profit_percent: divergence,
          type: 'short', signal_type: 'short',
          step1_volume: s.data.volume, step2_volume: 0, step3_volume: 0,
          liquidity_score: 80
        });
      }
    }
  }
  return opportunities;
}


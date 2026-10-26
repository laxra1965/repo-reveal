// Logger utilities
const logDebugIfExchange = (exchange: string, msg: string, data?: any) => {
  if (exchange === 'gate' || exchange === 'bybit') {
    console.log(`[${exchange.toUpperCase()}] ${msg}`, data || '');
  }
};

// Symbols that cause false positives or have extreme liquidity issues
export const BLACKLISTED_SYMBOLS = [
  'USD1', 'USD0', 'USDE', 'SUSD', 'LUSD', 'ZUSD', 'VAI', 'USDP', 'USDD', 'USDV', 
  'EUR', 'GBP', 'AUD', 'CAD', 'JPY', // Exclude non-crypto fiat pairs if they leak in
  '3S', '3L', '5S', '5L', 'DOWN', 'UP', 'BEAR', 'BULL' // Leveraged tokens
];

export const standardizeSymbol = (symbol: string): string | null => {
  if (!symbol) return null;

  let s = symbol.toUpperCase();

  // Check blacklist first - exclude if the pair contains any blacklisted stable/fiat
  for (const blacklisted of BLACKLISTED_SYMBOLS) {
    if (s.includes(blacklisted)) return null;
  }

  // Handle MATIC -> POL migration mapping
  if (s === 'MATICUSDT') s = 'POLUSDT';
  if (s === 'MATICBTC') s = 'POLBTC';
  if (s === 'MATICETH') s = 'POLETH';
  if (s === 'MATICBNB') s = 'POLBNB';

  // Accept pairs ending in these quote currencies
  // Common quotes: USDT (widest), BTC/ETH/BNB (basis), USDC/BUSD/USDP (alternatives)
  if (s.endsWith('USDT')) return s;
  if (s.endsWith('BTC')) return s;
  if (s.endsWith('ETH')) return s;
  if (s.endsWith('BNB')) return s;
  if (s.endsWith('USDC')) return s; // Gate, Bybit use USDC
  if (s.endsWith('BUSD')) return s; // Some exchanges use BUSD
  if (s.endsWith('DAI')) return s;  // Decentralized stablecoin
  if (s.endsWith('USDP')) return s; // Pax USD
  if (s.endsWith('TUSD')) return s; // TrueUSD
  if (s.endsWith('USDE')) return s; // Ethena USD
  if (s.endsWith('FDUSD')) return s; // First Digital USD (used on Gate)

  return s;
};

// Expanded altcoin list (70+ coins for broader coverage)
export const EXPANDED_ALTCOINS = [
  // Layer 1 Blockchains
  'BTC', 'ETH', 'SOL', 'ADA', 'AVAX', 'NEAR', 'ATOM', 'DOT',
  'XRP', 'DOGE', 'LTC', 'BCH', 'ALGO', 'IOTA', 'VET', 'XLM',
  'THR', 'HBAR', 'SUI', 'APT', 'SEI', 'ZK',
  
  // Layer 2 / Scaling
  'ARB', 'OP', 'POL', 'SCROLL', 'BLAST', 'STARKNET',
  
  // DeFi Protocols
  'AAVE', 'UNI', 'SUSHI', 'CRV', 'CONVEX', 'BALANCER', 'LIDO',
  'GMX', 'PENDLE', 'MORPHO', 'GNS', 'JOE', 'COMPOUND', 'MAKER',
  'ENS', 'RAI', 'FXS', 'FRAX', 'YEARN', 'CURVE', 'UNISWAP',
  
  // Link/Oracles/Real-world data
  'LINK', 'API3', 'BAND', 'PUSH',
  
  // AI/ML
  'RENDER', 'ARKM', 'ONDO', 'FET', 'TAO', 'AGIX',
  
  // Gaming/Metaverse
  'GALA', 'ENJ', 'SAND', 'MANA', 'AXS', 'FLOW', 'ICP',
  
  // Privacy/Scaling
  'MONERO', 'ZEC', 'DASH',
  
  // Meme coins (if profitable)
  'PEPE', 'SHIB', 'DOGE', 'FLOKI',
  
  // Exchange Tokens
  'BNB', 'OKB', 'FTT', 'GT', 'KCS', 'MX',
  
  // Staking/Liquid Staking
  'STETH', 'LSETH', 'CBETH', 'RPL', 'LDO', 'SSOL',
  
  // Shared Sequencer/Oracle
  'ETHFI', 'SYMBIOTIC', 'EigenLayer'
];

// Stablecoin list
export const STABLECOINS = ['USDT', 'USDC', 'BUSD', 'DAI', 'FRAX', 'TUSD', 'USDD'];

// Fee structure by exchange (maker/taker)
export const EXCHANGE_FEES = {
  'binance': { maker: 0.001, taker: 0.001 },
  'bybit': { maker: 0.0001, taker: 0.0001 },
  'okx': { maker: 0.0002, taker: 0.0005 },
  'gate': { maker: 0.002, taker: 0.002 },
  'mexc': { maker: 0.002, taker: 0.002 },
  'kucoin': { maker: 0.001, taker: 0.001 }
};

export const findBNBTriangularArbitrage = (priceMap: Record<string, any>, tradeAmount: number, exchange = 'binance'): any[] => {
  const opportunities: any[] = [];

  // Get the exchange-specific token (BNB for Binance, MNT for Bybit, GT for Gate, OKB for OKX, MX for MEXC, KCS for KuCoin)
  const exchangeToken = EXCHANGE_TOKENS[exchange as keyof typeof EXCHANGE_TOKENS] || 'BNB';
  const exchangeTokenUsdt = priceMap[`${exchangeToken}USDT`];

  logDebugIfExchange(exchange, 'findBNBTriangularArbitrage START', {
    exchange_token: exchangeToken,
    exchange_token_pair: `${exchangeToken}USDT`,
    has_exchange_token_usdt: !!exchangeTokenUsdt,
    total_pairs: Object.keys(priceMap).length
  });

  // Dynamically derive altcoins from priceMap (focus on TOP MOVERS)
  const availableTokens = new Set<string>();
  for (const pair of Object.keys(priceMap)) {
    if (pair.endsWith('USDT')) {
      const token = pair.replace('USDT', '');
      if (token !== exchangeToken) availableTokens.add(token);
    }
  }
  const altcoins = availableTokens.size > 0 ? Array.from(availableTokens) : EXPANDED_ALTCOINS;

  logDebugIfExchange(exchange, 'Available tokens from priceMap', {
    available_count: availableTokens.size,
    using_fallback: availableTokens.size === 0,
    sample_tokens: Array.from(availableTokens).slice(0, 5)
  });

  let altcoinsChecked = 0;
  let altcoinsWithMissingPairs = 0;

  for (const altcoin of altcoins) {
    altcoinsChecked++;
    const altcoinUsdt = priceMap[`${altcoin}USDT`];
    const altcoinToken = priceMap[`${altcoin}${exchangeToken}`];
    
    const hasAllPairs = exchangeTokenUsdt && altcoinUsdt && altcoinToken;
    if (!hasAllPairs && (exchange === 'gate' || exchange === 'bybit')) {
      altcoinsWithMissingPairs++;
      logDebugIfExchange(exchange, `Missing pairs for ${altcoin}`, {
        has_exchange_token_usdt: !!exchangeTokenUsdt,
        has_altcoin_usdt: !!altcoinUsdt,
        has_altcoin_token: !!altcoinToken,
        required_pairs: [`${exchangeToken}USDT`, `${altcoin}USDT`, `${altcoin}${exchangeToken}`]
      });
    }

    if (exchangeTokenUsdt && altcoinUsdt && altcoinToken) {
      // validate prices are finite and non-zero
      const valid = (p: any) => p && isFinite(p.askPrice) && isFinite(p.bidPrice) && p.askPrice > 0.00000001 && p.bidPrice > 0.00000001;
      if (!valid(exchangeTokenUsdt) || !valid(altcoinUsdt) || !valid(altcoinToken)) continue;

      // Path 1: USDT -> EXCHANGE_TOKEN -> ALTCOIN -> USDT
      try {
        const step1Amount = tradeAmount / exchangeTokenUsdt.askPrice;
        if (!isFinite(step1Amount) || step1Amount <= 0) throw new Error('Invalid step1');
        const step2Amount = step1Amount / altcoinToken.askPrice;
        if (!isFinite(step2Amount) || step2Amount <= 0) throw new Error('Invalid step2');
        const step3Amount = step2Amount * altcoinUsdt.bidPrice;

        const profit = step3Amount - tradeAmount;
        const profitPercent = (profit / tradeAmount) * 100;

        if (profit > 0.001 && profitPercent > 0.001) {
          opportunities.push({
            type: 'triangular_arbitrage',
            base_symbol: 'USDT',
            intermediate_symbol: exchangeToken,
            quote_symbol: altcoin,
            exchange1: exchange,
            exchange2: exchange,
            exchange3: exchange,
            step1_action: 'BUY',
            step1_price: exchangeTokenUsdt.askPrice,
            step1_amount: step1Amount,
            step2_action: 'BUY',
            step2_price: altcoinToken.askPrice,
            step2_amount: step2Amount,
            step3_action: 'SELL',
            step3_price: altcoinUsdt.bidPrice,
            step3_amount: step2Amount,
            start_amount: tradeAmount,
            end_amount: step3Amount,
            profit_amount: profit,
            profit_percent: profitPercent,
          });
        }
      } catch (error) {
        // ignore calculation errors for a single altcoin
      }

      // Path 2: USDT -> ALTCOIN -> EXCHANGE_TOKEN -> USDT
      try {
        const step1Amount = tradeAmount / altcoinUsdt.askPrice;
        if (!isFinite(step1Amount) || step1Amount <= 0) throw new Error('Invalid step1');
        const step2Amount = step1Amount * altcoinToken.bidPrice;
        if (!isFinite(step2Amount) || step2Amount <= 0) throw new Error('Invalid step2');
        const step3Amount = step2Amount * exchangeTokenUsdt.bidPrice;

        const profit = step3Amount - tradeAmount;
        const profitPercent = (profit / tradeAmount) * 100;

        if (profit > 0.001 && profitPercent > 0.001) {
          opportunities.push({
            type: 'triangular_arbitrage',
            base_symbol: 'USDT',
            intermediate_symbol: altcoin,
            quote_symbol: exchangeToken,
            exchange1: exchange,
            exchange2: exchange,
            exchange3: exchange,
            step1_action: 'BUY',
            step1_price: altcoinUsdt.askPrice,
            step1_amount: step1Amount,
            step2_action: 'SELL',
            step2_price: altcoinToken.bidPrice,
            step2_amount: step1Amount,
            step3_action: 'SELL',
            step3_price: exchangeTokenUsdt.bidPrice,
            step3_amount: step2Amount,
            start_amount: tradeAmount,
            end_amount: step3Amount,
            profit_amount: profit,
            profit_percent: profitPercent,
          });
        }
      } catch (error) {
        // ignore
      }
    }
  }

  logDebugIfExchange(exchange, 'findBNBTriangularArbitrage COMPLETE', {
    altcoins_checked: altcoinsChecked,
    altcoins_with_missing_pairs: altcoinsWithMissingPairs,
    opportunities_found: opportunities.length,
    missing_pair_percent: altcoinsChecked > 0 ? ((altcoinsWithMissingPairs / altcoinsChecked) * 100).toFixed(1) + '%' : 'N/A'
  });

  return opportunities.sort((a, b) => b.profit_percent - a.profit_percent).slice(0, 5);
};

export const findCrossExchangeTriangularArbitrage = (
  allPriceMaps: Record<string, Record<string, any>>,
  tradeAmount: number
): any[] => {
  const opportunities: any[] = [];
  const exchanges = Object.keys(allPriceMaps);
  const altcoins = EXPANDED_ALTCOINS;

  for (const altcoin of altcoins) {
    for (const e1 of exchanges) {
      for (const e2 of exchanges) {
        for (const e3 of exchanges) {
          const pm1 = allPriceMaps[e1];
          const pm2 = allPriceMaps[e2];
          const pm3 = allPriceMaps[e3];

          const bnbUsdt = pm1['BNBUSDT'];
          const altcoinBnb = pm2[`${altcoin}BNB`];
          const altcoinUsdt = pm3[`${altcoin}USDT`];

          if (bnbUsdt && altcoinBnb && altcoinUsdt) {
            // validate
            const valid = (p: any) => p && isFinite(p.askPrice) && isFinite(p.bidPrice) && p.askPrice > 0.00000001 && p.bidPrice > 0.00000001;
            if (!valid(bnbUsdt) || !valid(altcoinBnb) || !valid(altcoinUsdt)) continue;

            // Path USDT@e1 -> BNB@e1 -> ALT@e2 -> USDT@e3
            try {
              const step1 = tradeAmount / bnbUsdt.askPrice;
              if (!isFinite(step1) || step1 <= 0) throw new Error('step1');
              const step2 = step1 / altcoinBnb.askPrice;
              if (!isFinite(step2) || step2 <= 0) throw new Error('step2');
              const step3 = step2 * altcoinUsdt.bidPrice;
              const profit = step3 - tradeAmount;
              const profitPct = (profit / tradeAmount) * 100;
              if (profit > 0.001 && profitPct > 0.001) {
                opportunities.push({
                  type: 'cross_exchange',
                  base_symbol: 'USDT',
                  intermediate_symbol: 'BNB',
                  quote_symbol: altcoin,
                  exchange1: e1,
                  exchange2: e2,
                  exchange3: e3,
                  step1_action: 'BUY',
                  step1_price: bnbUsdt.askPrice,
                  step1_amount: step1,
                  step2_action: 'BUY',
                  step2_price: altcoinBnb.askPrice,
                  step2_amount: step2,
                  step3_action: 'SELL',
                  step3_price: altcoinUsdt.bidPrice,
                  step3_amount: step2,
                  start_amount: tradeAmount,
                  end_amount: step3,
                  profit_amount: profit,
                  profit_percent: profitPct,
                });
              }
            } catch {}
          }
        }
      }
    }
  }

  return opportunities.sort((a, b) => b.profit_percent - a.profit_percent).slice(0, 5);
};

/**
 * Single-exchange triangular arbitrage detection
 * Finds profitable paths within a single exchange (no withdrawal delays)
 * Example: USDT→SOL→ETH→USDT or USDT→BTC→ETH→USDT
 */
export const findSingleExchangeTriangularArbitrage = (
  priceMap: Record<string, any>,
  tradeAmount: number,
  exchange = 'binance'
): any[] => {
  const opportunities: any[] = [];
  const valid = (p: any) => p && isFinite(p.askPrice) && isFinite(p.bidPrice) && p.askPrice > 0.00000001 && p.bidPrice > 0.00000001;

  logDebugIfExchange(exchange, 'findSingleExchangeTriangularArbitrage START', {
    total_pairs: Object.keys(priceMap).length
  });

  // Dynamically derive active tokens from priceMap (TOP MOVERS)
  const availableTokens = new Set<string>();
  for (const pair of Object.keys(priceMap)) {
    if (pair.endsWith('USDT')) {
      const token = pair.replace('USDT', '');
      if (token && token !== 'BTC' && token !== 'ETH') availableTokens.add(token);
    }
  }
  
  logDebugIfExchange(exchange, 'Available tokens for single-exchange', {
    count: availableTokens.size,
    sample: Array.from(availableTokens).slice(0, 10),
    includes_btc: Object.keys(priceMap).some(p => p === 'BTCUSDT'),
    includes_eth: Object.keys(priceMap).some(p => p === 'ETHUSDT'),
  });
  
  const bases = ['USDT', 'BTC', 'ETH'];
  const intermediates = availableTokens.size > 0 ? Array.from(availableTokens) : EXPANDED_ALTCOINS.filter(a => !bases.includes(a));

  let pathsChecked = 0;
  let pathsWithMissingPairs = 0;
  let pathsWithInvalidData = 0;
  let pathsFound = 0;

  for (const base of bases) {
    for (let i = 0; i < intermediates.length; i++) {
      for (let j = i + 1; j < intermediates.length; j++) {
        const int1 = intermediates[i];
        const int2 = intermediates[j];

        // Path 1: BASE → INT1 → INT2 → BASE
        const pair1 = `${int1}${base}`;
        const pair2 = `${int2}${int1}`;
        const pair3 = `${int2}${base}`;

        const p1 = priceMap[pair1];
        const p2 = priceMap[pair2];
        const p3 = priceMap[pair3];
        
        pathsChecked++;

        if (!p1 || !p2 || !p3) {
          pathsWithMissingPairs++;
          if ((exchange === 'gate' || exchange === 'bybit') && pathsChecked <= 3) {
            logDebugIfExchange(exchange, `Path missing pairs: ${base}→${int1}→${int2}→${base}`, {
              pair1: { name: pair1, exists: !!p1 },
              pair2: { name: pair2, exists: !!p2 },
              pair3: { name: pair3, exists: !!p3 }
            });
          }
          continue;
        }

        if (!valid(p1) || !valid(p2) || !valid(p3)) {
          pathsWithInvalidData++;
          continue;
        }
        
        if (valid(p1) && valid(p2) && valid(p3)) {
          try {
            // Convert base to int1
            let amount = tradeAmount / p1.askPrice;
            if (!isFinite(amount) || amount <= 0) throw new Error('step1');

            // Convert int1 to int2
            amount = amount / p2.askPrice;
            if (!isFinite(amount) || amount <= 0) throw new Error('step2');

            // Convert int2 back to base
            const endAmount = amount * p3.bidPrice;
            const profit = endAmount - tradeAmount;
            const profitPercent = (profit / tradeAmount) * 100;

            // Sanity check: Reject unrealistic profits (> 50% in one triangle is likely data error)
            if (profit > 0.01 && profitPercent > 0.05 && profitPercent < 20) {
              opportunities.push({
                type: 'triangular_arbitrage',
                base_symbol: base,
                intermediate_symbol: int1,
                quote_symbol: int2,
                exchange1: exchange,
                exchange2: exchange,
                exchange3: exchange,
                step1_pair: pair1,
                step1_action: 'BUY',
                step1_price: p1.askPrice,
                step1_amount: tradeAmount / p1.askPrice,
                step2_pair: pair2,
                step2_action: 'BUY',
                step2_price: p2.askPrice,
                step2_amount: (tradeAmount / p1.askPrice) / p2.askPrice,
                step3_pair: pair3,
                step3_action: 'SELL',
                step3_price: p3.bidPrice,
                step3_amount: (tradeAmount / p1.askPrice) / p2.askPrice,
                start_amount: tradeAmount,
                end_amount: endAmount,
                profit_amount: profit,
                profit_percent: profitPercent,
              });
            }
          } catch {
            // ignore calculation errors
          }
        }

        // Path 2: BASE → INT2 → INT1 → BASE (reverse)
        const pair1r = `${int2}${base}`;
        const pair2r = `${int1}${int2}`;
        const pair3r = `${int1}${base}`;

        const p1r = priceMap[pair1r];
        const p2r = priceMap[pair2r];
        const p3r = priceMap[pair3r];

        if (valid(p1r) && valid(p2r) && valid(p3r)) {
          try {
            let amount = tradeAmount / p1r.askPrice;
            if (!isFinite(amount) || amount <= 0) throw new Error('step1');

            amount = amount / p2r.askPrice;
            if (!isFinite(amount) || amount <= 0) throw new Error('step2');

            const endAmount = amount * p3r.bidPrice;
            const profit = endAmount - tradeAmount;
            const profitPercent = (profit / tradeAmount) * 100;

            if (profit > 0.01 && profitPercent > 0.05 && profitPercent < 20) {
              opportunities.push({
                type: 'triangular_arbitrage',
                base_symbol: base,
                intermediate_symbol_1: int2,
                intermediate_symbol_2: int1,
                exchange1: exchange,
                exchange2: exchange,
                exchange3: exchange,
                step1_pair: pair1r,
                step1_action: 'BUY',
                step1_price: p1r.askPrice,
                step1_amount: tradeAmount / p1r.askPrice,
                step2_pair: pair2r,
                step2_action: 'BUY',
                step2_price: p2r.askPrice,
                step2_amount: (tradeAmount / p1r.askPrice) / p2r.askPrice,
                step3_pair: pair3r,
                step3_action: 'SELL',
                step3_price: p3r.bidPrice,
                step3_amount: (tradeAmount / p1r.askPrice) / p2r.askPrice,
                start_amount: tradeAmount,
                end_amount: endAmount,
                profit_amount: profit,
                profit_percent: profitPercent,
              });
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }

  logDebugIfExchange(exchange, 'findSingleExchangeTriangularArbitrage COMPLETE', {
    paths_checked: pathsChecked,
    paths_with_missing_pairs: pathsWithMissingPairs,
    paths_with_invalid_data: pathsWithInvalidData,
    opportunities_found: opportunities.length,
    missing_pair_percent: pathsChecked > 0 ? ((pathsWithMissingPairs / pathsChecked) * 100).toFixed(1) + '%' : 'N/A'
  });

  return opportunities.sort((a, b) => b.profit_percent - a.profit_percent).slice(0, 10);
};

// Exchange tokens (bridge coins) for each exchange
export const EXCHANGE_TOKENS = {
  'binance': 'BNB',
  'bybit': 'MNT',
  'okx': 'OKB',
  'gate': 'GT',
  'mexc': 'MX',
  'kucoin': 'KCS'
};

/**
 * Stablecoin arbitrage detection
 * Finds profitable spreads between stablecoins using exchange tokens as bridges
 * Example: USDT → BNB → FRAX → USDT on Binance
 * This is categorized as triangular_arbitrage (intra-exchange)
 * 
 * IMPORTANT: For stablecoins, only report profit if all three prices are available
 * and the price calculation doesn't result in unrealistic gains (>10% indicates data error)
 */
export const findStablecoinArbitrage = (
  priceMap: Record<string, any>,
  tradeAmount: number,
  exchange = 'binance'
): any[] => {
  const opportunities: any[] = [];
  const valid = (p: any) => p && isFinite(p.askPrice) && isFinite(p.bidPrice) && p.askPrice > 0.00000001 && p.bidPrice > 0.00000001;

  // Get the exchange token for this exchange
  const exchangeToken = EXCHANGE_TOKENS[exchange as keyof typeof EXCHANGE_TOKENS];
  if (!exchangeToken) return [];

  // Generate paths: STABLECOIN1 → EXCHANGE_TOKEN → STABLECOIN2 → STABLECOIN1
  const stablecoins = STABLECOINS.filter(s => s !== 'USDT'); // Use USDT as base

  for (const stablecoin of stablecoins) {
    // Path 1: USDT → EXCHANGE_TOKEN → STABLECOIN → USDT
    // Example: USDT → BNB → FRAX → USDT
    const pair1 = `${exchangeToken}USDT`; // Buy exchange token with USDT
    const pair2 = `${stablecoin}${exchangeToken}`; // Buy stablecoin with exchange token
    const pair3 = `${stablecoin}USDT`; // Sell stablecoin for USDT

    const p1 = priceMap[pair1];
    const p2 = priceMap[pair2];
    const p3 = priceMap[pair3];

    if (valid(p1) && valid(p2) && valid(p3)) {
      try {
        // USDT → Exchange Token
        const step1Amount = tradeAmount / p1.askPrice;
        if (!isFinite(step1Amount) || step1Amount <= 0) throw new Error('step1');

        // Exchange Token → Stablecoin
        const step2Amount = step1Amount / p2.askPrice;
        if (!isFinite(step2Amount) || step2Amount <= 0) throw new Error('step2');

        // Stablecoin → USDT
        const endAmount = step2Amount * p3.bidPrice;
        const profit = endAmount - tradeAmount;
        const profitPercent = (profit / tradeAmount) * 100;

        // Filter out impossible profits (>10% is unrealistic for stablecoins)
        // These indicate missing/incorrect price data
        if (profit > 0.01 && profitPercent > 0.05 && profitPercent < 10) {
          opportunities.push({
            type: 'triangular_arbitrage',
            base_symbol: 'USDT',
            intermediate_symbol: exchangeToken,
            quote_symbol: stablecoin,
            exchange1: exchange,
            exchange2: exchange,
            exchange3: exchange,
            step1_action: 'BUY',
            step1_price: p1.askPrice,
            step1_amount: step1Amount,
            step2_action: 'BUY',
            step2_price: p2.askPrice,
            step2_amount: step2Amount,
            step3_action: 'SELL',
            step3_price: p3.bidPrice,
            step3_amount: step2Amount,
            start_amount: tradeAmount,
            end_amount: endAmount,
            profit_amount: profit,
            profit_percent: profitPercent,
          });
        }
      } catch {
        // ignore calculation errors
      }
    }

    // Path 2: USDT → STABLECOIN → EXCHANGE_TOKEN → USDT (reverse)
    // Example: USDT → FRAX → BNB → USDT
    const pair1r = `${stablecoin}USDT`; // Buy stablecoin with USDT
    const pair2r = `${exchangeToken}${stablecoin}`; // Buy exchange token with stablecoin
    const pair3r = `${exchangeToken}USDT`; // Sell exchange token for USDT

    const p1r = priceMap[pair1r];
    const p2r = priceMap[pair2r];
    const p3r = priceMap[pair3r];

    if (valid(p1r) && valid(p2r) && valid(p3r)) {
      try {
        const step1Amount = tradeAmount / p1r.askPrice;
        if (!isFinite(step1Amount) || step1Amount <= 0) throw new Error('step1');

        const step2Amount = step1Amount * p2r.bidPrice;
        if (!isFinite(step2Amount) || step2Amount <= 0) throw new Error('step2');

        const endAmount = step2Amount * p3r.bidPrice;
        const profit = endAmount - tradeAmount;
        const profitPercent = (profit / tradeAmount) * 100;

        // Filter out impossible profits
        if (profit > 0.01 && profitPercent > 0.05 && profitPercent < 10) {
          opportunities.push({
            type: 'triangular_arbitrage',
            base_symbol: 'USDT',
            intermediate_symbol: stablecoin,
            quote_symbol: exchangeToken,
            exchange1: exchange,
            exchange2: exchange,
            exchange3: exchange,
            step1_action: 'BUY',
            step1_price: p1r.askPrice,
            step1_amount: step1Amount,
            step2_action: 'SELL',
            step2_price: p2r.bidPrice,
            step2_amount: step1Amount,
            step3_action: 'SELL',
            step3_price: p3r.bidPrice,
            step3_amount: step2Amount,
            start_amount: tradeAmount,
            end_amount: endAmount,
            profit_amount: profit,
            profit_percent: profitPercent,
          });
        }
      } catch {
        // ignore
      }
    }
  }

  return opportunities.sort((a, b) => b.profit_percent - a.profit_percent).slice(0, 10);
};

/**
 * Dynamic multi-bridge discovery
 * Finds profitable opportunities using any available token as a bridge
 * Scans priceMap to find all possible pairs and create opportunities
 */
export const findMultiBridgeOpportunities = (
  priceMap: Record<string, any>,
  tradeAmount: number,
  exchange = 'binance'
): any[] => {
  const opportunities: any[] = [];
  const valid = (p: any) => p && isFinite(p.askPrice) && isFinite(p.bidPrice) && p.askPrice > 0.00000001 && p.bidPrice > 0.00000001;

  // Extract all available tokens from price map (remove USDT suffix to get base tokens)
  const availableTokens = new Set<string>();
  for (const pair of Object.keys(priceMap)) {
    // Extract base token from pairs like BTCUSDT, ETHBNB, etc.
    for (const stablecoin of ['USDT', 'USDC', 'BUSD', 'DAI', 'FRAX']) {
      if (pair.endsWith(stablecoin)) {
        const token = pair.slice(0, -stablecoin.length);
        if (token && token.length > 0 && token.length < 10) {
          availableTokens.add(token);
        }
      }
    }
  }

  // Popular secondary bridges beyond just exchange token
  const secondaryBridges = [
    'BTC', 'ETH', 'SOL', 'ADA', 'MATIC', 'AVAX', 'LINK', 'UNI', 
    'AAVE', 'CRV', 'APT', 'ARB', 'OP', 'FXS', 'GLM', 'ENJ'
  ];

  // Try bridges: USDT, secondary bridges, and high-volume tokens
  const bridges = ['USDT', ...secondaryBridges].filter(b => availableTokens.has(b));

  // For each bridge, find all altcoins we can trade through it
  for (const bridge of bridges) {
    if (bridge === 'USDT') continue; // Skip USDT -> USDT (already covered in other functions)

    // Look for USDT/bridge pair and bridge/altcoin pairs
    const bridgeUsdt = priceMap[`${bridge}USDT`];
    if (!valid(bridgeUsdt)) continue;

    // Find altcoins that have both bridge and USDT pairs
    for (const altcoin of Array.from(availableTokens)) {
      if (altcoin === 'USDT' || altcoin === bridge) continue;

      const altcoinBridge = priceMap[`${altcoin}${bridge}`];
      const altcoinUsdt = priceMap[`${altcoin}USDT`];

      if (!valid(altcoinBridge) || !valid(altcoinUsdt)) continue;

      // Path 1: USDT -> BRIDGE -> ALTCOIN -> USDT
      try {
        const step1Amount = tradeAmount / bridgeUsdt.askPrice;
        if (!isFinite(step1Amount) || step1Amount <= 0) throw new Error('step1');
        const step2Amount = step1Amount / altcoinBridge.askPrice;
        if (!isFinite(step2Amount) || step2Amount <= 0) throw new Error('step2');
        const step3Amount = step2Amount * altcoinUsdt.bidPrice;

        const profit = step3Amount - tradeAmount;
        const profitPercent = (profit / tradeAmount) * 100;

        if (profit > 0.001 && profitPercent > 0.001 && profitPercent < 20) {
          opportunities.push({
            strategy: 'triangular_arbitrage',
            path: ['USDT', bridge, altcoin, 'USDT'],
            exchange1: exchange,
            exchange2: exchange,
            exchange3: exchange,
            pair1: `${bridge}USDT`,
            pair2: `${altcoin}${bridge}`,
            pair3: `${altcoin}USDT`,
            profit_percent: profitPercent,
            start_amount: tradeAmount,
            end_amount: step3Amount,
            profit_amount: profit,
            detected_at: Math.floor(Date.now() / 1000),
          });
        }
      } catch {
        // ignore
      }

      // Path 2: USDT -> ALTCOIN -> BRIDGE -> USDT (reverse)
      try {
        const step1Amount = tradeAmount / altcoinUsdt.askPrice;
        if (!isFinite(step1Amount) || step1Amount <= 0) throw new Error('step1');
        const step2Amount = step1Amount * altcoinBridge.bidPrice;
        if (!isFinite(step2Amount) || step2Amount <= 0) throw new Error('step2');
        const step3Amount = step2Amount * bridgeUsdt.bidPrice;

        const profit = step3Amount - tradeAmount;
        const profitPercent = (profit / tradeAmount) * 100;

        if (profit > 0.001 && profitPercent > 0.001 && profitPercent < 20) {
          opportunities.push({
            strategy: 'triangular_arbitrage',
            path: ['USDT', altcoin, bridge, 'USDT'],
            exchange1: exchange,
            exchange2: exchange,
            exchange3: exchange,
            pair1: `${altcoin}USDT`,
            pair2: `${altcoin}${bridge}`,
            pair3: `${bridge}USDT`,
            profit_percent: profitPercent,
            start_amount: tradeAmount,
            end_amount: step3Amount,
            profit_amount: profit,
            detected_at: Math.floor(Date.now() / 1000),
          });
        }
      } catch {
        // ignore
      }
    }
  }

  return opportunities.sort((a, b) => (b.profit_percent || 0) - (a.profit_percent || 0)).slice(0, 20);
};

/**
 * Cross-exchange multi-bridge discovery
 * Finds profitable opportunities across multiple exchanges using various bridges
 */
export const findCrossExchangeMultiBridge = (
  allPriceMaps: Record<string, Record<string, any>>,
  tradeAmount: number
): any[] => {
  const opportunities: any[] = [];
  const exchanges = Object.keys(allPriceMaps);
  const valid = (p: any) => p && isFinite(p.askPrice) && isFinite(p.bidPrice) && p.askPrice > 0.00000001 && p.bidPrice > 0.00000001;

  // Popular bridges for cross-exchange
  const bridges = ['BTC', 'ETH', 'BNB', 'SOL', 'MATIC', 'ADA', 'AVAX', 'LINK', 'UNI'];

  for (const bridge of bridges) {
    for (const e1 of exchanges) {
      for (const e2 of exchanges) {
        for (const e3 of exchanges) {
          const pm1 = allPriceMaps[e1];
          const pm2 = allPriceMaps[e2];
          const pm3 = allPriceMaps[e3];

          const bridgeUsdt1 = pm1[`${bridge}USDT`];
          if (!valid(bridgeUsdt1)) continue;

          // Find altcoins that trade against this bridge on e2 and against USDT on e3
          const availableTokens = new Set<string>();
          for (const pair of Object.keys(pm2)) {
            if (pair.endsWith(bridge) && pair !== bridge && pair.length < 20) {
              availableTokens.add(pair.slice(0, -bridge.length));
            }
          }

          for (const altcoin of availableTokens) {
            if (altcoin === 'USDT' || altcoin === bridge) continue;

            const altcoinBridge = pm2[`${altcoin}${bridge}`];
            const altcoinUsdt = pm3[`${altcoin}USDT`];

            if (!valid(altcoinBridge) || !valid(altcoinUsdt)) continue;

            // USDT@e1 -> BRIDGE@e1 -> ALTCOIN@e2 -> USDT@e3
            try {
              const step1 = tradeAmount / bridgeUsdt1.askPrice;
              if (!isFinite(step1) || step1 <= 0) throw new Error('step1');
              const step2 = step1 / altcoinBridge.askPrice;
              if (!isFinite(step2) || step2 <= 0) throw new Error('step2');
              const step3 = step2 * altcoinUsdt.bidPrice;
              const profit = step3 - tradeAmount;
              const profitPct = (profit / tradeAmount) * 100;

              if (profit > 0.001 && profitPct > 0.001 && profitPct < 50) {
                opportunities.push({
                  strategy: 'cross_exchange',
                  path: ['USDT', bridge, altcoin, 'USDT'],
                  exchange1: e1,
                  exchange2: e2,
                  exchange3: e3,
                  pair1: `${bridge}USDT`,
                  pair2: `${altcoin}${bridge}`,
                  pair3: `${altcoin}USDT`,
                  profit_percent: profitPct,
                  start_amount: tradeAmount,
                  end_amount: step3,
                  profit_amount: profit,
                  detected_at: Math.floor(Date.now() / 1000),
                });
              }
            } catch {
              // ignore
            }
          }
        }
      }
    }
  }

  return opportunities.sort((a, b) => (b.profit_percent || 0) - (a.profit_percent || 0)).slice(0, 30);
};

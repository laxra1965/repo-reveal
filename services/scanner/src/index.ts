
import { ScannerService } from './ScannerService';
import { SupabaseWriter } from './SupabaseWriter';

if (process.env.RUNTIME !== 'vps') {
    throw new Error('Trading code may only run on VPS');
}

console.log('Scanner Service Starting (Phase 3 - All Exchanges)...');

// Shared writer for all scanner instances — single batch queue, single flush timer
const writer = new SupabaseWriter();

// Exchange-specific symbol formats
// USDT pairs + cross-pairs (BTC/ETH/BNB quoted) for triangular arbitrage
const binanceSymbols = [
    // USDT pairs
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'MATICUSDT',
    // BTC cross-pairs
    'ETHBTC', 'BNBBTC', 'SOLBTC', 'XRPBTC', 'ADABTC', 'DOGEBTC', 'AVAXBTC', 'LINKBTC', 'DOTBTC',
    // ETH cross-pairs
    'BNBETH', 'SOLETH', 'XRPETH', 'ADAETH', 'LINKETH', 'DOTETH',
    // BNB cross-pairs
    'ADABNB', 'XRPBNB', 'DOTBNB',
];
const bybitSymbols = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'BNBUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT',
    'ETHBTC', 'SOLBTC', 'XRPBTC', 'ADABTC', 'DOGEBTC', 'AVAXBTC', 'LINKBTC', 'DOTBTC',
    'SOLETH', 'ADAETH', 'LINKETH',
];
const okxSymbols = [
    'BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'XRP-USDT', 'DOGE-USDT', 'ADA-USDT', 'AVAX-USDT', 'LINK-USDT', 'DOT-USDT',
    'ETH-BTC', 'SOL-BTC', 'XRP-BTC', 'ADA-BTC', 'DOGE-BTC', 'AVAX-BTC', 'LINK-BTC', 'DOT-BTC',
    'SOL-ETH', 'ADA-ETH', 'LINK-ETH',
];
const gateSymbols = [
    'BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'XRP_USDT', 'DOGE_USDT', 'ADA_USDT', 'AVAX_USDT', 'LINK_USDT', 'DOT_USDT',
    'ETH_BTC', 'SOL_BTC', 'XRP_BTC', 'ADA_BTC', 'DOGE_BTC', 'AVAX_BTC', 'LINK_BTC', 'DOT_BTC',
    'SOL_ETH', 'ADA_ETH', 'LINK_ETH',
];
const mexcSymbols = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT',
    'ETHBTC', 'SOLBTC', 'XRPBTC', 'ADABTC', 'DOGEBTC', 'AVAXBTC', 'LINKBTC', 'DOTBTC',
    'SOLETH', 'ADAETH',
];
const kucoinSymbols = [
    'BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'XRP-USDT', 'DOGE-USDT', 'ADA-USDT', 'AVAX-USDT', 'LINK-USDT', 'DOT-USDT',
    'ETH-BTC', 'SOL-BTC', 'XRP-BTC', 'ADA-BTC', 'DOGE-BTC', 'AVAX-BTC', 'LINK-BTC', 'DOT-BTC',
    'SOL-ETH', 'ADA-ETH', 'LINK-ETH',
];
const htxSymbols = [
    'btcusdt', 'ethusdt', 'solusdt', 'xrpusdt', 'dogeusdt', 'adausdt', 'avaxusdt', 'linkusdt', 'dotusdt',
    'ethbtc', 'solbtc', 'xrpbtc', 'adabtc', 'dogebtc', 'avaxbtc', 'linkbtc', 'dotbtc',
    'soleth', 'adaeth',
];
const bitgetSymbols = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT',
    'ETHBTC', 'SOLBTC', 'XRPBTC', 'ADABTC', 'DOGEBTC', 'AVAXBTC', 'LINKBTC', 'DOTBTC',
    'SOLETH', 'ADAETH',
];

const exchanges = [
    { name: 'binance', symbols: binanceSymbols },
    { name: 'bybit',   symbols: bybitSymbols },
    { name: 'okx',     symbols: okxSymbols },
    { name: 'gate',    symbols: gateSymbols },
    { name: 'mexc',    symbols: mexcSymbols },
    { name: 'kucoin',  symbols: kucoinSymbols },
    { name: 'htx',     symbols: htxSymbols },
    { name: 'bitget',  symbols: bitgetSymbols },
];

for (const ex of exchanges) {
    const scanner = new ScannerService(0.5, ex.symbols, ex.name, undefined, undefined, writer);
    scanner.start().catch(err => console.error(`[${ex.name}] Fatal start error:`, err));
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[Scanner] SIGTERM received, flushing writer...');
    await writer.stop();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[Scanner] SIGINT received, flushing writer...');
    await writer.stop();
    process.exit(0);
});

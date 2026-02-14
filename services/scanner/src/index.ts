
import { ScannerService } from './ScannerService';
import { SupabaseWriter } from './SupabaseWriter';

if (process.env.RUNTIME !== 'vps') {
    throw new Error('Trading code may only run on VPS');
}

console.log('Scanner Service Starting (Phase 3 - All Exchanges)...');

// Shared writer for all scanner instances — single batch queue, single flush timer
const writer = new SupabaseWriter();

// Exchange-specific symbol formats
const binanceSymbols = ['BTCUSDT', 'ETHUSDT', 'ETHBTC', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT'];
const bybitSymbols  = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'BNBUSDT'];
const okxSymbols    = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'XRP-USDT', 'DOGE-USDT', 'ADA-USDT'];
const gateSymbols   = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'XRP_USDT', 'DOGE_USDT', 'ADA_USDT'];
const mexcSymbols   = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT'];
const kucoinSymbols = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'XRP-USDT', 'DOGE-USDT', 'ADA-USDT'];

const exchanges = [
    { name: 'binance', symbols: binanceSymbols },
    { name: 'bybit',   symbols: bybitSymbols },
    { name: 'okx',     symbols: okxSymbols },
    { name: 'gate',    symbols: gateSymbols },
    { name: 'mexc',    symbols: mexcSymbols },
    { name: 'kucoin',  symbols: kucoinSymbols },
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

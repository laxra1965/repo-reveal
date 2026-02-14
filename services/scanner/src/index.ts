
import { ScannerService } from './ScannerService';
import { SupabaseWriter } from './SupabaseWriter';

if (process.env.RUNTIME !== 'vps') {
    throw new Error('Trading code may only run on VPS');
}

console.log('Scanner Service Starting (Phase 2 - Multi-Exchange)...');

// Shared writer for all scanner instances
const writer = new SupabaseWriter();

const binanceSymbols = ['BTCUSDT', 'ETHUSDT', 'ETHBTC', 'BNBUSDT', 'SOLUSDT'];
const bybitSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'];
const okxSymbols = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BTC-USDC'];

// Start scanners per exchange
const binanceScanner = new ScannerService(0.5, binanceSymbols, 'binance', undefined, undefined, writer);
binanceScanner.start().catch(console.error);

const bybitScanner = new ScannerService(0.5, bybitSymbols, 'bybit', undefined, undefined, writer);
bybitScanner.start().catch(console.error);

const okxScanner = new ScannerService(0.5, okxSymbols, 'okx', undefined, undefined, writer);
okxScanner.start().catch(console.error);

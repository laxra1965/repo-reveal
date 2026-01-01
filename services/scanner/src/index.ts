
import { ScannerService } from './ScannerService';

if (process.env.RUNTIME !== 'vps') {
    throw new Error('Trading code may only run on VPS');
}

console.log('Scanner Service Starting (Phase 2 - Multi-Exchange)...');

const binanceSymbols = ['BTCUSDT', 'ETHUSDT', 'ETHBTC', 'BNBUSDT', 'SOLUSDT'];
const bybitSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'];
const okxSymbols = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BTC-USDC'];

// Start scanners per exchange
const binanceScanner = new ScannerService(0.5, binanceSymbols, 'binance');
binanceScanner.start().catch(console.error);

const bybitScanner = new ScannerService(0.5, bybitSymbols, 'bybit');
bybitScanner.start().catch(console.error);

const okxScanner = new ScannerService(0.5, okxSymbols, 'okx');
okxScanner.start().catch(console.error);

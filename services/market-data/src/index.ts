
if (process.env.RUNTIME !== 'vps') {
    throw new Error('Trading code may only run on VPS');
}

import { BinanceDepthConsumer } from './BinanceDepthConsumer';
import { BybitDepthConsumer } from './BybitDepthConsumer';
import { OKXDepthConsumer } from './OKXDepthConsumer';
import { startMoversFetchers } from './movers';

console.log('Market Data Service Starting (Phase 2 - Multi-Exchange)...');

const binanceSymbols = ['BTCUSDT', 'ETHUSDT', 'ETHBTC', 'BNBUSDT', 'SOLUSDT'];
const bybitSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'];
const okxSymbols = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BTC-USDC'];

async function start() {
    // Start movers fetchers for all exchanges
    startMoversFetchers();

    // Start Binance consumers
    for (const symbol of binanceSymbols) {
        new BinanceDepthConsumer(symbol).start().catch(e => console.error(`[Binance ${symbol}] failed`, e));
    }

    // Start Bybit consumers
    for (const symbol of bybitSymbols) {
        new BybitDepthConsumer(symbol).start().catch(e => console.error(`[Bybit ${symbol}] failed`, e));
    }

    // Start OKX consumers
    for (const symbol of okxSymbols) {
        new OKXDepthConsumer(symbol).start().catch(e => console.error(`[OKX ${symbol}] failed`, e));
    }
}

start().catch(console.error);

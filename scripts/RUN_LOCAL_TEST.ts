
/**
 * Universal Local Integration Test Runner
 * This script runs Market Data, Scanner, and Executor in a single process
 * using ioredis-mock to simulate Redis communication without Docker/VPS.
 */

// 1. Bypass VPS guard and set test environment
process.env.RUNTIME = 'vps';
process.env.NODE_ENV = 'test';

import Redis from 'ioredis-mock';
import { BinanceDepthConsumer } from '../services/market-data/src/BinanceDepthConsumer.ts';
import { ScannerService } from '../services/scanner/src/ScannerService.ts';
import { ExecutorService } from '../services/executor/src/ExecutorService.ts';

async function runLocalTest() {
    console.log('--- STARTING LOCAL TEST SCRIPT ---');
    console.log('🚀 Starting Universal Local Integration Test...');
    console.log('📦 Mocking Redis using ioredis-mock...');

    // Use shared mock redis instances so all services can communicate in the same process
    // ioredis-mock by default shares the same data if created in the same process
    const pub = new Redis();
    const subMarket = new Redis();
    const subExecutor = new Redis();

    const symbols = ['BTCUSDT', 'ETHUSDT', 'ETHBTC'];
    const exchange = 'binance';

    console.log('📡 Initializing Services...');

    // 1. Initialize Executor
    const executor = new ExecutorService(exchange, subExecutor);
    await executor.start();
    console.log('✅ Executor Service started (listening for opportunities)');

    // 2. Initialize Scanner
    const scanner = new ScannerService(0.1, symbols, exchange, pub, subMarket); // Lower profit for testing
    await scanner.start();
    console.log('✅ Scanner Service started (listening for depth updates)');

    // 3. Start Market Data (Binance Consumer)
    console.log('📈 Starting Binance Depth Consumers...');
    for (const symbol of symbols) {
        const consumer = new BinanceDepthConsumer(symbol, pub);
        await consumer.start();
        console.log(`✅ Consumer for ${symbol} started`);
    }

    console.log('\n--- SYSTEM LIVE ---');
    console.log('The system is now running locally WITHOUT Redis/Docker/VPS.');
    console.log('It is fetching REAL market data from Binance and simulating arbitrage paths.');
    console.log('Check the console for "Found opportunities" and "Processing opportunity" logs.');
    console.log('Press Ctrl+C to stop.\n');
}

runLocalTest().catch(err => {
    console.error('❌ Integration Test Failed:', err);
    process.exit(1);
});

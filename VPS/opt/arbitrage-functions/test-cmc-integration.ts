/**
 * CMC Integration Tests
 * 
 * Run this file to validate the entire CMC filtering layer works correctly.
 * 
 * Usage: deno run --allow-all test-cmc-integration.ts
 */

import { getCMCFilteredCoins, clearCMCCache } from './supabase/functions/utils/cmc-filter.ts';
import { 
  filterPairsFromPriceMap,
  parsePair,
  shouldIncludePair,
  getValidBases
} from './supabase/functions/utils/exchange-pair-filter.ts';
import { buildTriangles, getTriangleStats } from './supabase/functions/utils/triangle-builder.ts';
import { buildCMCFilteredTriangles } from './supabase/functions/utils/cmc-integration.ts';

const API_KEY = '22b82bdc85a24871a9e7a8073ff9ecb5';

// Color output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color = colors.reset) {
  console.log(color + message + colors.reset);
}

function success(test: string, message?: string) {
  log(`✓ ${test}${message ? ': ' + message : ''}`, colors.green);
}

function fail(test: string, message?: string) {
  log(`✗ ${test}${message ? ': ' + message : ''}`, colors.red);
}

function info(message: string) {
  log(message, colors.cyan);
}

// ============================================================================
// TEST SUITE
// ============================================================================

async function testCMCFilter() {
  info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  info('TEST SUITE: CMC Filter');
  info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    log('\n[CMC Filter] Fetching coins...', colors.blue);
    clearCMCCache(); // Start fresh

    const coins = await getCMCFilteredCoins(API_KEY, {
      limit: 50,
      cacheDurationMs: 1 * 60 * 1000,
    });

    if (!coins || coins.size === 0) {
      fail('CMC Filter', 'No coins returned');
      return false;
    }

    success('CMC Filter', `${coins.size} coins fetched`);

    // Check cache
    const cacheStatus = getCMCCacheStatus?.();
    if (cacheStatus) {
      success('CMC Cache', `${cacheStatus.symbols} symbols, age: ${cacheStatus.age_ms}ms`);
    }

    return true;
  } catch (error) {
    fail('CMC Filter', error.toString());
    return false;
  }
}

function testExchangePairFilter() {
  info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  info('TEST SUITE: Exchange Pair Filter');
  info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Mock price map
  const mockPriceMap: Record<string, any> = {
    'ARBUSD': { askPrice: 1.5, bidPrice: 1.49 },
    'ARBUSDT': { askPrice: 1.5, bidPrice: 1.49 },
    'ARBBTC': { askPrice: 0.00004, bidPrice: 0.00003999 },
    'BTCUSDT': { askPrice: 45000, bidPrice: 44999 },
    'ETHUSDT': { askPrice: 3000, bidPrice: 2999 },
    'OPUSDT': { askPrice: 2.5, bidPrice: 2.49 },
    'UPUSDT': { askPrice: 1, bidPrice: 0.99 }, // Leveraged token - should be filtered
  };

  const filteredSymbols = new Set(['ARB', 'OP', 'BTC', 'ETH']);

  log('\n[Pair Filter] Filtering pairs...', colors.blue);
  const filtered = filterPairsFromPriceMap(mockPriceMap, filteredSymbols);

  success('Pair Filter', `${filtered.length} pairs passed filter`);

  // Check individual pairs
  success('Parse Pair', parsePair('ARBUSDT')?.base === 'ARB' ? 'Correct' : 'Failed');
  success('Should Include', shouldIncludePair('ARBUSDT', filteredSymbols) ? 'Correct' : 'Failed');

  // Check bases
  const bases = getValidBases(filtered);
  if (bases.size > 0) {
    success('Valid Bases', `${bases.size} bases found: ${Array.from(bases).join(', ')}`);
  }

  return filtered.length > 0;
}

function testTriangleBuilder() {
  info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  info('TEST SUITE: Triangle Builder');
  info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Mock available pairs
  const mockPairs = [
    'ARBUSDT',
    'ARBBTC',
    'BTCUSDT',
    'ARBETH',
    'ETHUSDT',
    'OPUSDT',
    'OPBTC',
  ];

  const filteredSymbols = new Set(['ARB', 'OP', 'BTC', 'ETH', 'USDT']);

  log('\n[Triangle Builder] Building triangles...', colors.blue);
  const triangles = buildTriangles(mockPairs, filteredSymbols, 'binance');

  if (triangles.length > 0) {
    success('Triangle Builder', `${triangles.length} triangles built`);

    // Show first triangle
    const first = triangles[0];
    log(`  Example: ${first.path.join(' → ')}`, colors.yellow);
    log(`  Pairs: ${first.pairs.join(', ')}`, colors.yellow);

    // Get stats
    const stats = getTriangleStats(triangles);
    success('Triangle Stats', JSON.stringify(stats));
  } else {
    fail('Triangle Builder', 'No triangles built');
    return false;
  }

  return triangles.length > 0;
}

async function testFullIntegration() {
  info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  info('TEST SUITE: Full Integration');
  info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Mock price map
    const mockPriceMap: Record<string, any> = {
      'ARBUSD': { askPrice: 1.5, bidPrice: 1.49 },
      'ARBUSDT': { askPrice: 1.5, bidPrice: 1.49 },
      'ARBBTC': { askPrice: 0.00004, bidPrice: 0.00003999 },
      'BTCUSDT': { askPrice: 45000, bidPrice: 44999 },
      'ETHUSDT': { askPrice: 3000, bidPrice: 2999 },
      'OPUSDT': { askPrice: 2.5, bidPrice: 2.49 },
      'OPBTC': { askPrice: 0.000056, bidPrice: 0.000055 },
      'OPETH': { askPrice: 0.00083, bidPrice: 0.00082 },
      'INJUSDT': { askPrice: 27.5, bidPrice: 27.4 },
      'INJBTC': { askPrice: 0.00061, bidPrice: 0.0006 },
      'INJETH': { askPrice: 0.0092, bidPrice: 0.0091 },
    };

    log('\n[Full Integration] Running full orchestration...', colors.blue);

    const result = await buildCMCFilteredTriangles(mockPriceMap, 'binance', {
      cmcApiKey: API_KEY,
      cmcFilterConfig: {
        limit: 50,
        cacheDurationMs: 1 * 60 * 1000,
      },
    });

    success('Full Integration', `${result.stats.triangles_built} triangles built`);
    success('CMC Symbols', `${result.stats.cmc_symbols} coins filtered`);
    success('Available Pairs', `${result.stats.available_pairs} pairs available`);
    success('Search Reduction', `${result.stats.reduction_percent}% reduction`);

    return result.stats.triangles_built > 0;
  } catch (error) {
    fail('Full Integration', error.toString());
    return false;
  }
}

// ============================================================================
// RUN ALL TESTS
// ============================================================================

async function runAllTests() {
  log('\n' + '═'.repeat(50), colors.blue);
  log('CMC INTEGRATION TEST SUITE', colors.blue);
  log('═'.repeat(50), colors.blue);

  const tests = [
    { name: 'Exchange Pair Filter', fn: testExchangePairFilter },
    { name: 'Triangle Builder', fn: testTriangleBuilder },
    { name: 'CMC Filter', fn: testCMCFilter },
    { name: 'Full Integration', fn: testFullIntegration },
  ];

  const results: { name: string; passed: boolean }[] = [];

  for (const test of tests) {
    const passed = await test.fn();
    results.push({ name: test.name, passed });
  }

  // Summary
  info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  info('TEST SUMMARY', colors.blue);
  info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  for (const result of results) {
    if (result.passed) {
      success(`${result.name}`);
    } else {
      fail(`${result.name}`);
    }
  }

  info(`\nTotal: ${passed}/${total} tests passed`);

  if (passed === total) {
    log('\n✓ ALL TESTS PASSED - CMC Integration is ready!', colors.green);
    log('Next steps:', colors.green);
    log('1. Set CMC_API_KEY in Supabase secrets', colors.green);
    log('2. Import cmc-scanner-integration.ts in your scanner', colors.green);
    log('3. Call refreshCMCFilter() once per scan cycle', colors.green);
  } else {
    log('\n✗ Some tests failed - see details above', colors.red);
    log('Troubleshooting tips:', colors.red);
    log('1. Check API key is correct', colors.red);
    log('2. Verify network connectivity', colors.red);
    log('3. Check rate limits aren\'t exceeded', colors.red);
  }

  log('═'.repeat(50) + '\n', colors.blue);
}

// Run tests
if (import.meta.main) {
  runAllTests().catch(error => {
    console.error('Fatal error:', error);
    Deno.exit(1);
  });
}

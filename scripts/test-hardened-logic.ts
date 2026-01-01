import { Scanner, OrderBook } from '../services/scanner/src/Scanner';
import { EligibilityFilter, UserContext } from '../services/executor/src/EligibilityFilter';
import { AllocationEngine } from '../services/executor/src/AllocationEngine';
import { TierLevel } from '../shared/src/tier.config';

async function testHardenedLogic() {
    process.env.RUNTIME = 'vps';
    console.log("=== STARTING HARDENED LOGIC TESTS ===");

    // 1. TEST: STALE ORDER BOOKS BLOCK EXECUTION
    console.log("TEST 1: Stale Order Books...");
    const scanner = new Scanner(0.1);
    scanner.generatePaths('binance', ['BTCUSDT', 'ETHUSDT', 'ETHBTC']);

    const staleTime = Date.now() - 60000; // 60 seconds ago (Max is 10s)
    const mockBooks = new Map<string, OrderBook>();

    const createMockBook = (symbol: string, ts: number): OrderBook => ({
        symbol,
        timestamp: ts,
        bids: new Map([[50000, 1]]),
        asks: new Map([[50001, 1]]),
        getBestBid: () => ({ price: 50000, qty: 1 }),
        getBestAsk: () => ({ price: 50001, qty: 1 })
    });

    mockBooks.set('BTCUSDT', createMockBook('BTCUSDT', staleTime));
    mockBooks.set('ETHUSDT', createMockBook('ETHUSDT', Date.now()));
    mockBooks.set('ETHBTC', createMockBook('ETHBTC', Date.now()));

    const opps = scanner.scan('binance', mockBooks);
    if (opps.length === 0) {
        console.log("PASS: Stale order book prevented opportunity detection.");
    } else {
        console.error("FAIL: Opportunity detected with stale order book!");
        process.exit(1);
    }

    // 2. TEST: ALLOCATION ROUNDED DOWN & LIQUIDITY CONSTRAINT
    console.log("TEST 2: Allocation Hardening...");
    const allocEngine = new AllocationEngine();

    const mockOpp = {
        exchange: 'binance',
        path: ['USDT', 'BTC', 'ETH'],
        maxExecutableUSDT: 50.75, // Bottleneck liquidity
        profitPct: 1.5,
        timestamp: Date.now(),
        actions: []
    };

    const users: UserContext[] = [
        { userId: 'u1', tier: TierLevel.VIP, balances: { 'USDT': 1000 }, enabledExchanges: ['binance'], tradingEnabled: true, currentDailyLoss: 0, currentOpenPositions: 0 },
        { userId: 'u2', tier: TierLevel.VIP, balances: { 'USDT': 1000 }, enabledExchanges: ['binance'], tradingEnabled: true, currentDailyLoss: 0, currentOpenPositions: 0 }
    ];

    const allocations = allocEngine.allocate(mockOpp, users);
    const totalAlloc = allocations.reduce((s, a) => s + a.amount, 0);

    console.log(`Total Allocated: ${totalAlloc} / Max: ${mockOpp.maxExecutableUSDT}`);

    if (totalAlloc > mockOpp.maxExecutableUSDT) {
        console.error("FAIL: Total allocation exceeds liquidity!");
        process.exit(1);
    }

    const hasRoundingUp = allocations.some(a => a.amount !== Math.floor(a.amount * 100) / 100);
    if (hasRoundingUp) {
        console.error("FAIL: Allocation found with non-downward rounding!");
        process.exit(1);
    }

    console.log("PASS: Allocation constraints honored.");

    // 3. TEST: EXCHANGE HARD RULES (VIP ONLY & PROFIT BOOST)
    console.log("TEST 3: Exchange Hard Rules...");
    const filter = new EligibilityFilter();

    // MEXC is VIP ONLY and has 0.30% boost.
    // Pro Tier (0.3% min) should be REJECTED on MEXC even if profit is 0.5%.
    // Pro Tier (0.3% min) + MEXC Boost (0.3%) = 0.6% required.

    const mexcOpp = {
        exchange: 'mexc',
        path: ['USDT', 'BTC', 'ETH'],
        maxExecutableUSDT: 1000,
        profitPct: 0.55, // Greater than PRO min (0.3) but less than boosted min (0.6)
        timestamp: Date.now(),
        actions: []
    };

    const proUser: UserContext = {
        userId: 'u_pro',
        tier: TierLevel.PRO,
        balances: { 'USDT': 1000 },
        enabledExchanges: ['mexc'],
        tradingEnabled: true,
        currentDailyLoss: 0,
        currentOpenPositions: 0
    };

    const vipUser: UserContext = {
        userId: 'u_vip',
        tier: TierLevel.VIP,
        balances: { 'USDT': 1000 },
        enabledExchanges: ['mexc'],
        tradingEnabled: true,
        currentDailyLoss: 0,
        currentOpenPositions: 0
    };

    // MEXC is VIP Only. Pro User should be rejected regardless of profit.
    const eligiblePro = filter.filter(mexcOpp, [proUser]);
    if (eligiblePro.length === 0) {
        console.log("PASS: Pro user rejected for VIP-only MEXC.");
    } else {
        console.error("FAIL: Pro user allowed on VIP-only MEXC!");
        process.exit(1);
    }

    // VIP requirement met, but profitPct (0.55) < (VIP Min 0.1 + MEXC Boost 0.3 = 0.4)?
    // Wait, MEXC boost is 0.3. VIP min is 0.1. Total = 0.4.
    // 0.55 > 0.4, so VIP should be eligible for 0.55%.
    const eligibleVip = filter.filter(mexcOpp, [vipUser]);
    if (eligibleVip.length === 1) {
        console.log("PASS: VIP user allowed on MEXC with sufficient boosted profit.");
    } else {
        console.error("FAIL: VIP user rejected on MEXC with sufficient profit!");
        process.exit(1);
    }

    // Now test profit boost: profit (0.35) < (VIP 0.1 + MEXC 0.3 = 0.4)
    const lowProfitMexc = { ...mexcOpp, profitPct: 0.35 };
    const eligibleVipLow = filter.filter(lowProfitMexc, [vipUser]);
    if (eligibleVipLow.length === 0) {
        console.log("PASS: VIP user rejected on MEXC due to profit boost requirement.");
    } else {
        console.error("FAIL: VIP user allowed on MEXC despite boost requirement!");
        process.exit(1);
    }

    console.log("=== ALL HARDENED LOGIC TESTS PASSED ===");
}

testHardenedLogic().catch(e => {
    console.error(e);
    process.exit(1);
});

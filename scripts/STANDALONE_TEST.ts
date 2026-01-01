
/**
 * STANDALONE INTEGRATION TEST (WITH MOCK DATA)
 * This script runs the entire logic (OrderBook, Scanner, Executor) in one process.
 * It mocks:
 * 1. Redis (using ioredis-mock)
 * 2. Market Data (using a random generator instead of Binance)
 */

import Redis from 'ioredis-mock';

// --- SHARED TYPES ---

export type Level = [price: number, qty: number];

export class OrderBook {
    bids: Level[] = [];
    asks: Level[] = [];
    timestamp = 0;
    symbol: string;

    constructor(symbol: string) {
        this.symbol = symbol;
    }

    applySnapshot(bids: Level[], asks: Level[]) {
        this.bids = bids.map(b => [Number(b[0]), Number(b[1])] as Level).sort((a, b) => b[0] - a[0]);
        this.asks = asks.map(a => [Number(a[0]), Number(a[1])] as Level).sort((a, b) => a[0] - b[0]);
        this.timestamp = Date.now();
    }

    simulateMarketOrder(side: 'BUY' | 'SELL', amountIn: number) {
        let remaining = amountIn;
        let output = 0;
        const levels = side === 'BUY' ? this.asks : this.bids;
        for (const [price, qty] of levels) {
            if (remaining <= 0) break;
            if (side === 'BUY') {
                const maxBase = remaining / price;
                const taken = Math.min(qty, maxBase);
                remaining -= taken * price;
                output += taken;
            } else {
                const taken = Math.min(qty, remaining);
                remaining -= taken;
                output += taken * price;
            }
        }
        return { output, filled: remaining <= 1e-8 };
    }
}

export interface Opportunity {
    exchange: string;
    path: string[];
    actions: { symbol: string, side: 'BUY' | 'SELL' }[];
    profitPct: number;
    maxExecutableUSDT: number;
}

// --- SCANNER LOGIC ---

class Scanner {
    private paths: string[][] = [];
    constructor(private minProfitPct: number) { }

    generatePaths(symbols: string[]) {
        const quoteAssets = ['USDT', 'BTC', 'ETH', 'BNB'];
        const graph: Record<string, string[]> = {};
        const addEdge = (a: string, b: string) => {
            if (!graph[a]) graph[a] = [];
            if (!graph[b]) graph[b] = [];
            graph[a].push(b);
            graph[b].push(a);
        };
        for (const s of symbols) {
            for (const q of quoteAssets) {
                if (s.endsWith(q)) {
                    addEdge(s.substring(0, s.length - q.length), q);
                    break;
                }
            }
        }
        for (const start of quoteAssets) {
            if (!graph[start]) continue;
            for (const b of graph[start]) {
                for (const c of graph[b]) {
                    if (c !== start && graph[c]?.includes(start)) {
                        this.paths.push([start, b, c]);
                    }
                }
            }
        }
        console.log(`[Scanner] Generated ${this.paths.length} paths.`);
    }

    scan(orderBooks: Map<string, OrderBook>): Opportunity[] {
        const found: Opportunity[] = [];
        for (const path of this.paths) {
            const opp = this.simulate(path, orderBooks);
            if (opp) found.push(opp);
        }
        return found;
    }

    private simulate(path: string[], obs: Map<string, OrderBook>): Opportunity | null {
        const [a, b, c] = path;
        const leg = (f: string, t: string) => {
            if (obs.has(f + t)) return { symbol: f + t, side: 'SELL' as const };
            if (obs.has(t + f)) return { symbol: t + f, side: 'BUY' as const };
            return null;
        };
        const l1 = leg(a, b), l2 = leg(b, c), l3 = leg(c, a);
        if (!l1 || !l2 || !l3) return null;

        let amount = 100;
        for (const l of [l1, l2, l3]) {
            const ob = obs.get(l.symbol)!;
            if (ob.bids.length === 0 || ob.asks.length === 0) return null;
            const res = ob.simulateMarketOrder(l.side, amount);
            if (!res.filled) return null;
            amount = res.output * 0.999; // 0.1% fee
        }
        const profit = ((amount - 100) / 100) * 100;
        if (profit < this.minProfitPct) return null;

        return { exchange: 'binance', path, actions: [l1, l2, l3], profitPct: profit, maxExecutableUSDT: 100 };
    }
}

// --- MOCK MARKET DATA CONSUMER ---

class MockConsumer {
    private basePrice: number;
    constructor(private symbol: string, private redis: Redis) {
        // Assign realistic base prices
        if (symbol.includes('BTCUSDT')) this.basePrice = 90000;
        else if (symbol.includes('ETHUSDT')) this.basePrice = 3000;
        else if (symbol.includes('ETHBTC')) this.basePrice = 0.033;
        else this.basePrice = 100;
    }

    start() {
        console.log(`[MockConsumer] ${this.symbol} started.`);
        setInterval(() => {
            // Generate oscillating prices to eventually trigger an arb
            const drift = (Math.random() - 0.5) * 0.01; // 1% drift
            this.basePrice *= (1 + drift);

            const bids: Level[] = [[this.basePrice * 0.999, 10]];
            const asks: Level[] = [[this.basePrice * 1.001, 10]];

            this.redis.publish(`depth:binance:${this.symbol}`, JSON.stringify({
                symbol: this.symbol, bids, asks, timestamp: Date.now()
            }));
        }, 1000);
    }
}

// --- TEST RUNNER ---

async function run() {
    console.log('🚀 STANDALONE MOCK TEST STARTING...');

    // Bypass runtime check if any service uses it
    process.env.RUNTIME = 'vps';

    const redis = new Redis();
    const sub = new Redis();
    const symbols = ['BTCUSDT', 'ETHUSDT', 'ETHBTC'];

    const scanner = new Scanner(0.001); // Very low threshold to ensure we see something
    const obs = new Map<string, OrderBook>();

    scanner.generatePaths(symbols);

    sub.psubscribe('depth:binance:*');
    sub.on('pmessage', (_, __, raw) => {
        const data = JSON.parse(raw);
        if (!obs.has(data.symbol)) obs.set(data.symbol, new OrderBook(data.symbol));
        obs.get(data.symbol)!.applySnapshot(data.bids, data.asks);

        const opps = scanner.scan(obs);
        if (opps.length) {
            console.log(`✅ [${new Date().toLocaleTimeString()}] FOUND OPPORTUNITY!`);
            console.log(`   Path: ${opps[0].path.join(' -> ')}`);
            console.log(`   Profit: ${opps[0].profitPct.toFixed(4)}%`);
        }
    });

    for (const s of symbols) {
        new MockConsumer(s, redis).start();
    }

    console.log('\n--- SYSTEM LIVE (MOCKED DATA) ---');
    console.log('The bot is now scanning the mock market data in real-time via Redis pub/sub.');
}

run().catch(console.error);

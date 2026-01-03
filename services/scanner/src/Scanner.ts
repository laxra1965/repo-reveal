
import { OrderBook, Opportunity } from '../../../shared/src/types';

export { OrderBook, Opportunity };

export class Scanner {
    private paths: Map<string, string[][]> = new Map();
    private readonly MAX_STALE_MS = 10000; // 10 seconds

    private minProfitPct: number;
    constructor(minProfitPct: number = 0.5) {
        this.minProfitPct = minProfitPct;
    }

    generatePaths(exchange: string, symbols: string[], quoteAssets: string[] = ['USDT', 'USDC', 'BTC', 'ETH', 'BNB']) {
        const graph: Record<string, string[]> = {};

        const addEdge = (a: string, b: string) => {
            if (!graph[a]) graph[a] = [];
            if (!graph[b]) graph[b] = [];
            if (!graph[a].includes(b)) graph[a].push(b);
            if (!graph[b].includes(a)) graph[b].push(a);
        };

        for (const s of symbols) {
            // Support both BTCUSDT and BTC-USDT
            const normalized = s.replace('-', '').replace('_', '');
            for (const q of quoteAssets) {
                if (normalized.endsWith(q)) {
                    const base = normalized.substring(0, normalized.length - q.length);
                    addEdge(base, q);
                    break;
                }
            }
        }

        const validPaths: string[][] = [];
        for (const startNode of quoteAssets) {
            if (!graph[startNode]) continue;
            for (const neighborA of graph[startNode]) {
                if (!graph[neighborA]) continue;
                for (const neighborB of graph[neighborA]) {
                    if (neighborB === startNode) continue;
                    if (graph[neighborB] && graph[neighborB].includes(startNode)) {
                        validPaths.push([startNode, neighborA, neighborB]);
                    }
                }
            }
        }

        this.paths.set(exchange, validPaths);
        console.log(`[${exchange}] Generated ${validPaths.length} triangular paths.`);
    }

    scan(exchange: string, orderBooks: Map<string, OrderBook>, paths?: string[][]): Opportunity[] {
        // Use provided paths if available (dynamic), otherwise use cached paths
        const exchangePaths = paths || this.paths.get(exchange) || [];
        const opportunities: Opportunity[] = [];

        for (const path of exchangePaths) {
            const [assetA, assetB, assetC] = path;
            const res = this.simulateTriangle(exchange, orderBooks, assetA, assetB, assetC);
            if (res) {
                opportunities.push(res);
            }
        }

        return opportunities;
    }

    private simulateTriangle(
        exchange: string,
        orderBooks: Map<string, OrderBook>,
        a: string,
        b: string,
        c: string
    ): Opportunity | null {

        const fee = 0.001;
        const START = 100;

        const leg = (from: string, to: string) => {
            const possible = [
                `${from}${to}`, `${to}${from}`,
                `${from}-${to}`, `${to}-${from}`,
                `${from}_${to}`, `${to}_${from}`
            ];

            for (const sym of possible) {
                if (orderBooks.has(sym)) {
                    const side = sym.startsWith(from) ? 'SELL' as const : 'BUY' as const;
                    return { symbol: sym, side };
                }
            }
            return null;
        };

        const t1 = leg(a, b);
        const t2 = leg(b, c);
        const t3 = leg(c, a);
        if (!t1 || !t2 || !t3) return null;

        const now = Date.now();
        const obs = [t1, t2, t3].map(t => orderBooks.get(t.symbol)!);
        if (obs.some(ob => now - ob.timestamp > this.MAX_STALE_MS)) return null;

        let amount = START;

        for (const t of [t1, t2, t3]) {
            const ob = orderBooks.get(t.symbol)!;
            const res = ob.simulateMarketOrder(t.side, amount);
            if (!res.filled) return null;
            amount = res.output * (1 - fee);
            if (amount <= 0) return null;
        }

        const profitPct = ((amount - START) / START) * 100;
        if (profitPct <= this.minProfitPct) return null;

        return {
            exchange,
            path: [a, b, c],
            profitPct,
            maxExecutableUSDT: this.findMaxExecutable(
                [t1, t2, t3],
                orderBooks,
                this.minProfitPct
            ),
            timestamp: now,
            actions: [t1, t2, t3]
        };
    }

    private findMaxExecutable(
        path: { symbol: string; side: 'BUY' | 'SELL' }[],
        orderBooks: Map<string, OrderBook>,
        minProfitPct: number
    ): number {

        let low = 10;       // $10
        let high = 50_000;  // cap
        let best = 0;

        for (let i = 0; i < 15; i++) {
            const mid = (low + high) / 2;
            const profit = this.simulateWithSize(mid, path, orderBooks);

            if (profit > minProfitPct) {
                best = mid;
                low = mid;
            } else {
                high = mid;
            }
        }

        return best;
    }

    private simulateWithSize(
        size: number,
        path: { symbol: string; side: 'BUY' | 'SELL' }[],
        orderBooks: Map<string, OrderBook>
    ): number {

        const fee = 0.001;
        let amount = size;

        for (const leg of path) {
            const ob = orderBooks.get(leg.symbol)!;
            const res = ob.simulateMarketOrder(leg.side, amount);
            if (!res.filled) return -100;
            amount = res.output * (1 - fee);
        }

        return ((amount - size) / size) * 100;
    }
}

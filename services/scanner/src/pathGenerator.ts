import { getPriorityAssets } from "./movers";

const BASE_QUOTES = ["USDT", "BTC", "ETH", "BNB"];

const MAX_PATHS_PER_SCAN = 500; // Hard limit per PRD

export function generateDynamicPaths(
  exchange: string,
  availableSymbols: string[]
): string[][] {
  const dynamicAssets = new Set([
    ...BASE_QUOTES,
    ...getPriorityAssets(exchange)
  ]);

  const graph: Record<string, Set<string>> = {};

  // Build graph from available symbols
  for (const symbol of availableSymbols) {
    const normalized = symbol.replace('-', '').replace('_', '');
    for (const quote of BASE_QUOTES) {
      if (normalized.endsWith(quote)) {
        const base = normalized.substring(0, normalized.length - quote.length);
        graph[base] ??= new Set();
        graph[quote] ??= new Set();
        graph[base].add(quote);
        graph[quote].add(base);
      }
    }
  }

  const paths: string[][] = [];

  // Generate triangular paths using dynamic assets
  for (const a of dynamicAssets) {
    if (!graph[a]) continue;
    for (const b of graph[a]) {
      if (!graph[b]) continue;
      for (const c of graph[b]) {
        if (c !== a && graph[c]?.has(a)) {
          paths.push([a, b, c]);
          // Enforce max paths limit
          if (paths.length >= MAX_PATHS_PER_SCAN) {
            return paths;
          }
        }
      }
    }
  }

  return paths;
}


/**
 * Exchange-specific snapshot URLs for order book depth data.
 * Each exchange has its own REST API format.
 */

interface SnapshotConfig {
    buildUrl: (symbol: string) => string;
    parseResponse: (data: any) => {
        bids: [number, number][];
        asks: [number, number][];
        lastUpdateId: number;
    };
}

const configs: Record<string, SnapshotConfig> = {
    binance: {
        buildUrl: (symbol: string) =>
            `https://api.binance.com/api/v3/depth?symbol=${symbol.toUpperCase()}&limit=1000`,
        parseResponse: (data: any) => ({
            bids: data.bids,
            asks: data.asks,
            lastUpdateId: data.lastUpdateId,
        }),
    },
    bybit: {
        buildUrl: (symbol: string) =>
            `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${symbol.toUpperCase()}&limit=200`,
        parseResponse: (data: any) => {
            const result = data.result || {};
            return {
                bids: (result.b || []).map((l: string[]) => [Number(l[0]), Number(l[1])]),
                asks: (result.a || []).map((l: string[]) => [Number(l[0]), Number(l[1])]),
                lastUpdateId: result.u || Date.now(),
            };
        },
    },
    okx: {
        buildUrl: (symbol: string) => {
            // OKX uses BTC-USDT format
            const instId = symbol.includes('-') ? symbol.toUpperCase() : symbol.toUpperCase();
            return `https://www.okx.com/api/v5/market/books?instId=${instId}&sz=400`;
        },
        parseResponse: (data: any) => {
            const book = data.data?.[0] || {};
            return {
                bids: (book.bids || []).map((l: string[]) => [Number(l[0]), Number(l[1])]),
                asks: (book.asks || []).map((l: string[]) => [Number(l[0]), Number(l[1])]),
                lastUpdateId: Number(book.ts) || Date.now(),
            };
        },
    },
    gate: {
        buildUrl: (symbol: string) => {
            const pair = symbol.includes('_') ? symbol.toUpperCase() : symbol.toUpperCase();
            return `https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${pair}&limit=100`;
        },
        parseResponse: (data: any) => ({
            bids: (data.bids || []).map((l: string[]) => [Number(l[0]), Number(l[1])]),
            asks: (data.asks || []).map((l: string[]) => [Number(l[0]), Number(l[1])]),
            lastUpdateId: data.id || Date.now(),
        }),
    },
    mexc: {
        buildUrl: (symbol: string) =>
            `https://api.mexc.com/api/v3/depth?symbol=${symbol.toUpperCase()}&limit=1000`,
        parseResponse: (data: any) => ({
            bids: data.bids,
            asks: data.asks,
            lastUpdateId: data.lastUpdateId || Date.now(),
        }),
    },
    kucoin: {
        buildUrl: (symbol: string) => {
            const pair = symbol.includes('-') ? symbol : symbol.toUpperCase();
            return `https://api.kucoin.com/api/v1/market/orderbook/level2_100?symbol=${pair}`;
        },
        parseResponse: (data: any) => {
            const book = data.data || {};
            return {
                bids: (book.bids || []).map((l: string[]) => [Number(l[0]), Number(l[1])]),
                asks: (book.asks || []).map((l: string[]) => [Number(l[0]), Number(l[1])]),
                lastUpdateId: Number(book.sequence) || Date.now(),
            };
        },
    },
    htx: {
        buildUrl: (symbol: string) => {
            const sym = symbol.replace(/[-_]/g, '').toLowerCase();
            return `https://api.huobi.pro/market/depth?symbol=${sym}&type=step0&depth=150`;
        },
        parseResponse: (data: any) => {
            const tick = data.tick || {};
            return {
                bids: (tick.bids || []).map((l: number[]) => [l[0], l[1]]),
                asks: (tick.asks || []).map((l: number[]) => [l[0], l[1]]),
                lastUpdateId: data.ts || Date.now(),
            };
        },
    },
    bitget: {
        buildUrl: (symbol: string) => {
            const sym = symbol.replace(/[-_]/g, '').toUpperCase();
            return `https://api.bitget.com/api/v2/spot/market/orderbook?symbol=${sym}&limit=150`;
        },
        parseResponse: (data: any) => {
            const book = data.data || {};
            return {
                bids: (book.bids || []).map((l: string[]) => [Number(l[0]), Number(l[1])]),
                asks: (book.asks || []).map((l: string[]) => [Number(l[0]), Number(l[1])]),
                lastUpdateId: Number(book.ts) || Date.now(),
            };
        },
    },
};

export function getSnapshotConfig(exchange: string): SnapshotConfig {
    const config = configs[exchange.toLowerCase()];
    if (!config) {
        console.warn(`[snapshotUrls] No config for ${exchange}, falling back to binance`);
        return configs.binance;
    }
    return config;
}

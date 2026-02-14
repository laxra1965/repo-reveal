import { createClient, SupabaseClient } from '@supabase/supabase-js';

interface OpportunityRow {
    exchange1: string;
    exchange2: string;
    exchange3: string;
    base_symbol: string;
    quote_symbol: string;
    intermediate_symbol: string;
    type: string;
    step1_action: string;
    step1_price: number;
    step1_amount: number;
    step2_action: string;
    step2_price: number;
    step2_amount: number;
    step3_action: string;
    step3_price: number;
    step3_amount: number;
    start_amount: number;
    end_amount: number;
    profit_amount: number;
    profit_percent: number;
    expires_at: string;
    is_valid: boolean;
    signal_type: string;
}

export class SupabaseWriter {
    private supabase: SupabaseClient;
    private writeQueue: OpportunityRow[] = [];
    private flushInterval: ReturnType<typeof setInterval> | null = null;

    constructor() {
        const url = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!url || !serviceKey) {
            throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
        }

        this.supabase = createClient(url, serviceKey);

        // Flush queue every 2 seconds to batch writes
        this.flushInterval = setInterval(() => this.flush(), 2000);
        console.log('[SupabaseWriter] Initialized');
    }

    enqueue(exchange: string, opp: {
        path: string[];
        actions: { symbol: string; side: 'BUY' | 'SELL' }[];
        profitPct: number;
        maxExecutableUSDT: number;
        timestamp: number;
    }) {
        const [assetA, assetB, assetC] = opp.path;
        const startAmount = 100;
        const endAmount = startAmount * (1 + opp.profitPct / 100);
        const profitAmount = endAmount - startAmount;

        // TTL based on profit: higher profit = longer TTL
        const ttlSeconds = opp.profitPct > 1 ? 180 : opp.profitPct > 0.5 ? 120 : 60;
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

        const row: OpportunityRow = {
            exchange1: exchange,
            exchange2: exchange,
            exchange3: exchange,
            base_symbol: assetA,
            quote_symbol: assetB,
            intermediate_symbol: assetC,
            type: 'triangular',
            step1_action: `${opp.actions[0].side} ${opp.actions[0].symbol}`,
            step1_price: 0, // filled from orderbook best price
            step1_amount: startAmount,
            step2_action: `${opp.actions[1].side} ${opp.actions[1].symbol}`,
            step2_price: 0,
            step2_amount: 0,
            step3_action: `${opp.actions[2].side} ${opp.actions[2].symbol}`,
            step3_price: 0,
            step3_amount: 0,
            start_amount: startAmount,
            end_amount: endAmount,
            profit_amount: profitAmount,
            profit_percent: opp.profitPct,
            expires_at: expiresAt,
            is_valid: true,
            signal_type: 'arbitrage',
        };

        this.writeQueue.push(row);
    }

    private async flush() {
        if (this.writeQueue.length === 0) return;

        const batch = this.writeQueue.splice(0, 50); // max 50 per batch
        try {
            const { error, count } = await this.supabase
                .from('arbitrage_opportunities')
                .insert(batch);

            if (error) {
                console.error('[SupabaseWriter] Insert error:', error.message);
            } else {
                console.log(`[SupabaseWriter] Wrote ${batch.length} opportunities`);
            }
        } catch (e: any) {
            console.error('[SupabaseWriter] Flush error:', e.message);
        }
    }

    async stop() {
        if (this.flushInterval) clearInterval(this.flushInterval);
        await this.flush(); // final flush
    }
}

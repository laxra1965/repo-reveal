
import Redis from 'ioredis';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { IExchangeExecutor } from './ExecutionEngine';
import { isDryRun, isLiveTrading } from './config';

interface Leg {
    exchange: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    fromAsset: string;
    toAsset: string;
}

interface LegResult extends Leg {
    amountIn: number;
    fillAmount: number;
    fillPrice: number;
    fee: number;
    at: string;
}

const QUOTES = ['USDT', 'USDC', 'BUSD', 'BTC', 'ETH', 'BNB', 'DAI'];

/**
 * Bridges database-queued trades (trade_history rows in `pending`) to real
 * exchange execution. Listens on the Redis `trade:execute` channel published by
 * the VPS API, executes each leg through the exchange executors, and writes the
 * real outcome back into trade_history.
 */
export class TradeJobConsumer {
    private supabase: SupabaseClient;
    private inFlight = new Set<string>();

    constructor(
        private executor: IExchangeExecutor,
        private sub: Redis,
        private pub: Redis
    ) {
        const url = process.env.SUPABASE_URL || '';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
        if (!url || !key) throw new Error('TradeJobConsumer: missing Supabase credentials');
        this.supabase = createClient(url, key);
    }

    start() {
        this.sub.subscribe('trade:execute', (err) => {
            if (err) console.error('[TradeJobConsumer] subscribe failed:', err.message);
            else console.log(`[TradeJobConsumer] Listening on trade:execute (mode=${isLiveTrading() ? 'LIVE' : 'DRY_RUN'})`);
        });

        this.sub.on('message', async (channel, raw) => {
            if (channel !== 'trade:execute') return;
            try {
                const payload = JSON.parse(raw);
                await this.handle(payload);
            } catch (e: any) {
                console.error('[TradeJobConsumer] payload error:', e.message);
            }
        });

        // Safety net: pick up trades stuck in `pending` that never got a message.
        setInterval(() => this.pollPending().catch(() => { }), 15_000);
    }

    private async pollPending() {
        const { data } = await this.supabase
            .from('trade_history')
            .select('id, user_id, opportunity_id, start_amount, execution_details, created_at')
            .eq('status', 'pending')
            .gte('created_at', new Date(Date.now() - 5 * 60_000).toISOString())
            .limit(10);

        for (const trade of data || []) {
            if ((trade.execution_details as any)?.is_paper_trade) continue;
            await this.handle({ tradeId: trade.id, userId: trade.user_id });
        }
    }

    private splitSymbol(symbol: string): { base: string, quote: string } {
        const s = symbol.toUpperCase().replace(/[-_/]/g, '');
        for (const q of QUOTES) {
            if (s.endsWith(q) && s.length > q.length) return { base: s.slice(0, -q.length), quote: q };
        }
        return { base: s.slice(0, 3), quote: s.slice(3) };
    }

    /** Builds the ordered market-order legs for a triangular opportunity. */
    private buildLegs(opportunity: any): Leg[] {
        const pairs = [opportunity.pair1, opportunity.pair2, opportunity.pair3].filter(Boolean);
        const exchanges = [
            opportunity.exchange1,
            opportunity.exchange2 || opportunity.exchange1,
            opportunity.exchange3 || opportunity.exchange1
        ];

        const pathAssets: string[] = String(opportunity.path || '')
            .split(/\s*(?:→|->|>|\/|\|)\s*/)
            .map((p: string) => p.trim().toUpperCase())
            .filter(Boolean);

        const legs: Leg[] = [];
        let current = pathAssets[0];

        for (let i = 0; i < pairs.length; i++) {
            const { base, quote } = this.splitSymbol(pairs[i]);
            if (!current) current = quote;

            let side: 'BUY' | 'SELL';
            let toAsset: string;
            if (current === quote) { side = 'BUY'; toAsset = base; }
            else if (current === base) { side = 'SELL'; toAsset = quote; }
            else throw new Error(`Leg ${i + 1}: asset ${current} is not part of pair ${pairs[i]}`);

            legs.push({
                exchange: (exchanges[i] || 'binance').toLowerCase(),
                symbol: pairs[i].toUpperCase().replace(/[-_/]/g, ''),
                side,
                fromAsset: current,
                toAsset
            });
            current = toAsset;
        }

        if (legs.length === 0) throw new Error('Opportunity has no tradable pairs');
        return legs;
    }

    private async handle(payload: { tradeId: string, userId?: string }) {
        const tradeId = payload?.tradeId;
        if (!tradeId || this.inFlight.has(tradeId)) return;
        this.inFlight.add(tradeId);

        try {
            const { data: trade } = await this.supabase
                .from('trade_history')
                .select('*')
                .eq('id', tradeId)
                .maybeSingle();

            if (!trade) return;
            if (!['pending', 'executing'].includes(trade.status)) return;

            // Claim the trade (guards against double execution across instances)
            const { data: claimed } = await this.supabase
                .from('trade_history')
                .update({ status: 'executing', started_at: new Date().toISOString() })
                .eq('id', tradeId)
                .eq('status', trade.status)
                .select('id');

            if (!claimed || claimed.length === 0) return;

            const { data: opportunity } = await this.supabase
                .from('opportunities')
                .select('*')
                .eq('id', trade.opportunity_id)
                .maybeSingle();

            if (!opportunity) throw new Error('Opportunity no longer available');

            const legs = this.buildLegs(opportunity);
            const startAmount = Number(trade.start_amount) || 0;
            if (startAmount <= 0) throw new Error('Invalid start amount');

            const results: LegResult[] = [];
            let amount = startAmount;

            for (let i = 0; i < legs.length; i++) {
                const leg = legs[i];
                const res = await this.executor.executeMarketOrder(
                    trade.user_id, leg.exchange, leg.symbol, leg.side, amount
                );

                const filled = res.fillAmount > 0 ? res.fillAmount : amount;
                results.push({ ...leg, amountIn: amount, fillAmount: filled, fillPrice: res.fillPrice, fee: res.fee, at: new Date().toISOString() });

                await this.supabase
                    .from('trade_history')
                    .update({
                        completed_steps: i + 1,
                        execution_details: {
                            ...(trade.execution_details || {}),
                            mode: isLiveTrading() ? 'live' : 'dry_run',
                            route: 'vps_executor',
                            log: results
                        }
                    })
                    .eq('id', tradeId);

                amount = filled;
            }

            const finalAmount = amount;
            const profit = finalAmount - startAmount;

            await this.supabase
                .from('trade_history')
                .update({
                    status: 'completed',
                    final_amount: finalAmount,
                    actual_profit: profit,
                    completed_at: new Date().toISOString(),
                    completed_steps: legs.length,
                    total_steps: legs.length,
                    execution_details: {
                        ...(trade.execution_details || {}),
                        mode: isLiveTrading() ? 'live' : 'dry_run',
                        route: 'vps_executor',
                        exchanges: [...new Set(legs.map(l => l.exchange))].join(' / '),
                        log: results
                    }
                })
                .eq('id', tradeId);

            this.pub.publish('trade:result', JSON.stringify({ tradeId, status: 'completed', profit }));
            console.log(`[TradeJobConsumer] Trade ${tradeId} completed (${isDryRun() ? 'dry-run' : 'live'}), profit ${profit.toFixed(4)}`);
        } catch (e: any) {
            console.error(`[TradeJobConsumer] Trade ${tradeId} failed: ${e.message}`);
            await this.supabase
                .from('trade_history')
                .update({
                    status: 'failed',
                    error_message: e.message?.slice(0, 500),
                    completed_at: new Date().toISOString()
                })
                .eq('id', tradeId);
            this.pub.publish('trade:result', JSON.stringify({ tradeId, status: 'failed', error: e.message }));
        } finally {
            this.inFlight.delete(tradeId);
        }
    }
}

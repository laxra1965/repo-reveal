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

// --- Monitoring stats ---
interface WriterStats {
    totalEnqueued: number;
    totalWritten: number;
    totalFailed: number;
    totalRetries: number;
    consecutiveFailures: number;
    lastWriteAt: number | null;
    lastErrorAt: number | null;
    lastError: string | null;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000; // exponential: 1s, 2s, 4s
const MAX_QUEUE_SIZE = 500;
const ALERT_CONSECUTIVE_FAILURES = 5;

export class SupabaseWriter {
    private supabase: SupabaseClient;
    private writeQueue: OpportunityRow[] = [];
    private flushInterval: ReturnType<typeof setInterval> | null = null;
    private statsInterval: ReturnType<typeof setInterval> | null = null;
    private metricsInterval: ReturnType<typeof setInterval> | null = null;
    private stats: WriterStats = {
        totalEnqueued: 0,
        totalWritten: 0,
        totalFailed: 0,
        totalRetries: 0,
        consecutiveFailures: 0,
        lastWriteAt: null,
        lastErrorAt: null,
        lastError: null,
    };

    constructor() {
        const url = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!url || !serviceKey) {
            throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
        }

        this.supabase = createClient(url, serviceKey);

        // Flush queue every 2 seconds to batch writes
        this.flushInterval = setInterval(() => this.flush(), 2000);

        // Log stats every 30 seconds
        this.statsInterval = setInterval(() => this.logStats(), 30_000);

        // Persist health metrics to Supabase every 60 seconds
        this.metricsInterval = setInterval(() => this.persistMetrics(), 60_000);

        console.log('[SupabaseWriter] Initialized with retry, monitoring & metric persistence');
    }

    enqueue(exchange: string, opp: {
        path: string[];
        actions: { symbol: string; side: 'BUY' | 'SELL' }[];
        profitPct: number;
        maxExecutableUSDT: number;
        timestamp: number;
    }) {
        // Backpressure: drop oldest if queue is too large
        if (this.writeQueue.length >= MAX_QUEUE_SIZE) {
            const dropped = this.writeQueue.splice(0, 50);
            console.warn(`[SupabaseWriter] Queue overflow, dropped ${dropped.length} oldest entries`);
        }

        const [assetA, assetB, assetC] = opp.path;
        const startAmount = 100;
        const endAmount = startAmount * (1 + opp.profitPct / 100);
        const profitAmount = endAmount - startAmount;

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
            step1_price: 0,
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
        this.stats.totalEnqueued++;
    }

    private async flush() {
        if (this.writeQueue.length === 0) return;

        const batch = this.writeQueue.splice(0, 50);
        await this.insertWithRetry(batch, 0);
    }

    private async insertWithRetry(batch: OpportunityRow[], attempt: number) {
        try {
            const { error } = await this.supabase
                .from('arbitrage_opportunities')
                .insert(batch);

            if (error) {
                throw new Error(error.message);
            }

            // Success
            this.stats.totalWritten += batch.length;
            this.stats.consecutiveFailures = 0;
            this.stats.lastWriteAt = Date.now();
            console.log(`[SupabaseWriter] Wrote ${batch.length} opps (total: ${this.stats.totalWritten})`);

        } catch (e: any) {
            const errMsg = e.message || 'Unknown error';

            if (attempt < MAX_RETRIES) {
                this.stats.totalRetries++;
                const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
                console.warn(`[SupabaseWriter] Retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms: ${errMsg}`);
                await this.sleep(delay);
                return this.insertWithRetry(batch, attempt + 1);
            }

            // All retries exhausted
            this.stats.totalFailed += batch.length;
            this.stats.consecutiveFailures++;
            this.stats.lastErrorAt = Date.now();
            this.stats.lastError = errMsg;
            console.error(`[SupabaseWriter] FAILED after ${MAX_RETRIES} retries (${batch.length} rows lost): ${errMsg}`);

            if (this.stats.consecutiveFailures >= ALERT_CONSECUTIVE_FAILURES) {
                this.emitAlert();
            }
        }
    }

    private emitAlert() {
        console.error('🚨 [SupabaseWriter] ALERT: Multiple consecutive write failures!', {
            consecutiveFailures: this.stats.consecutiveFailures,
            totalFailed: this.stats.totalFailed,
            lastError: this.stats.lastError,
            queueDepth: this.writeQueue.length,
        });
        // Could integrate with external alerting (Slack webhook, PagerDuty, etc.)
    }

    private logStats() {
        const { totalEnqueued, totalWritten, totalFailed, totalRetries, consecutiveFailures, lastWriteAt, lastError } = this.stats;
        const queueDepth = this.writeQueue.length;
        const successRate = totalEnqueued > 0 ? ((totalWritten / totalEnqueued) * 100).toFixed(1) : '0';

        console.log(`[SupabaseWriter] Stats: enqueued=${totalEnqueued} written=${totalWritten} failed=${totalFailed} retries=${totalRetries} queue=${queueDepth} successRate=${successRate}% consecutiveFails=${consecutiveFailures} lastWrite=${lastWriteAt ? new Date(lastWriteAt).toISOString() : 'never'}${lastError ? ` lastErr="${lastError}"` : ''}`);
    }

    getStats(): WriterStats {
        return { ...this.stats };
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async stop() {
        if (this.flushInterval) clearInterval(this.flushInterval);
        if (this.statsInterval) clearInterval(this.statsInterval);
        if (this.metricsInterval) clearInterval(this.metricsInterval);
        await this.flush(); // final flush
        await this.persistMetrics(); // final metrics push
        this.logStats();
        console.log('[SupabaseWriter] Stopped');
    }

    private async persistMetrics() {
        const metrics = [
            { metric_name: 'writer_total_enqueued', metric_value: this.stats.totalEnqueued },
            { metric_name: 'writer_total_written', metric_value: this.stats.totalWritten },
            { metric_name: 'writer_total_failed', metric_value: this.stats.totalFailed },
            { metric_name: 'writer_total_retries', metric_value: this.stats.totalRetries },
            { metric_name: 'writer_consecutive_failures', metric_value: this.stats.consecutiveFailures },
            { metric_name: 'writer_queue_depth', metric_value: this.writeQueue.length },
            { metric_name: 'writer_success_rate', metric_value: this.stats.totalEnqueued > 0 ? (this.stats.totalWritten / this.stats.totalEnqueued) * 100 : 100 },
        ];

        try {
            const { error } = await this.supabase
                .from('scanner_health_metrics')
                .insert(metrics);

            if (error) {
                console.warn(`[SupabaseWriter] Failed to persist metrics: ${error.message}`);
            }
        } catch (e: any) {
            console.warn(`[SupabaseWriter] Metrics persistence error: ${e.message}`);
        }
    }
}

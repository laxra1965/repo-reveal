/**
 * BatchWriter - High-performance batch insertion to database
 * Flushes on size threshold OR time threshold
 */

export interface Opportunity {
    [key: string]: any;
}

export interface FlushResult {
    count: number;
    duration: number;
    error?: string;
}

export class BatchWriter {
    private buffer: Opportunity[] = [];
    private lastFlush = Date.now();
    private isFlushInProgress = false;
    private flushStats = {
        totalFlushed: 0,
        totalErrors: 0,
        lastFlushTime: 0,
        lastFlushCount: 0
    };

    constructor(
        private maxSize: number = 50,
        private maxTimeMs: number = 3000,
        private onFlush?: (batch: Opportunity[]) => Promise<void>
    ) {
        // Auto-flush timer
        this.startAutoFlushTimer();
    }

    /**
     * Add opportunity to buffer
     */
    push(item: Opportunity) {
        if (!item) return;

        this.buffer.push(item);

        // Flush if buffer exceeds size threshold
        if (this.buffer.length >= this.maxSize) {
            this.flush();
        }
    }

    /**
     * Start auto-flush timer
     */
    private startAutoFlushTimer() {
        setInterval(() => {
            if (this.buffer.length > 0) {
                this.flush();
            }
        }, this.maxTimeMs);
    }

    /**
     * Flush buffer to database
     */
    async flush(): Promise<FlushResult> {
        if (this.buffer.length === 0 || this.isFlushInProgress) {
            return { count: 0, duration: 0 };
        }

        this.isFlushInProgress = true;
        const startTime = Date.now();
        const batch = [...this.buffer];
        this.buffer = [];
        this.lastFlush = Date.now();

        try {
            console.log(`📤 [BatchWriter] Flushing ${batch.length} opportunities...`);

            // Call the registered flush handler if provided
            if (this.onFlush) {
                await this.onFlush(batch);
            }

            const duration = Date.now() - startTime;
            this.flushStats.totalFlushed += batch.length;
            this.flushStats.lastFlushTime = duration;
            this.flushStats.lastFlushCount = batch.length;

            console.log(`✅ [BatchWriter] Flushed ${batch.length} in ${duration}ms`);

            return { count: batch.length, duration };
        } catch (error) {
            this.flushStats.totalErrors++;
            const duration = Date.now() - startTime;
            const err = error instanceof Error ? error.message : String(error);

            console.error(`❌ [BatchWriter] Flush failed: ${err}`);

            // Re-add batch back to buffer for retry
            this.buffer.unshift(...batch);

            return { count: 0, duration, error: err };
        } finally {
            this.isFlushInProgress = false;
        }
    }

    /**
     * Force flush immediately
     */
    async forceFlush(): Promise<FlushResult> {
        return this.flush();
    }

    /**
     * Get buffer statistics
     */
    getStats() {
        return {
            bufferSize: this.buffer.length,
            maxSize: this.maxSize,
            maxTimeMs: this.maxTimeMs,
            isFlushInProgress: this.isFlushInProgress,
            ...this.flushStats,
            utilization: (this.buffer.length / this.maxSize) * 100
        };
    }

    /**
     * Get current buffer (read-only)
     */
    getBuffer(): readonly Opportunity[] {
        return Object.freeze([...this.buffer]);
    }

    /**
     * Clear buffer without flushing
     */
    clear() {
        const cleared = this.buffer.length;
        this.buffer = [];
        console.log(`⚠️ [BatchWriter] Cleared ${cleared} items from buffer`);
        return cleared;
    }
}

import { ExecutionJob, ExecutionEngine } from './ExecutionEngine';
import { TierLevel, getTierConfig } from '../../../shared/src';

export class JobScheduler {
    // Priority Queue: Map<TierLevel, Job[]> ? Or just a list we sort?
    // Since tiers are finite (VIP, PRO, BASIC), we can use buckets or strict sort.

    constructor(private executor: ExecutionEngine) { }

    /**
     * Schedules a batch of jobs for execution.
     * Sorts them by Tier Priority, then processes them.
     */
    async scheduleAndExecute(jobs: { job: ExecutionJob, tier: TierLevel }[]) {
        if (jobs.length === 0) return;

        // 1. Sort Jobs by Priority (High to Low)
        // VIP (100) > PRO (10) > BASIC (1)
        const sortedJobs = jobs.sort((a, b) => {
            const pA = getTierConfig(a.tier).priority;
            const pB = getTierConfig(b.tier).priority;
            return pB - pA; // Descending
        });

        // 2. Execute
        // Parallel or Serial?
        // "Lower tiers skipped if rate limit hit".
        // If we execute strictly serially, latencies add up.
        // But for Arb, speed is key. We probably want parallel but with priority?
        // Or if we have limited resource (e.g. Rate Limit on Exchange API), we MUST prioritize VIPs.
        // Assuming we share one API Key or IP Limit: prioritize VIPs.

        // Let's implement Serial Execution for MVP to safely manage rate limits (Task 8.1 implies skipping lower tiers if limit hit).
        // Or Parallel with Semaphore? 
        // Let's iterate.

        for (const item of sortedJobs) {
            // Check Rate Limit (Global or Per User?)
            // If Per User, we can run parallel.
            // If Global Exec Limit, we must check.

            // Assume Global Limit logic here (mocked)
            if (this.isRateLimited()) {
                console.warn(`Rate limit hit. Skipping job for ${item.tier} user ${item.job.userId}`);
                continue;
            }

            // Execute (Async but we might await if we want strict ordering? 
            // Usually we submit VIPs first and let valid promises race, but ensuring VIPs got their request out first).
            this.executor.executeJob(item.job, item.tier).catch(err => {
                console.error(`[JobScheduler] Job ${item.job.id} failed: ${err.message}`);
            });

            // Artificial delay to ensure priority submission order?
            // await new Promise(r => setTimeout(r, 10)); 
        }
    }

    private isRateLimited(): boolean {
        // Placeholder for Rate Limit Controller
        // e.g. defined in Phase 8
        return false;
    }
}

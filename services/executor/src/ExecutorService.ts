import { AsyncLogger, LogLevel } from './AsyncLogger';
import { EligibilityFilter, UserContext } from './EligibilityFilter';
import { AllocationEngine } from './AllocationEngine';
import { ExecutionEngine, IExchangeExecutor, ExecutionState } from './ExecutionEngine';
import { JobScheduler } from './JobScheduler';
import { TierLevel, OrderBook } from '../../../shared/dist/index';
import { KeyManager } from './KeyManager';
import { UserService } from './UserService';
import Redis from 'ioredis';

import { MultiExchangeExecutor } from './MultiExchangeExecutor';
import { TradeJobConsumer } from './TradeJobConsumer';

export class ExecutorService {
    private logger: AsyncLogger;
    private eligibilityFilter: EligibilityFilter;
    private allocationEngine: AllocationEngine;
    private executionEngine: ExecutionEngine;
    private jobScheduler: JobScheduler;
    private sub: Redis;
    private redis: Redis;
    private keyManager: KeyManager;
    private userService: UserService;
    private orderBooks: Map<string, OrderBook> = new Map();
    private exchangeExecutor: IExchangeExecutor;
    private tradeJobConsumer: TradeJobConsumer;

    constructor(redisInstance?: Redis) {
        this.logger = new AsyncLogger();
        this.eligibilityFilter = new EligibilityFilter();
        this.allocationEngine = new AllocationEngine();

        // 18.x Store reference for Admin Commands
        this.exchangeExecutor = new MultiExchangeExecutor();
        this.executionEngine = new ExecutionEngine(this.exchangeExecutor, this.orderBooks);

        this.jobScheduler = new JobScheduler(this.executionEngine);
        this.keyManager = new KeyManager();
        this.userService = new UserService();
        this.sub = redisInstance || new Redis();
        this.redis = this.sub.duplicate(); // For publishing
        // Bridges DB-queued trades (trade:execute) to real exchange orders
        this.tradeJobConsumer = new TradeJobConsumer(this.exchangeExecutor, this.sub.duplicate(), this.redis);
    }

    private trackOpportunity(opp: any, stage: string, reason?: string, meta?: any) {
        const id = opp.id || `opp_${opp.timestamp}_${opp.exchange}_${opp.path.join('')}`;
        const now = Date.now();
        const totalLatency = now - opp.timestamp;

        this.redis.publish(`tracking:opportunity`, JSON.stringify({
            id,
            exchange: opp.exchange,
            path: opp.path,
            stage,
            reason,
            latency_ms: totalLatency,
            internal_meta: meta,
            timestamp: now
        }));
    }

    async start() {
        this.logger.log(LogLevel.INFO, `[ExecutorService] Starting (Multi-Exchange)...`);
        this.tradeJobConsumer.start();
        this.sub.psubscribe(`opportunity:*`);
        this.sub.psubscribe(`depth:*`);
        this.sub.psubscribe(`admin:*`); // Phase 18 Admin Commands

        // Health heartbeat
        setInterval(() => {
            this.redis.publish(`health:executor`, JSON.stringify({
                timestamp: Date.now(),
                status: 'alive'
            }));
        }, 5000);

        this.sub.on('pmessage', async (_, channel, raw) => {
            try {
                // Phase 18 Admin Handlers
                if (channel.startsWith('admin:')) {
                    const data = JSON.parse(raw);
                    this.logger.log(LogLevel.WARN, `[Admin] Command received: ${channel}`);

                    if (channel === 'admin:ban') {
                        this.eligibilityFilter.banUser(data.userId, data.reason || 'Admin Ban');
                    }
                    else if (channel === 'admin:resume') {
                        // 17.3 Manual Resume
                        try {
                            this.executionEngine.resumeSystem(data.secret);
                        } catch (e: any) {
                            this.logger.log(LogLevel.ERROR, `[Admin] Resume failed: ${e.message}`);
                        }
                    }
                    else if (channel === 'admin:flush') {
                        // Cancel All for User or Exchange
                        await this.exchangeExecutor.cancelAllOrders(data.userId, data.exchange, data.symbol);
                    }
                    else if (channel === 'admin:withdraw') {
                        // Emergency Withdraw
                        await this.exchangeExecutor.withdraw(data.userId, data.exchange, data.asset, data.amount, data.address);
                    }
                    return;
                }

                if (channel.startsWith('depth:')) {
                    const data = JSON.parse(raw);
                    // Use exchange:symbol as key to avoid collisions
                    const exchange = channel.split(':')[1];
                    // Only process allowed exchanges (Phase 13.0.2 allowlist is enforced at Opportunity level, 
                    // but keeping depth sync is fine for all generally, or we filter here too).

                    if (data.type === 'delta') {
                        this.processUpdate(exchange, data);
                    }
                    return;
                }

                if (channel.startsWith('opportunity:')) {
                    const processingStart = Date.now();
                    const exchange = channel.split(':')[1];
                    const opportunities = JSON.parse(raw);
                    if (!Array.isArray(opportunities)) return;

                    // 13.0.2 Exchange Allowlist
                    const ALLOWED_EXCHANGES = ["binance", "bybit", "gate", "mexc"] as const;
                    const exName = exchange.toLowerCase() as any;
                    if (!ALLOWED_EXCHANGES.includes(exName)) {
                        console.warn(`[Executor] Exchange ${exchange} not in allowlist. Skipping.`);
                        return;
                    }

                    const users = await this.userService.getEligibleUsers(exchange);

                    for (const opp of opportunities) {
                        // 13.10 Global Kill Switch (Latency)
                        const latency = Date.now() - opp.timestamp;
                        if (latency > 300) {
                            // console.warn(`[Executor] Kill Switch: Latency ${latency}ms > 300ms. Dropping.`);
                            this.trackOpportunity(opp, 'KILLED', `Latency ${latency}ms > 300ms`);
                            continue;
                        }

                        const meta = { processing_time: Date.now() - processingStart };
                        this.trackOpportunity(opp, 'DETECTED', undefined, meta);

                        if (users.length === 0) {
                            this.trackOpportunity(opp, 'FILTERED', 'No eligible users on exchange');
                            continue;
                        }

                        const eligible = this.eligibilityFilter.filter(opp, users);
                        if (eligible.length === 0) {
                            this.trackOpportunity(opp, 'FILTERED', 'Users failed eligibility criteria');
                            continue;
                        }
                        this.trackOpportunity(opp, 'FILTERED');

                        const allocations = this.allocationEngine.allocate(opp, eligible);
                        if (allocations.length === 0) {
                            this.trackOpportunity(opp, 'ALLOCATED', 'Insufficient user balances');
                            continue;
                        }
                        this.trackOpportunity(opp, 'ALLOCATED');

                        this.logger.log(LogLevel.INFO, `[Executor] Processing opportunity on ${opp.path.join('->')} with ${allocations.length} users.`);

                        const jobs = allocations.map(a => {
                            const user = eligible.find(u => u.userId === a.userId)!;
                            const jobId = `job_${Date.now()}_${a.userId}`;

                            this.trackOpportunity(opp, 'EXECUTING', `Job ${jobId} for user ${a.userId}`);

                            return {
                                job: {
                                    id: jobId,
                                    userId: a.userId,
                                    opportunity: opp,
                                    allocation: a.amount,
                                    userEquity: user.balances[opp.path[0]] || 0,
                                    state: ExecutionState.INIT,
                                    logs: [],
                                    currentAsset: opp.path[0],
                                    currentAmount: a.amount
                                } as any,
                                tier: user.tier
                            };
                        });

                        await this.jobScheduler.scheduleAndExecute(jobs);
                    }
                }
            } catch (e: any) {
                this.logger.log(LogLevel.ERROR, `[ExecutorService] Message processing error: ${e.message}`);
            }
        });

        this.sub.on('error', (err) => this.logger.log(LogLevel.ERROR, `Redis Sub Error: ${err.message}`));
    }

    private async processUpdate(exchange: string, data: any) {
        const key = `${exchange}:${data.symbol}`;
        let ob = this.orderBooks.get(key);
        if (!ob) {
            await this.fetchSnapshot(exchange, data.symbol);
            return;
        }

        // Binance-specific strict sequencing
        if (exchange === 'binance' && data.u && data.U) {
            if (data.u <= ob.lastUpdateId) return;
            if (data.U > ob.lastUpdateId + 1) {
                this.logger.log(LogLevel.WARN, `[Executor] Gap ${data.symbol}: ${data.U} > ${ob.lastUpdateId}+1`);
                this.fetchSnapshot(exchange, data.symbol);
                return;
            }
            ob.lastUpdateId = data.u;
        }

        ob.applyDelta(data.bids, data.asks);
        ob.timestamp = data.timestamp;
    }

    private async fetchSnapshot(exchange: string, symbol: string) {
        if (exchange !== 'binance') return;
        try {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 3000);

            const res = await fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol.toUpperCase()}&limit=1000`, {
                signal: controller.signal
            });
            const snap = await res.json() as any;

            const key = `${exchange}:${symbol}`;
            let ob = this.orderBooks.get(key);
            if (!ob) {
                ob = new OrderBook(symbol);
                this.orderBooks.set(key, ob);
            }
            ob.applySnapshot(snap.bids, snap.asks);
            ob.lastUpdateId = snap.lastUpdateId;
            ob.timestamp = Date.now();
            this.logger.log(LogLevel.INFO, `[Executor] Snapshot loaded for ${symbol} @ ${ob.lastUpdateId}`);
        } catch (e: any) {
            this.logger.log(LogLevel.ERROR, `[Executor] Snapshot failed: ${e.message}`);
        }
    }
}

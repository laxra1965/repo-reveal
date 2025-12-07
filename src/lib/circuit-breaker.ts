/**
 * Circuit Breaker Pattern Implementation
 * 
 * Prevents cascading failures by temporarily blocking calls to failing services.
 * Three states: CLOSED (normal), OPEN (blocking), HALF_OPEN (testing recovery)
 */

export enum CircuitState {
    CLOSED = 'CLOSED',
    OPEN = 'OPEN',
    HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerConfig {
    failureThreshold: number;
    successThreshold: number;
    timeout: number;
    windowSize: number;
    name?: string;
}

export interface CircuitBreakerMetrics {
    state: CircuitState;
    failures: number;
    successes: number;
    totalCalls: number;
    lastFailureTime?: Date;
    lastStateChange: Date;
    openedAt?: Date;
    nextAttemptAt?: Date;
}

type CircuitStateChangeListener = (metrics: CircuitBreakerMetrics) => void;

export class CircuitBreaker {
    private state: CircuitState = CircuitState.CLOSED;
    private failureCount: number = 0;
    private successCount: number = 0;
    private totalCalls: number = 0;
    private lastFailureTime?: Date;
    private lastStateChange: Date = new Date();
    private openedAt?: Date;
    private nextAttemptAt?: Date;
    private failureWindow: number[] = [];
    private listeners: Set<CircuitStateChangeListener> = new Set();

    constructor(private config: CircuitBreakerConfig) {
        this.config = {
            failureThreshold: config.failureThreshold || 5,
            successThreshold: config.successThreshold || 2,
            timeout: config.timeout || 60000, // 60 seconds
            windowSize: config.windowSize || 60000, // 1 minute
            name: config.name || 'circuit-breaker',
        };
    }

    /**
     * Execute a function with circuit breaker protection
     */
    public async execute<T>(fn: () => Promise<T>): Promise<T> {
        if (this.state === CircuitState.OPEN) {
            if (this.shouldAttemptReset()) {
                this.transitionTo(CircuitState.HALF_OPEN);
            } else {
                throw new Error(
                    `Circuit breaker for ${this.config.name} is OPEN. Next attempt at ${this.nextAttemptAt?.toISOString()}`
                );
            }
        }

        this.totalCalls++;

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    private onSuccess(): void {
        this.failureCount = 0;

        if (this.state === CircuitState.HALF_OPEN) {
            this.successCount++;

            if (this.successCount >= this.config.successThreshold) {
                this.transitionTo(CircuitState.CLOSED);
                this.successCount = 0;
            }
        }
    }

    private onFailure(): void {
        this.lastFailureTime = new Date();
        this.failureCount++;
        this.failureWindow.push(Date.now());

        // Clean old failures outside the window
        const cutoff = Date.now() - this.config.windowSize;
        this.failureWindow = this.failureWindow.filter((time) => time > cutoff);

        if (this.state === CircuitState.HALF_OPEN) {
            // Any failure in HALF_OPEN state reopens the circuit
            this.transitionTo(CircuitState.OPEN);
            this.successCount = 0;
        } else if (this.failureWindow.length >= this.config.failureThreshold) {
            // Too many failures in the window - open the circuit
            this.transitionTo(CircuitState.OPEN);
        }
    }

    private shouldAttemptReset(): boolean {
        if (!this.nextAttemptAt) return false;
        return Date.now() >= this.nextAttemptAt.getTime();
    }

    private transitionTo(newState: CircuitState): void {
        const oldState = this.state;
        this.state = newState;
        this.lastStateChange = new Date();

        switch (newState) {
            case CircuitState.OPEN:
                this.openedAt = new Date();
                this.nextAttemptAt = new Date(Date.now() + this.config.timeout);
                console.warn(
                    `[CircuitBreaker:${this.config.name}] Opened - too many failures. Next attempt at ${this.nextAttemptAt.toISOString()}`
                );
                break;

            case CircuitState.HALF_OPEN:
                console.info(`[CircuitBreaker:${this.config.name}] Half-Open - testing recovery`);
                break;

            case CircuitState.CLOSED:
                this.openedAt = undefined;
                this.nextAttemptAt = undefined;
                this.failureCount = 0;
                this.failureWindow = [];
                console.info(`[CircuitBreaker:${this.config.name}] Closed - service recovered`);
                break;
        }

        // Notify listeners
        this.notifyListeners();
    }

    public getState(): CircuitState {
        return this.state;
    }

    public getMetrics(): CircuitBreakerMetrics {
        return {
            state: this.state,
            failures: this.failureCount,
            successes: this.successCount,
            totalCalls: this.totalCalls,
            lastFailureTime: this.lastFailureTime,
            lastStateChange: this.lastStateChange,
            openedAt: this.openedAt,
            nextAttemptAt: this.nextAttemptAt,
        };
    }

    public onStateChange(listener: CircuitStateChangeListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notifyListeners(): void {
        const metrics = this.getMetrics();
        this.listeners.forEach((listener) => {
            try {
                listener(metrics);
            } catch (error) {
                console.error('[CircuitBreaker] Listener error:', error);
            }
        });
    }

    public reset(): void {
        this.transitionTo(CircuitState.CLOSED);
    }

    public forceOpen(): void {
        this.transitionTo(CircuitState.OPEN);
    }
}

/**
 * Circuit Breaker Registry
 * Manages multiple circuit breakers by name
 */
class CircuitBreakerRegistry {
    private static instance: CircuitBreakerRegistry;
    private breakers: Map<string, CircuitBreaker> = new Map();

    private constructor() { }

    public static getInstance(): CircuitBreakerRegistry {
        if (!CircuitBreakerRegistry.instance) {
            CircuitBreakerRegistry.instance = new CircuitBreakerRegistry();
        }
        return CircuitBreakerRegistry.instance;
    }

    public getBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
        if (!this.breakers.has(name)) {
            const defaultConfig: CircuitBreakerConfig = {
                failureThreshold: 5,
                successThreshold: 2,
                timeout: 60000,
                windowSize: 60000,
                name,
                ...config,
            };
            this.breakers.set(name, new CircuitBreaker(defaultConfig));
        }
        return this.breakers.get(name)!;
    }

    public getAllMetrics(): Record<string, CircuitBreakerMetrics> {
        const metrics: Record<string, CircuitBreakerMetrics> = {};
        this.breakers.forEach((breaker, name) => {
            metrics[name] = breaker.getMetrics();
        });
        return metrics;
    }

    public resetAll(): void {
        this.breakers.forEach((breaker) => breaker.reset());
    }
}

// Export singleton instance
export const circuitBreakerRegistry = CircuitBreakerRegistry.getInstance();

// Helper function to get exchange-specific circuit breaker
export function getExchangeCircuitBreaker(exchange: string): CircuitBreaker {
    return circuitBreakerRegistry.getBreaker(`exchange-${exchange.toLowerCase()}`, {
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 120000, // 2 minutes for exchanges
        windowSize: 60000, // 1 minute window
    });
}

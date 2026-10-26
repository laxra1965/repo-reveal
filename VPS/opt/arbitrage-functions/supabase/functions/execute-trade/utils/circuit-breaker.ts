// Circuit Breaker Pattern for Deno/Supabase Edge Functions
// Prevents cascading failures by temporarily blocking requests after multiple failures

export enum CircuitState {
    CLOSED = 'CLOSED',     // Normal operation
    OPEN = 'OPEN',         // Blocking all requests
    HALF_OPEN = 'HALF_OPEN' // Testing if service recovered
}

export interface CircuitBreakerConfig {
    failureThreshold: number;  // Number of failures before opening circuit
    successThreshold: number;  // Number of successes to close circuit from half-open
    timeout: number;           // Milliseconds to wait before trying half-open
    monitorWindow?: number;    // Time window to track failures (optional)
}

export class CircuitBreaker {
    private state: CircuitState = CircuitState.CLOSED;
    private failureCount: number = 0;
    private successCount: number = 0;
    private lastFailureTime: number = 0;
    private lastStateChange: number = Date.now();

    constructor(
        private name: string,
        private config: CircuitBreakerConfig
    ) {
        console.log(`[CircuitBreaker:${name}] Initialized with config:`, config);
    }

    /**
     * Execute a function with circuit breaker protection
     */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        // Check if circuit should transition from OPEN to HALF_OPEN
        if (this.state === CircuitState.OPEN) {
            const timeSinceFailure = Date.now() - this.lastFailureTime;

            if (timeSinceFailure > this.config.timeout) {
                console.log(`[CircuitBreaker:${this.name}] Transitioning from OPEN to HALF_OPEN after ${timeSinceFailure}ms`);
                this.state = CircuitState.HALF_OPEN;
                this.successCount = 0;
                this.lastStateChange = Date.now();
            } else {
                const remainingTime = Math.ceil((this.config.timeout - timeSinceFailure) / 1000);
                throw new Error(`Circuit breaker is OPEN for ${this.name}. Please retry in ${remainingTime} seconds.`);
            }
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    /**
     * Handle successful execution
     */
    private onSuccess() {
        if (this.state === CircuitState.HALF_OPEN) {
            this.successCount++;
            console.log(`[CircuitBreaker:${this.name}] Success in HALF_OPEN state (${this.successCount}/${this.config.successThreshold})`);

            if (this.successCount >= this.config.successThreshold) {
                console.log(`[CircuitBreaker:${this.name}] CLOSING circuit after ${this.successCount} successes`);
                this.state = CircuitState.CLOSED;
                this.failureCount = 0;
                this.successCount = 0;
                this.lastStateChange = Date.now();
            }
        } else if (this.state === CircuitState.CLOSED) {
            // Gradually reduce failure count on success
            if (this.failureCount > 0) {
                this.failureCount = Math.max(0, this.failureCount - 1);
            }
        }
    }

    /**
     * Handle failed execution
     */
    private onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        console.log(`[CircuitBreaker:${this.name}] Failure recorded (${this.failureCount}/${this.config.failureThreshold})`);

        if (this.failureCount >= this.config.failureThreshold) {
            if (this.state !== CircuitState.OPEN) {
                console.log(`[CircuitBreaker:${this.name}] OPENING circuit after ${this.failureCount} failures`);
                this.state = CircuitState.OPEN;
                this.lastStateChange = Date.now();
            }
        }
    }

    /**
     * Get current circuit state
     */
    getState(): CircuitState {
        return this.state;
    }

    /**
     * Get circuit statistics
     */
    getStats() {
        return {
            name: this.name,
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            lastFailureTime: this.lastFailureTime,
            lastStateChange: this.lastStateChange,
            timeSinceStateChange: Date.now() - this.lastStateChange
        };
    }

    /**
     * Manually reset the circuit breaker
     */
    reset() {
        console.log(`[CircuitBreaker:${this.name}] Manual reset`);
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = 0;
        this.lastStateChange = Date.now();
    }

    /**
     * Check if circuit allows requests
     */
    isOpen(): boolean {
        return this.state === CircuitState.OPEN;
    }
}

/**
 * Circuit Breaker Registry for managing multiple breakers
 */
export class CircuitBreakerRegistry {
    private breakers = new Map<string, CircuitBreaker>();

    /**
     * Get or create a circuit breaker
     */
    getBreaker(name: string, config: CircuitBreakerConfig): CircuitBreaker {
        if (!this.breakers.has(name)) {
            const breaker = new CircuitBreaker(name, config);
            this.breakers.set(name, breaker);
        }
        return this.breakers.get(name)!;
    }

    /**
     * Get all breakers
     */
    getAllBreakers(): Map<string, CircuitBreaker> {
        return this.breakers;
    }

    /**
     * Get statistics for all breakers
     */
    getAllStats() {
        const stats: Array<ReturnType<CircuitBreaker['getStats']>> = [];
        for (const [_, breaker] of this.breakers) {
            stats.push(breaker.getStats());
        }
        return stats;
    }

    /**
     * Reset all circuit breakers
     */
    resetAll() {
        for (const [_, breaker] of this.breakers) {
            breaker.reset();
        }
    }
}

// Global registry instance
export const circuitBreakerRegistry = new CircuitBreakerRegistry();

/**
 * Get exchange-specific circuit breaker with default config
 */
export function getExchangeCircuitBreaker(exchange: string): CircuitBreaker {
    return circuitBreakerRegistry.getBreaker(exchange, {
        failureThreshold: 5,       // Open after 5 failures
        successThreshold: 2,        // Close after 2 successes in half-open
        timeout: 120000,            // 2 minutes cooldown
        monitorWindow: 60000        // 1 minute failure window
    });
}

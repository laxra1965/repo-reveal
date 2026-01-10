    private attempts = 0;
    private lastAttempt = 0;

    constructor(
        private readonly minDelay = 1_000,
        private readonly maxDelay = 30_000
    ) {}

    nextDelay(): number {
        this.attempts++;
        const delay = Math.min(
            this.minDelay * Math.pow(2, this.attempts - 1),
            this.maxDelay
        );
        this.lastAttempt = Date.now();
        return delay;
    }

    shouldReconnect(): boolean {
        return Date.now() - this.lastAttempt > this.minDelay;
    }

    reset() {
        this.attempts = 0;
        this.lastAttempt = 0;
    }
}


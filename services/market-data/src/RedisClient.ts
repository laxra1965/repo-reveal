
export const redis = new Redis({
    retryStrategy(times) {
        return Math.min(times * 100, 2000);
    }
});


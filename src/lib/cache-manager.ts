/**
 * Cache Manager
 * 
 * Client-side caching utility with TTL support and memory limits
 */

interface CacheEntry<T> {
    data: T;
    expiresAt: number;
    size: number;
}

interface CacheConfig {
    ttl: number; // Time to live in milliseconds
    maxSize?: number; // Max cache size in bytes (optional)
}

export class CacheManager {
    private cache: Map<string, CacheEntry<any>> = new Map();
    private currentSize: number = 0;
    private maxSizeBytes: number;
    private cleanupInterval: number;

    constructor() {
        // Get max size from environment or default to 50MB
        const maxSizeMB = parseInt(import.meta.env.VITE_CACHE_MAX_SIZE_MB || '50');
        this.maxSizeBytes = maxSizeMB * 1024 * 1024;

        // Cleanup expired entries every 5 minutes
        this.cleanupInterval = window.setInterval(() => {
            this.cleanupExpired();
        }, 5 * 60 * 1000);
    }

    /**
     * Estimate the size of data in bytes
     */
    private estimateSize(data: any): number {
        const str = JSON.stringify(data);
        return new Blob([str]).size;
    }

    /**
     * Set cache entry
     */
    public set<T>(key: string, data: T, ttl: number): void {
        const size = this.estimateSize(data);
        const expiresAt = Date.now() + ttl;

        // Check if adding this entry would exceed max size
        if (this.currentSize + size > this.maxSizeBytes) {
            // Evict oldest entries until there's space
            this.evictOldest(size);
        }

        // Remove existing entry if present
        if (this.cache.has(key)) {
            const existing = this.cache.get(key)!;
            this.currentSize -= existing.size;
        }

        // Add new entry
        this.cache.set(key, { data, expiresAt, size });
        this.currentSize += size;
    }

    /**
     * Get cache entry
     */
    public get<T>(key: string): T | null {
        const entry = this.cache.get(key);

        if (!entry) {
            return null;
        }

        // Check if expired
        if (Date.now() > entry.expiresAt) {
            this.delete(key);
            return null;
        }

        return entry.data as T;
    }

    /**
     * Get or fetch data with caching
     */
    public async getOrFetch<T>(
        key: string,
        fetcher: () => Promise<T>,
        ttl: number
    ): Promise<T> {
        const cached = this.get<T>(key);
        if (cached !== null) {
            return cached;
        }

        const data = await fetcher();
        this.set(key, data, ttl);
        return data;
    }

    /**
     * Delete cache entry
     */
    public delete(key: string): boolean {
        const entry = this.cache.get(key);
        if (entry) {
            this.currentSize -= entry.size;
            return this.cache.delete(key);
        }
        return false;
    }

    /**
     * Clear all cache entries
     */
    public clear(): void {
        this.cache.clear();
        this.currentSize = 0;
    }

    /**
     * Check if key exists and is not expired
     */
    public has(key: string): boolean {
        return this.get(key) !== null;
    }

    /**
     * Get cache statistics
     */
    public getStats(): {
        entries: number;
        sizeBytes: number;
        sizeMB: number;
        maxSizeBytes: number;
        maxSizeMB: number;
        utilizationPercent: number;
    } {
        return {
            entries: this.cache.size,
            sizeBytes: this.currentSize,
            sizeMB: this.currentSize / (1024 * 1024),
            maxSizeBytes: this.maxSizeBytes,
            maxSizeMB: this.maxSizeBytes / (1024 * 1024),
            utilizationPercent: (this.currentSize / this.maxSizeBytes) * 100,
        };
    }

    /**
     * Cleanup expired entries
     */
    private cleanupExpired(): void {
        const now = Date.now();
        const keysToDelete: string[] = [];

        this.cache.forEach((entry, key) => {
            if (now > entry.expiresAt) {
                keysToDelete.push(key);
            }
        });

        keysToDelete.forEach((key) => this.delete(key));

        if (keysToDelete.length > 0) {
            console.log(`[CacheManager] Cleaned up ${keysToDelete.length} expired entries`);
        }
    }

    /**
     * Evict oldest entries to make space
     */
    private evictOldest(requiredSpace: number): void {
        // Sort entries by expiration time (oldest first)
        const entries = Array.from(this.cache.entries()).sort(
            (a, b) => a[1].expiresAt - b[1].expiresAt
        );

        let freedSpace = 0;
        const keysToDelete: string[] = [];

        for (const [key, entry] of entries) {
            keysToDelete.push(key);
            freedSpace += entry.size;

            if (this.currentSize - freedSpace + requiredSpace <= this.maxSizeBytes) {
                break;
            }
        }

        keysToDelete.forEach((key) => this.delete(key));

        console.log(`[CacheManager] Evicted ${keysToDelete.length} entries to free ${freedSpace} bytes`);
    }

    /**
     * Destroy cache manager and cleanup
     */
    public destroy(): void {
        clearInterval(this.cleanupInterval);
        this.clear();
    }
}

// Singleton instance
let cacheManagerInstance: CacheManager | null = null;

export function getCacheManager(): CacheManager {
    if (!cacheManagerInstance) {
        cacheManagerInstance = new CacheManager();
    }
    return cacheManagerInstance;
}

// Cache key builders
export const CacheKeys = {
    userSettings: (userId: string) => `user-settings:${userId}`,
    userSubscription: (userId: string) => `user-subscription:${userId}`,
    exchangeBalances: (userId: string, exchange: string) =>
        `exchange-balances:${userId}:${exchange}`,
    subscriptionPlans: () => 'subscription-plans',
    adminSettings: () => 'admin-settings',
};

// TTL constants from environment
export const CacheTTL = {
    SETTINGS: parseInt(import.meta.env.VITE_CACHE_TTL_SETTINGS || '300') * 1000, // 5 minutes
    SUBSCRIPTION: parseInt(import.meta.env.VITE_CACHE_TTL_SUBSCRIPTION || '600') * 1000, // 10 minutes
    BALANCES: parseInt(import.meta.env.VITE_CACHE_TTL_BALANCES || '30') * 1000, // 30 seconds
    STATIC: 3600000, // 1 hour for rarely changing data
};

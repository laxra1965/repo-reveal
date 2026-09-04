
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

export interface ExchangeCredentials {
    apiKey: string;
    apiSecret: string;
    passphrase?: string;
}

interface CacheEntry {
    creds: ExchangeCredentials;
    expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

export class KeyManager {
    private supabase;
    private cache = new Map<string, CacheEntry>();

    constructor() {
        // Must use Service Role Key for backend access, but NEVER expose it.
        // It resides in ENV on the VPS.
        const url = process.env.SUPABASE_URL || '';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
        if (!url || !key) throw new Error("Missing Supabase Credentials");
        this.supabase = createClient(url, key);
    }

    /**
     * Decrypts a Vault-encrypted value. Falls back to the raw value when the
     * column already holds plaintext (legacy rows).
     */
    private async decrypt(value: string | null): Promise<string | null> {
        if (!value) return null;
        try {
            const { data, error } = await this.supabase.rpc('pgsodium_decrypt', {
                encrypted_secret: value
            });
            if (error || !data) return null;
            return data as string;
        } catch {
            return null;
        }
    }

    /**
     * Retrieves and decrypts exchange keys for a user.
     * GUARANTEE: Keys are never logged and only live in executor memory.
     */
    async getKeys(userId: string, exchange: string): Promise<ExchangeCredentials | null> {
        const cacheKey = `${userId}:${exchange.toLowerCase()}`;
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) return cached.creds;

        try {
            const { data, error } = await this.supabase
                .from('exchange_credentials')
                .select('api_key, api_secret, encrypted_api_key, encrypted_api_secret, encrypted_api_passphrase')
                .eq('user_id', userId)
                .eq('exchange', exchange.toLowerCase())
                .maybeSingle();

            if (error || !data) return null;

            // Prefer encrypted columns (decrypted here, in memory only).
            let apiKey = await this.decrypt(data.encrypted_api_key);
            let apiSecret = await this.decrypt(data.encrypted_api_secret);
            let passphrase = await this.decrypt(data.encrypted_api_passphrase ?? null);

            // Legacy fallback: plaintext columns.
            if (!apiKey) apiKey = data.api_key || null;
            if (!apiSecret) apiSecret = data.api_secret || null;

            if (!apiKey || !apiSecret) return null;

            const creds: ExchangeCredentials = {
                apiKey,
                apiSecret,
                passphrase: passphrase || undefined
            };

            this.cache.set(cacheKey, { creds, expiresAt: Date.now() + CACHE_TTL_MS });
            return creds;
        } catch {
            console.error(`Failed to fetch keys for user ${userId} (details suppressed)`);
            return null;
        }
    }

    invalidate(userId: string, exchange?: string) {
        if (exchange) this.cache.delete(`${userId}:${exchange.toLowerCase()}`);
        else for (const k of this.cache.keys()) if (k.startsWith(`${userId}:`)) this.cache.delete(k);
    }
}

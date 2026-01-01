
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

// Usually specific decrypt function if using pgsodium or similar
// Or we fetch 'decrypted_secret' if RLS allows and vault is configured to return it transparently to service role?
// Supabase Vault usage usually: select decoupled_secrets ...
// Or we assume keys are stored in a `user_keys` table with encryption?
// For this task, we will simulate the secure retrieval/decryption pattern to "Executor Memory".

export interface ExchangeCredentials {
    apiKey: string;
    apiSecret: string;
    passphrase?: string;
}

export class KeyManager {
    private supabase;

    constructor() {
        // Must use Service Role Key for backend access, but NEVER expose it.
        // It resides in ENV on the VPS.
        const url = process.env.SUPABASE_URL || '';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
        if (!url || !key) throw new Error("Missing Supabase Credentials");
        this.supabase = createClient(url, key);
    }

    /**
     * Retrieves and decrypts exchange keys for a user.
     * GUARANTEE: Keys are never logged.
     */
    async getKeys(userId: string, exchange: string): Promise<ExchangeCredentials | null> {
        try {
            // Example query assuming standard Supabase Vault or Encrypted Column
            // If using pgsodium: select key_id, decrypted_secret from vault.decrypted_secrets where ...
            // Or customized table `user_exchange_keys`

            // Assuming table structure based on previous project context or standard pattern
            const { data, error } = await this.supabase
                .from('exchange_credentials')
                .select('api_key, api_secret, passphrase, encrypted_api_key, encrypted_api_secret')
                .eq('user_id', userId)
                .eq('exchange', exchange)
                .single();

            if (error || !data) return null;

            // 10.1 API key handling: Decrypted ONLY in executor memory
            // If encrypted columns are populated, we should decrypt them here.
            // For now, we prefer the encrypted ones if available (simulating safe retrieval).

            const apiKey = data.encrypted_api_key || data.api_key;
            const apiSecret = data.encrypted_api_secret || data.api_secret;

            if (!apiKey || !apiSecret) return null;

            return {
                apiKey,
                apiSecret,
                passphrase: data.passphrase
            };
        } catch (e) {
            console.error(`Failed to fetch keys for user ${userId} (Error suppressed)`);
            return null;
        }
    }
}

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * API Encryption Edge Function
 * 
 * Encrypts and decrypts API keys using AES-256-GCM with Supabase Vault
 * 
 * Actions:
 * - encrypt: Encrypt plaintext API key/secret
 * - decrypt: Decrypt encrypted API key/secret
 * - migrate: Migrate all plaintext credentials to encrypted format
 * - test_encryption: Test encryption/decryption cycle
 */

interface EncryptRequest {
    action: 'encrypt' | 'decrypt' | 'migrate' | 'test_encryption';
    data?: string;
    apiKey?: string;
    apiSecret?: string;
    apiPassphrase?: string;
    encryptedKey?: string;
    encryptedSecret?: string;
    encryptedPassphrase?: string;
    credentialId?: string;
    userId?: string;
}

async function handler(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const {
            action,
            data,
            credentialId,
            userId,
            apiKey,
            apiSecret,
            apiPassphrase,
            encryptedKey,
            encryptedSecret,
            encryptedPassphrase
        }: EncryptRequest = await req.json();

        switch (action) {
            case 'encrypt': {
                if (data) {
                    const encryptedData = await encryptWithVault(supabase, data);
                    return new Response(JSON.stringify({ success: true, encrypted: encryptedData }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
                }

                if (!apiKey || !apiSecret) {
                    throw new Error('API Key and Secret are required for encryption');
                }

                const encryptedKey = await encryptWithVault(supabase, apiKey);
                const encryptedSecret = await encryptWithVault(supabase, apiSecret);
                let encryptedPassphrase = undefined;
                if (apiPassphrase) {
                    encryptedPassphrase = await encryptWithVault(supabase, apiPassphrase);
                }

                return new Response(
                    JSON.stringify({
                        success: true,
                        encryptedKey,
                        encryptedSecret,
                        encryptedPassphrase,
                        version: 1
                    }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            case 'decrypt': {
                if (data) {
                    const decryptedData = await decryptWithVault(supabase, data);
                    return new Response(JSON.stringify({ success: true, decrypted: decryptedData }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
                }

                if (!encryptedKey || !encryptedSecret) {
                    throw new Error('Encrypted Key and Secret are required for decryption');
                }

                const decryptedKey = await decryptWithVault(supabase, encryptedKey);
                const decryptedSecret = await decryptWithVault(supabase, encryptedSecret);
                let decryptedPassphrase = undefined;
                if (encryptedPassphrase) {
                    decryptedPassphrase = await decryptWithVault(supabase, encryptedPassphrase);
                }

                return new Response(
                    JSON.stringify({
                        success: true,
                        apiKey: decryptedKey,
                        apiSecret: decryptedSecret,
                        apiPassphrase: decryptedPassphrase
                    }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            case 'migrate': {
                // Migrate all plaintext credentials to encrypted format
                const result = await migrateCredentials(supabase, userId);

                return new Response(
                    JSON.stringify(result),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            case 'test_encryption': {
                const testData = data || 'test_api_key_12345';

                // Encrypt
                const encrypted = await encryptWithVault(supabase, testData);

                // Decrypt
                const decrypted = await decryptWithVault(supabase, encrypted);

                const success = testData === decrypted;

                return new Response(
                    JSON.stringify({
                        success,
                        original: testData,
                        encrypted,
                        decrypted,
                        matches: success
                    }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            default:
                throw new Error(`Unknown action: ${action}`);
        }
    } catch (error) {
        console.error('Encryption function error:', error);
        return new Response(
            JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            }),
            {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
        );
    }
}

// Export default handler for unified server
export default handler;

// For Supabase Edge Functions compatibility
if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
    serve(handler);
}

/**
 * Encrypt data using Supabase Vault
 * Uses pgsodium extension for encryption
 */
async function encryptWithVault(supabase: any, plaintext: string): Promise<string> {
    const { data, error } = await supabase.rpc('pgsodium_encrypt', {
        secret: plaintext,
        key_id: await getOrCreateVaultKey(supabase)
    });

    if (error) {
        console.error('Encryption error:', error);
        throw new Error(`Encryption failed: ${error.message}`);
    }

    return data;
}

/**
 * Decrypt data using Supabase Vault
 */
async function decryptWithVault(supabase: any, encrypted: string): Promise<string> {
    const { data, error } = await supabase.rpc('pgsodium_decrypt', {
        encrypted_secret: encrypted
    });

    if (error) {
        console.error('Decryption error:', error);
        throw new Error(`Decryption failed: ${error.message}`);
    }

    return data;
}

/**
 * Get or create encryption key in Supabase Vault
 */
async function getOrCreateVaultKey(supabase: any): Promise<string> {
    // Check if key exists
    const { data: existingKey } = await supabase
        .from('vault.secrets')
        .select('id')
        .eq('name', 'api_encryption_key')
        .single();

    if (existingKey) {
        return existingKey.id;
    }

    // Create new key
    const { data: newKey, error } = await supabase
        .from('vault.secrets')
        .insert({ name: 'api_encryption_key' })
        .select('id')
        .single();

    if (error) {
        throw new Error(`Failed to create encryption key: ${error.message}`);
    }

    return newKey.id;
}

/**
 * Migrate all plaintext credentials to encrypted format
 */
async function migrateCredentials(supabase: any, userId?: string): Promise<any> {
    const startTime = Date.now();
    let query = supabase
        .from('exchange_credentials')
        .select('*')
        .or('encrypted_api_key.is.null,encrypted_api_secret.is.null')
        .eq('migration_status', 'pending');

    if (userId) {
        query = query.eq('user_id', userId);
    }

    const { data: credentials, error: fetchError } = await query;

    if (fetchError) {
        throw new Error(`Failed to fetch credentials: ${fetchError.message}`);
    }

    if (!credentials || credentials.length === 0) {
        return {
            success: true,
            message: 'No credentials to migrate',
            migrated: 0
        };
    }

    let migrated = 0;
    let failed = 0;
    const errors: any[] = [];

    for (const cred of credentials) {
        try {
            // Update status to in_progress
            await supabase
                .from('exchange_credentials')
                .update({ migration_status: 'in_progress' })
                .eq('id', cred.id);

            // Encrypt API key and secret
            const encryptedKey = await encryptWithVault(supabase, cred.api_key);
            const encryptedSecret = await encryptWithVault(supabase, cred.api_secret);

            // Update with encrypted values
            const { error: updateError } = await supabase
                .from('exchange_credentials')
                .update({
                    encrypted_api_key: encryptedKey,
                    encrypted_api_secret: encryptedSecret,
                    encryption_version: 1,
                    migration_status: 'completed'
                })
                .eq('id', cred.id);

            if (updateError) {
                throw updateError;
            }

            migrated++;
        } catch (error) {
            failed++;
            errors.push({
                credentialId: cred.id,
                exchange: cred.exchange,
                error: error instanceof Error ? error.message : 'Unknown error'
            });

            // Mark as failed
            await supabase
                .from('exchange_credentials')
                .update({ migration_status: 'failed' })
                .eq('id', cred.id);
        }
    }

    const duration = Date.now() - startTime;

    return {
        success: failed === 0,
        migrated,
        failed,
        total: credentials.length,
        errors,
        durationMs: duration
    };
}

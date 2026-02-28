import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface EncryptRequest {
    action: 'encrypt' | 'decrypt' | 'migrate' | 'test_encryption' | 'rotate_keys';
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
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        // --- Authentication: require a valid JWT for all actions ---
        const authHeader = req.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return new Response(
                JSON.stringify({ success: false, error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const token = authHeader.replace('Bearer ', '');
        const isServiceRole = token === supabaseServiceKey;

        // For non-service-role callers, verify the JWT via getClaims
        let userId: string | null = null;
        if (!isServiceRole) {
            const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
                global: { headers: { Authorization: authHeader } }
            });
            const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
            if (claimsError || !claimsData?.claims) {
                return new Response(
                    JSON.stringify({ success: false, error: 'Invalid authentication' }),
                    { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }
            userId = claimsData.claims.sub as string;
        }

        // Service-role client for DB operations
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const body: EncryptRequest = await req.json();
        const { action } = body;

        // --- Authorization: sensitive actions require service role ---
        const sensitiveActions = ['rotate_keys', 'migrate', 'test_encryption'];
        if (sensitiveActions.includes(action) && !isServiceRole) {
            return new Response(
                JSON.stringify({ success: false, error: 'Forbidden: service role required' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        switch (action) {
            case 'encrypt': {
                const { data, apiKey, apiSecret, apiPassphrase } = body;
                if (data) {
                    const encryptedData = await encryptWithVault(supabase, data);
                    return jsonResponse({ success: true, encrypted: encryptedData });
                }

                if (!apiKey || !apiSecret) {
                    throw new Error('API Key and Secret are required for encryption');
                }

                const ek = await encryptWithVault(supabase, apiKey);
                const es = await encryptWithVault(supabase, apiSecret);
                let ep: string | undefined;
                if (apiPassphrase) {
                    ep = await encryptWithVault(supabase, apiPassphrase);
                }

                return jsonResponse({ success: true, encryptedKey: ek, encryptedSecret: es, encryptedPassphrase: ep, version: 1 });
            }

            case 'decrypt': {
                const { data, encryptedKey, encryptedSecret, encryptedPassphrase } = body;

                // For user callers, scope decrypt to their own credentials only
                if (!isServiceRole && body.credentialId) {
                    const { data: cred } = await supabase
                        .from('exchange_credentials')
                        .select('user_id')
                        .eq('id', body.credentialId)
                        .single();
                    if (!cred || cred.user_id !== userId) {
                        return new Response(
                            JSON.stringify({ success: false, error: 'Forbidden: not your credential' }),
                            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                        );
                    }
                }

                if (data) {
                    const decryptedData = await decryptWithVault(supabase, data);
                    return jsonResponse({ success: true, decrypted: decryptedData });
                }

                if (!encryptedKey || !encryptedSecret) {
                    throw new Error('Encrypted Key and Secret are required for decryption');
                }

                const dk = await decryptWithVault(supabase, encryptedKey);
                const ds = await decryptWithVault(supabase, encryptedSecret);
                let dp: string | undefined;
                if (encryptedPassphrase) {
                    dp = await decryptWithVault(supabase, encryptedPassphrase);
                }

                return jsonResponse({ success: true, apiKey: dk, apiSecret: ds, apiPassphrase: dp });
            }

            case 'migrate': {
                const result = await migrateCredentials(supabase, body.userId);
                return jsonResponse(result);
            }

            case 'test_encryption': {
                const testData = body.data || 'test_api_key_12345';
                const encrypted = await encryptWithVault(supabase, testData);
                const decrypted = await decryptWithVault(supabase, encrypted);
                const success = testData === decrypted;
                return jsonResponse({ success, matches: success });
            }

            case 'rotate_keys': {
                const result = await rotateEncryptionKeys(supabase);
                return jsonResponse(result);
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
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
}

function jsonResponse(data: any, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
}

export default handler;

// For Supabase Edge Functions compatibility (commented out for unified server)
// if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
//     serve(handler);
// }

async function encryptWithVault(supabase: any, plaintext: string): Promise<string> {
    const { data, error } = await supabase.rpc('pgsodium_encrypt', {
        secret: plaintext,
        key_id: await getOrCreateVaultKey(supabase)
    });
    if (error) throw new Error(`Encryption failed: ${error.message}`);
    return data;
}

async function decryptWithVault(supabase: any, encrypted: string): Promise<string> {
    const { data, error } = await supabase.rpc('pgsodium_decrypt', {
        encrypted_secret: encrypted
    });
    if (error) throw new Error(`Decryption failed: ${error.message}`);
    return data;
}

async function getOrCreateVaultKey(supabase: any): Promise<string> {
    const { data: existingKey } = await supabase
        .from('vault.secrets')
        .select('id')
        .eq('name', 'api_encryption_key')
        .single();

    if (existingKey) return existingKey.id;

    const { data: newKey, error } = await supabase
        .from('vault.secrets')
        .insert({ name: 'api_encryption_key' })
        .select('id')
        .single();

    if (error) throw new Error(`Failed to create encryption key: ${error.message}`);
    return newKey.id;
}

async function migrateCredentials(supabase: any, userId?: string): Promise<any> {
    const startTime = Date.now();
    let query = supabase
        .from('exchange_credentials')
        .select('*')
        .or('encrypted_api_key.is.null,encrypted_api_secret.is.null')
        .eq('migration_status', 'pending');

    if (userId) query = query.eq('user_id', userId);

    const { data: credentials, error: fetchError } = await query;
    if (fetchError) throw new Error(`Failed to fetch credentials: ${fetchError.message}`);

    if (!credentials || credentials.length === 0) {
        return { success: true, message: 'No credentials to migrate', migrated: 0 };
    }

    let migrated = 0, failed = 0;
    const errors: any[] = [];

    for (const cred of credentials) {
        try {
            await supabase.from('exchange_credentials').update({ migration_status: 'in_progress' }).eq('id', cred.id);
            const encryptedKey = await encryptWithVault(supabase, cred.api_key);
            const encryptedSecret = await encryptWithVault(supabase, cred.api_secret);
            const { error: updateError } = await supabase.from('exchange_credentials').update({
                encrypted_api_key: encryptedKey,
                encrypted_api_secret: encryptedSecret,
                encryption_version: 1,
                migration_status: 'completed'
            }).eq('id', cred.id);
            if (updateError) throw updateError;
            migrated++;
        } catch (error) {
            failed++;
            errors.push({ credentialId: cred.id, exchange: cred.exchange, error: error instanceof Error ? error.message : 'Unknown error' });
            await supabase.from('exchange_credentials').update({ migration_status: 'failed' }).eq('id', cred.id);
        }
    }

    return { success: failed === 0, migrated, failed, total: credentials.length, errors, durationMs: Date.now() - startTime };
}

async function rotateEncryptionKeys(supabase: any): Promise<any> {
    const startTime = Date.now();
    const { data: credentials, error: fetchError } = await supabase
        .from('exchange_credentials')
        .select('*')
        .not('encrypted_api_key', 'is', null);

    if (fetchError) throw new Error(`Failed to fetch credentials: ${fetchError.message}`);
    if (!credentials || credentials.length === 0) return { success: true, message: 'No credentials to rotate', rotated: 0 };

    let rotated = 0, failed = 0;
    const errors: any[] = [];
    const newVersion = 2;

    for (const cred of credentials) {
        try {
            const dk = await decryptWithVault(supabase, cred.encrypted_api_key);
            const ds = await decryptWithVault(supabase, cred.encrypted_api_secret);
            let dp: string | undefined;
            if (cred.encrypted_api_passphrase) dp = await decryptWithVault(supabase, cred.encrypted_api_passphrase);

            const nek = await encryptWithVault(supabase, dk);
            const nes = await encryptWithVault(supabase, ds);
            let nep: string | undefined;
            if (dp) nep = await encryptWithVault(supabase, dp);

            const { error: updateError } = await supabase.from('exchange_credentials').update({
                encrypted_api_key: nek,
                encrypted_api_secret: nes,
                encrypted_api_passphrase: nep || null,
                encryption_version: newVersion,
                updated_at: new Date().toISOString(),
            }).eq('id', cred.id);

            if (updateError) throw updateError;
            rotated++;
        } catch (error) {
            failed++;
            errors.push({ credentialId: cred.id, exchange: cred.exchange, error: error instanceof Error ? error.message : 'Unknown error' });
        }
    }

    return { success: failed === 0, rotated, failed, total: credentials.length, newVersion, errors, durationMs: Date.now() - startTime };
}
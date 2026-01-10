
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { RequestVerifier } from './RequestVerifier';

// Import edge function routes
import arbitrageScannerRouter from './routes/arbitrage-scanner';
import executeTradeRouter from './routes/execute-trade';
import scheduledArbScanRouter from './routes/scheduled-arb-scan';
import autoTradeSchedulerRouter from './routes/auto-trade-scheduler';
import binanceWebsocketRouter from './routes/binance-websocket';
import fetchExchangeBalancesRouter from './routes/fetch-exchange-balances';
import rateLimiterRouter from './routes/rate-limiter';
import validateApiKeysRouter from './routes/validate-api-keys';

// In CommonJS (default for this config), __dirname is available globally.
// In ESM, we would need fileURLToPath. Let's stick to CJS for simplicity in this service.

// Load environment variables
const envPath = path.resolve(__dirname, '../../../.env');
console.log(`[API Init] CWD: ${process.cwd()}`);
console.log(`[API Init] __dirname: ${__dirname}`);
console.log(`[API Init] Attempting to load .env from: ${envPath}`);

const result = dotenv.config({ path: envPath });
if (result.error) {
    console.warn(`[API Init] Failed to load .env from ${envPath}:`, result.error.message);
    // Try fallback to current directory
    const fallbackPath = path.resolve(process.cwd(), '.env');
    console.log(`[API Init] Falling back to: ${fallbackPath}`);
    dotenv.config({ path: fallbackPath });
}

const app = express();
const port = process.env.API_PORT || 3001;

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

console.log(`[API Init] Supabase URL: ${supabaseUrl}`);
console.log(`[API Init] Service Key found? ${!!supabaseServiceKey} (Length: ${supabaseServiceKey.length})`);
if (supabaseServiceKey) {
    console.log(`[API Init] Service Key starts with: ${supabaseServiceKey.substring(0, 10)}...`);
}

if (!supabaseUrl || !supabaseServiceKey || supabaseServiceKey.includes('insert_your')) {
    console.warn('CRITICAL: SUPABASE_URL or valid SUPABASE_SERVICE_ROLE_KEY missing in .env');
}

// Only attempt to create client if we have a real-looking key
const supabase = (supabaseUrl && supabaseServiceKey && !supabaseServiceKey.includes('insert_your'))
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

// Store supabase client in app for use in routes
app.set('supabase', supabase);

// API Secret for HMAC
const apiSecret = process.env.API_CONTROL_SECRET || 'dev-secret-key';
const verifier = new RequestVerifier(apiSecret);

app.use(cors());
app.use(bodyParser.json());

// Middleware to log requests
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} [API] ${req.method} ${req.url}`);
    next();
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Register edge function routes
app.use(arbitrageScannerRouter);
app.use(executeTradeRouter);
app.use(scheduledArbScanRouter);
app.use(autoTradeSchedulerRouter);
app.use(binanceWebsocketRouter);
app.use(fetchExchangeBalancesRouter);
app.use(rateLimiterRouter);
app.use(validateApiKeysRouter);

/**
 * Clear User Data Endpoint (VPS Implementation)
 */
app.post('/functions/clear-user-data', async (req, res) => {
    try {
        const signature = (req.headers['x-signature'] as string) || '';
        const timestamp = (req.headers['x-timestamp'] as string) || '';
        const nonce = (req.headers['x-nonce'] as string) || '';
        const authToken = (req.headers['authorization'] || '').replace('Bearer ', '');

        if (!supabase) {
            return res.status(500).json({ error: 'VPS API is running but SUPABASE_SERVICE_ROLE_KEY is not configured.' });
        }

        // 1. Verify Signature (Security Phase 9.2)
        const payload = JSON.stringify(req.body);
        const isVerified = verifier.verify(payload, signature, timestamp, nonce);

        if (!isVerified && process.env.NODE_ENV === 'production') {
            return res.status(401).json({
                error: 'Invalid HMAC signature',
                hint: 'Check VITE_API_CONTROL_SECRET matches API_CONTROL_SECRET'
            });
        }

        // 2. Verify Auth Token (Supabase Session)
        const { data: { user }, error: authError } = await supabase.auth.getUser(authToken);
        if (authError || !user) {
            console.error('Auth verification failed:', authError);
            return res.status(401).json({ error: 'Unauthorized: Invalid token' });
        }

        const { action, daysOld = 30 } = req.body;
        console.log(`Action: ${action}, DaysOld: ${daysOld} for user: ${user.id}`);

        let totalDeleted = 0;
        let details: any = { opportunities: 0, scan_logs: 0 };

        if (action === 'clear_opportunities' || action === 'clear_all' || action === 'clear_opportunities_old') {
            // @ts-ignore - Supabase JS types can be tricky with chained delete/select
            let query: any = supabase.from('arbitrage_opportunities').delete().eq('user_id', user.id);

            if (action === 'clear_opportunities_old') {
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - parseInt(String(daysOld)));
                query = query.lt('detected_at', cutoff.toISOString());
            }

            const { count, error } = await query.select('*');
            if (error) throw error;
            details.opportunities = count || 0;
            totalDeleted += details.opportunities;
        }

        if (action === 'clear_scan_logs' || action === 'clear_all' || action === 'clear_scan_logs_old') {
            // @ts-ignore
            let query: any = supabase.from('scanner_logs').delete().eq('user_id', user.id);

            if (action === 'clear_scan_logs_old') {
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - parseInt(String(daysOld)));
                query = query.lt('created_at', cutoff.toISOString());
            }

            const { count, error } = await query.select('*');
            if (error) throw error;
            details.scan_logs = count || 0;
            totalDeleted += details.scan_logs;
        }

        res.json({
            success: true,
            action,
            deletedCount: totalDeleted,
            details,
            timestamp: new Date().toISOString()
        });

    } catch (err: any) {
        console.error('API Handler Error:', err);
        res.status(500).json({ error: err.message || 'Internal Server Error' });
    }
});

app.listen(port, () => {
    console.log(`API Service listening at http://localhost:${port}`);
    console.log(`CORS enabled for all origins`);
}).on('error', (err: any) => {
    console.error('Server error:', err);
    process.exit(1);
});

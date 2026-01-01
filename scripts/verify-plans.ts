
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.join(__dirname, '..', '.env');
let envContent = '';
try {
    envContent = fs.readFileSync(envPath, 'utf-8');
} catch (e) {
    console.error("Could not read .env");
    process.exit(1);
}

const env: Record<string, string> = {};
envContent.split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v) {
        let val = v.join('=').trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        env[k.trim()] = val;
    }
});

const SUPABASE_URL = env['VITE_SUPABASE_URL'] || env['SUPABASE_URL'];
const SUPABASE_ANON_KEY = env['VITE_SUPABASE_KEY'] || env['VITE_SUPABASE_ANON_KEY'];

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("Missing Supabase Anon Credentials in .env");
    process.exit(1);
}

console.log(`Verifying plans on ${SUPABASE_URL}...`);
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function verify() {
    const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('active', true);

    if (error) {
        console.error("Error fetching plans:", error.message);
    } else {
        console.log(`Found ${data?.length} active plans.`);
        if (data && data.length > 0) {
            console.log("Sample:", data[0].name);
        } else {
            console.warn("WARNING: No active plans found via Anon Key. RLS or Data missing.");
        }
    }
}

verify();

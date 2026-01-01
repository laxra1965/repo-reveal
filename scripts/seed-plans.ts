
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Fix __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Manually load env
const envPath = path.join(__dirname, '..', '.env');
let envContent = '';
try {
    envContent = fs.readFileSync(envPath, 'utf-8');
} catch (e) {
    console.error("Could not read .env at " + envPath);
    process.exit(1);
}

const env: Record<string, string> = {};
envContent.split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v) {
        let val = v.join('=').trim();
        // Remove quotes if present
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        env[k.trim()] = val;
    }
});

const SUPABASE_URL = env['VITE_SUPABASE_URL'] || env['SUPABASE_URL'];
const SUPABASE_SERVICE_KEY = env['SUPABASE_SERVICE_ROLE_KEY'];

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing Supabase Credentials in .env");
    process.exit(1);
}

console.log(`Connecting to ${SUPABASE_URL}...`);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const plans = [
    // Tier 1
    { name: "Tier 1: Scanner Only", duration_type: "weekly", price: 19.00, features: ["Real-time opportunities", "7 days history", "Basic filters"], active: true },
    { name: "Tier 1: Scanner Only", duration_type: "monthly", price: 60.00, features: ["Real-time opportunities", "7 days history", "Basic filters"], active: true },
    { name: "Tier 1: Scanner Only", duration_type: "quarterly", price: 150.00, features: ["Real-time opportunities", "7 days history", "Basic filters"], active: true },

    // Tier 2
    { name: "Tier 2: Trader Pro ($500 Max)", duration_type: "weekly", price: 195.00, features: ["Auto-trading", "$500 limit", "Basic analytics"], active: true },
    { name: "Tier 2: Trader Pro ($500 Max)", duration_type: "monthly", price: 600.00, features: ["Auto-trading", "$500 limit", "Basic analytics"], active: true },
    { name: "Tier 2: Trader Pro ($500 Max)", duration_type: "quarterly", price: 1500.00, features: ["Auto-trading", "$500 limit", "Basic analytics"], active: true },

    // Tier 3
    { name: "Tier 3: Trader Elite ($1,000 Max)", duration_type: "weekly", price: 395.00, features: ["$1000 limit", "Priority execution", "Advanced analytics"], active: true },
    { name: "Tier 3: Trader Elite ($1,000 Max)", duration_type: "monthly", price: 1200.00, features: ["$1000 limit", "Priority execution", "Advanced analytics"], active: true },
    { name: "Tier 3: Trader Elite ($1,000 Max)", duration_type: "quarterly", price: 3000.00, features: ["$1000 limit", "Priority execution", "Advanced analytics"], active: true },
];

async function seed() {
    console.log(`Seeding ${plans.length} plans...`);

    for (const p of plans) {
        // Check if exists
        const { data: existing } = await supabase
            .from('subscription_plans')
            .select('id')
            .eq('name', p.name)
            .eq('duration_type', p.duration_type)
            .maybeSingle();

        if (!existing) {
            const { error } = await supabase.from('subscription_plans').insert({
                name: p.name,
                duration_type: p.duration_type,
                price: p.price,
                features: JSON.stringify(p.features),
                active: p.active
            });
            if (error) console.error(`Failed to insert ${p.name} (${p.duration_type}):`, error.message);
            else console.log(`Inserted: ${p.name} (${p.duration_type})`);
        } else {
            console.log(`Exists: ${p.name} (${p.duration_type})`);
        }
    }
    console.log("Seeding Complete.");
}

seed();

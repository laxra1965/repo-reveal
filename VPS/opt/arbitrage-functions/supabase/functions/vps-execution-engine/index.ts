import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logInfo, logError, logDebug } from '../utils/logger.ts';
import { StandardOpportunity } from '../utils/opportunity-types.ts';

/**
 * VPS EXECUTION ENGINE (REAL TRADES - SAFE VERSION)
 * Handles the actual execution of arbitrage opportunities with strict safety rules.
 */

// --- SAFETY RULES (MANDATORY) ---
const MAX_TRADE_SIZE = parseFloat(Deno.env.get('MAX_TRADE_SIZE') || '50'); // USDT cap per trade
const MIN_PROFIT_THRESHOLD = parseFloat(Deno.env.get('MIN_PROFIT_THRESHOLD') || '0.4'); // 0.4% minimum profit
const ENABLE_TRADING = Deno.env.get('ENABLE_TRADING') === 'true'; // KILL SWITCH - Must be explicitly 'true'
const COOLDOWN_MS = parseInt(Deno.env.get('COOLDOWN_MS') || '3000'); // 3 second cooldown per path

// Mode control
const PAPER_TRADING_ONLY = Deno.env.get('PAPER_TRADING_ONLY') !== 'false'; // Defaults to true for safety
const TRADING_MODE = Deno.env.get('TRADING_MODE') || 'paper'; // 'paper' or 'real'

logInfo('execution-engine', `Initialization: ENABLE_TRADING=${ENABLE_TRADING}, MODE=${TRADING_MODE}, PAPER_ONLY=${PAPER_TRADING_ONLY}`);

// Track last trade time per path for cooldown
const pathCooldowns = new Map<string, number>();

// Execution Queue
const executionQueue: StandardOpportunity[] = [];

// Initialize Supabase Client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Enqueue an opportunity for execution
 */
export function enqueueExecution(opp: StandardOpportunity) {
    // 1. Kill Switch Check
    if (!ENABLE_TRADING) {
        logDebug('execution-engine', 'Trading disabled, logging opportunity only', { path: opp.path, profit: opp.profit_percent });
        return;
    }

    // 2. Min Profit Check
    if (opp.profit_percent < MIN_PROFIT_THRESHOLD) {
        logDebug('execution-engine', 'Profit below threshold', { path: opp.path, profit: opp.profit_percent, min: MIN_PROFIT_THRESHOLD });
        return;
    }

    // 3. Cooldown Check
    const pathKey = opp.path.join('->');
    const lastTradeTime = pathCooldowns.get(pathKey) || 0;
    if (Date.now() - lastTradeTime < COOLDOWN_MS) {
        logDebug('execution-engine', 'Cooldown active for path', { path: pathKey });
        return;
    }

    // 4. Slippage Guard (profit must cover estimated slippage + base threshold)
    const slippageGuard = 0.4 + (opp.estimated_slippage || 0);
    if (opp.profit_percent < slippageGuard) {
        logDebug('execution-engine', 'Profit too low for slippage guard', { path: opp.path, profit: opp.profit_percent, guard: slippageGuard });
        return;
    }

    executionQueue.push(opp);
    logInfo('execution-engine', 'Opportunity enqueued', { path: pathKey, profit: opp.profit_percent });
}

/**
 * Worker Loop - Process queue every 100ms
 */
setInterval(async () => {
    if (executionQueue.length === 0) return;

    const opp = executionQueue.shift();
    if (opp) {
        await executeOpportunity(opp);
    }
}, 100);

/**
 * Core Execution Logic
 */
async function executeOpportunity(opp: StandardOpportunity) {
    const pathKey = opp.path.join('->');
    try {
        logInfo('execution-engine', `Starting execution for ${pathKey}`, { profit: opp.profit_percent });

        // Update cooldown immediately
        pathCooldowns.set(pathKey, Date.now());

        // 1. Fetch all users with auto-trade enabled
        const { data: users, error: userError } = await supabase
            .from('user_settings')
            .select('user_id, trade_amount, max_position_size')
            .eq('auto_trade', true);

        if (userError || !users || users.length === 0) {
            logDebug('execution-engine', 'No users with auto-trade enabled');
            return;
        }

        logInfo('execution-engine', `Found ${users.length} eligible users for execution`);

        // 2. Execute for each user
        for (const user of users) {
            try {
                // Determine trade size for this user
                const userTradeSize = user.trade_amount || 10;
                const tradeSize = Math.min(userTradeSize, user.max_position_size || MAX_TRADE_SIZE, MAX_TRADE_SIZE);

                // Determine if this should be a paper trade
                const isPaperTrade = PAPER_TRADING_ONLY || TRADING_MODE === 'paper';

                logDebug('execution-engine', `Executing for user ${user.user_id}`, { 
                    amount: tradeSize, 
                    mode: isPaperTrade ? 'PAPER' : 'REAL' 
                });

                const response = await fetch(`${supabaseUrl}/functions/v1/execute-trade`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${supabaseServiceKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'execute_vps_opportunity',
                        opportunity: { ...opp, user_id: user.user_id },
                        amount: tradeSize,
                        test_mode: isPaperTrade
                    })
                });

                const result = await response.json();

                if (result.success) {
                    logInfo('execution-engine', `✅ Trade completed for user ${user.user_id}: ${pathKey}`, { profit: result.actualProfit });
                } else {
                    logError('execution-engine', `❌ Trade failed for user ${user.user_id}: ${pathKey}`, { error: result.error });
                }
            } catch (userErr) {
                logError('execution-engine', `Error executing for user ${user.user_id}`, { error: String(userErr) });
            }
        }

    } catch (err) {
        logError('execution-engine', `Critical error in execution loop for ${pathKey}`, { error: String(err) });
    }
}

/**
 * Placeholder for manual start/stop if needed
 */
export function startEngine() {
    logInfo('execution-engine', 'Execution engine started (VPS mode)');
}

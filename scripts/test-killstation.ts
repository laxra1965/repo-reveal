
/**
 * KILL SWITCH TEST (Simulation)
 * Phase 11.1
 * 
 * Objectives:
 * 1. Verify that stopping the Executor does NOT stop the Scanner.
 * 2. Verify that stopping the Scanner does NOT stop the Market Data Engine.
 * 
 * Since we are running in a simulated environment (Node.js processes), we will:
 * 1. Start all 3 services as child processes.
 * 2. Send SIGTERM to Executor.
 * 3. Verify Scanner still logs output.
 * 4. Send SIGTERM to Scanner.
 * 5. Verify Market Data still logs output.
 */

import { spawn } from 'child_process';
import path from 'path';

function startService(name: string, scriptPath: string) {
    console.log(`Starting ${name}...`);
    const proc = spawn('npx', ['ts-node', scriptPath], {
        cwd: process.cwd(),
        shell: true,
        env: { ...process.env, PATH: process.env.PATH }
    });

    proc.stdout.on('data', (data) => {
        // Suppress verbose logs, just show aliveness
        // console.log(`[${name}] ${data.toString().trim()}`);
    });

    proc.stderr.on('data', (data) => {
        console.error(`[${name} ERR] ${data.toString().trim()}`);
    });

    return proc;
}

async function runKillSwitchTest() {
    console.log("=== STARTING PHASE 11.1 KILL SWITCH TEST ===");

    // Paths to service entry points
    const marketDataPath = path.join('services', 'market-data', 'src', 'index.ts');
    const scannerPath = path.join('services', 'scanner', 'src', 'index.ts');
    const executorPath = path.join('services', 'executor', 'src', 'index.ts');

    // 1. Start Services
    const marketData = startService('MarketData', marketDataPath);
    const scanner = startService('Scanner', scannerPath);
    const executor = startService('Executor', executorPath);

    // Allow them to warm up
    console.log("Waiting 5s for services to warm up...");
    await new Promise(r => setTimeout(r, 5000));

    // 2. Kill Executor
    console.log(">>> KILLING EXECUTOR <<<");
    executor.kill('SIGTERM');
    // Windows might need taskkill if spawned with shell: true, but node.kill usually works on the wrapper
    // For test robustness on Windows:
    // process.kill(executor.pid, 'SIGTERM'); 

    // Wait and observe Scanner
    console.log("Observing Scanner for 3s (Should remain active)...");
    let scannerActive = true;
    scanner.on('exit', () => scannerActive = false);

    await new Promise(r => setTimeout(r, 3000));

    if (!scannerActive) {
        console.error("FAIL: Scanner died when Executor was killed.");
        process.exit(1);
    } else {
        console.log("PASS: Scanner survived Executor death.");
    }

    // 3. Kill Scanner
    console.log(">>> KILLING SCANNER <<<");
    scanner.kill('SIGTERM');

    // Wait and observe Market Data
    console.log("Observing Market Data for 3s (Should remain active)...");
    let marketDataActive = true;
    marketData.on('exit', () => marketDataActive = false);

    await new Promise(r => setTimeout(r, 3000));

    if (!marketDataActive) {
        console.error("FAIL: Market Data died when Scanner was killed.");
        process.exit(1);
    } else {
        console.log("PASS: Market Data survived Scanner death.");
    }

    // Cleanup
    marketData.kill();
    console.log("=== KILL SWITCH TEST PASSED ===");
    process.exit(0);
}

runKillSwitchTest();

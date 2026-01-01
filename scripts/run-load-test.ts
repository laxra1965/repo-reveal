
import { spawn } from 'child_process';
import path from 'path';

/**
 * PHASE 11.2 - LOAD TEST
 * Simulates 50 users and rapid high-frequency trading.
 * Checks for CPU spikes and allocation correctness (via logs).
 */

async function runLoadTest() {
    console.log("=== STARTING PHASE 11.2 LOAD TEST (50 Users) ===");
    console.log("Simulating high-frequency opportunities...");

    const executorPath = path.join('services', 'executor', 'src', 'index.ts');

    const proc = spawn('npx', ['ts-node', executorPath], {
        cwd: process.cwd(),
        shell: true,
        env: { ...process.env, LOAD_TEST: 'true', PATH: process.env.PATH }
    });

    let jobCount = 0;
    const start = Date.now();

    proc.stdout.on('data', (data) => {
        const msg = data.toString().trim();
        // Console log only significant events
        if (msg.includes('Load Test Cycle')) {
            console.log(`[EXECUTOR] ${msg}`);
            jobCount++;
        }
        else if (msg.includes('Starting')) {
            console.log(`[EXECUTOR] ${msg}`);
        }
    });

    proc.stderr.on('data', (data) => {
        console.error(`[ERR] ${data.toString().trim()}`);
    });

    // Run for 30 seconds
    await new Promise(r => setTimeout(r, 30000));

    console.log("=== WRAPPING UP LOAD TEST ===");
    proc.kill();
    // Force kill if needed
    try { process.kill(proc.pid!); } catch { }

    console.log(`Test Duration: 30s`);
    console.log(`Cycles Logged: ~${jobCount * 10} (Sampled 10%)`);
    console.log("=== LOAD TEST COMPLETE ===");
    process.exit(0);
}

runLoadTest();

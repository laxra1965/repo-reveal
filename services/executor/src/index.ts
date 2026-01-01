
import { ExecutorService } from './ExecutorService';

if (
    process.env.RUNTIME !== 'vps' ||
    process.env.TRADING_ENABLED !== 'true'
) {
    throw new Error('Live trading disabled');
}

console.log('Executor Service Starting (Phase 2 - Multi-Exchange)...');

const executorService = new ExecutorService();
executorService.start().catch(console.error);

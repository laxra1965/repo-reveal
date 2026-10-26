export type LogLevel = 'info' | 'error' | 'warn' | 'debug';

function baseLog(level: LogLevel, module: string, message: string, meta?: Record<string, any>) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    ...(meta || {}),
  };
  console.log(JSON.stringify(entry));
}

export const logInfo = (module: string, message: string, meta?: Record<string, any>) =>
  baseLog('info', module, message, meta);
export const logError = (module: string, message: string, meta?: Record<string, any>) =>
  baseLog('error', module, message, meta);
export const logWarn = (module: string, message: string, meta?: Record<string, any>) =>
  baseLog('warn', module, message, meta);
export const logDebug = (module: string, message: string, meta?: Record<string, any>) =>
  baseLog('debug', module, message, meta);

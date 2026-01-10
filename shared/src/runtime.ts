export const NODE_ENV = process.env.NODE_ENV ?? "development";

export const TRADING_ENABLED =
  process.env.TRADING_ENABLED === "true";

/**
 * Absolute safety switch
 * If false  no orders may ever execute
 */
export const READ_ONLY = !TRADING_ENABLED;


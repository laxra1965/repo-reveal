// Exchange data fetching utilities using CCXT

import ccxt from 'https://esm.sh/ccxt@4.4.35';
import { EXCHANGE_CONFIG } from './config.ts';

// Type for ccxt module indexing
type CcxtModule = typeof ccxt & Record<string, any>;

/**
 * Get CCXT exchange instance
 * @param exchangeName - Exchange name (binance, bybit, etc.)
 * @returns CCXT exchange instance or null if not supported
 */
export function getExchangeInstance(exchangeName: string) {
  const exchangeId = exchangeName.toLowerCase();
  const ccxtMod = ccxt as CcxtModule;
  if (!ccxtMod[exchangeId]) return null;
  return new ccxtMod[exchangeId]({
    enableRateLimit: true,
    timeout: EXCHANGE_CONFIG.timeout,
    options: { 'defaultType': EXCHANGE_CONFIG.defaultType }
  });
}

/**
 * Fetch exchange data using CCXT
 * @param exchangeName - Exchange name
 * @returns Price map with symbol data
 */
export async function fetchExchangeData(exchangeName: string): Promise<any> {
  throw new Error("REST price fetching is removed. Use WS Order Books.");
}

export async function fetchAllExchangeData(enabledExchanges: string[]): Promise<Record<string, any>> {
  throw new Error("REST price fetching is removed. Use WS Order Books.");
}

export async function fetchTopMovers(): Promise<string[]> {
  return []; // REST removed
}

/**
 * Helper to standardize symbols across exchanges
 * @param symbol - Raw symbol string
 * @param exchange - Exchange name
 * @returns Standardized symbol or null if invalid
 */
export function standardizeSymbol(symbol: string, exchange: string): string | null {
  if (!symbol) return null;
  let cleanSymbol = symbol.toUpperCase().replace(/[-_/:]/g, ''); // Added colon for Perps
  if (cleanSymbol.length < 3) return null;
  return cleanSymbol;
}


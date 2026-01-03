import { publishBinanceMovers } from "./binance";
import { publishBybitMovers } from "./bybit";
import { publishOKXMovers } from "./okx";
import { publishKuCoinMovers } from "./kucoin";
import { publishGateMovers } from "./gate";
import { publishMEXCMovers } from "./mexc";

const MOVERS_INTERVAL_MS = 45000; // 45 seconds (between 30-60 as per PRD)

export function startMoversFetchers() {
  console.log("[Movers] Starting movers fetchers for all exchanges...");

  // Start Binance movers fetcher
  setInterval(() => {
    publishBinanceMovers().catch(console.error);
  }, MOVERS_INTERVAL_MS);
  publishBinanceMovers().catch(console.error); // Initial fetch

  // Start Bybit movers fetcher
  setInterval(() => {
    publishBybitMovers().catch(console.error);
  }, MOVERS_INTERVAL_MS);
  publishBybitMovers().catch(console.error); // Initial fetch

  // Start OKX movers fetcher
  setInterval(() => {
    publishOKXMovers().catch(console.error);
  }, MOVERS_INTERVAL_MS);
  publishOKXMovers().catch(console.error); // Initial fetch

  // Start KuCoin movers fetcher
  setInterval(() => {
    publishKuCoinMovers().catch(console.error);
  }, MOVERS_INTERVAL_MS);
  publishKuCoinMovers().catch(console.error); // Initial fetch

  // Start Gate movers fetcher
  setInterval(() => {
    publishGateMovers().catch(console.error);
  }, MOVERS_INTERVAL_MS);
  publishGateMovers().catch(console.error); // Initial fetch

  // Start MEXC movers fetcher
  setInterval(() => {
    publishMEXCMovers().catch(console.error);
  }, MOVERS_INTERVAL_MS);
  publishMEXCMovers().catch(console.error); // Initial fetch

  console.log("[Movers] All movers fetchers started");
}


import Redis from "ioredis";

const redis = new Redis();

const moversByExchange = new Map<string, Set<string>>();

const MAX_MOVERS_PER_EXCHANGE = 20; // Hard limit per PRD

let subscriptionInitialized = false;

export function initMoversSubscription() {
  // Idempotent: only initialize once
  if (subscriptionInitialized) {
    return;
  }

  redis.psubscribe("movers:*");

  redis.on("pmessage", (_, channel, message) => {
    try {
      const exchange = channel.split(":")[1];
      const payload = JSON.parse(message);

      // Combine gainers and losers, limit to MAX_MOVERS_PER_EXCHANGE
      const allAssets = [
        ...(payload.gainers || []),
        ...(payload.losers || [])
      ].slice(0, MAX_MOVERS_PER_EXCHANGE);

      const assets = new Set(allAssets);
      moversByExchange.set(exchange, assets);

      console.log(`[Movers] Updated ${exchange}: ${assets.size} priority assets`);
    } catch (error: any) {
      console.error(`[Movers] Error processing message:`, error.message);
    }
  });

  redis.on("error", (err) => {
    console.error("[Movers] Redis Sub Error", err);
  });

  subscriptionInitialized = true;
  console.log("[Movers] Subscription initialized for movers:*");
}

export function getPriorityAssets(exchange: string): string[] {
  return Array.from(moversByExchange.get(exchange) || []);
}


import axios from "axios";
import Redis from "ioredis";

const redis = new Redis();

export async function publishBinanceMovers() {
  try {
    const { data } = await axios.get(
      "https://api.binance.com/api/v3/ticker/24hr",
      { timeout: 5000 }
    );

    const sorted = data
      .filter((t: any) => t.symbol.endsWith("USDT"))
      .sort((a: any, b: any) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent));

    const gainers = sorted
      .filter((t: any) => Number(t.priceChangePercent) > 0)
      .slice(0, 10)
      .map((t: any) => t.symbol.replace("USDT", ""));

    const losers = sorted
      .filter((t: any) => Number(t.priceChangePercent) < 0)
      .slice(0, 10)
      .map((t: any) => t.symbol.replace("USDT", ""));

    await redis.publish(
      "movers:binance",
      JSON.stringify({
        timestamp: Date.now(),
        gainers,
        losers,
        source: "binance"
      })
    );

    console.log(`[Binance Movers] Published ${gainers.length} gainers, ${losers.length} losers`);
  } catch (error: any) {
    console.error(`[Binance Movers] Error:`, error.message);
  }
}


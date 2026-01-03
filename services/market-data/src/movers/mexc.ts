import axios from "axios";
import Redis from "ioredis";

const redis = new Redis();

export async function publishMEXCMovers() {
  try {
    const { data } = await axios.get(
      "https://api.mexc.com/api/v3/ticker/24hr",
      { timeout: 5000 }
    );

    if (!Array.isArray(data)) {
      throw new Error("Invalid MEXC response");
    }

    const sorted = data
      .filter((t: any) => t.symbol.endsWith("USDT"))
      .sort((a: any, b: any) => {
        const aChange = Math.abs(parseFloat(a.priceChangePercent || "0"));
        const bChange = Math.abs(parseFloat(b.priceChangePercent || "0"));
        return bChange - aChange;
      });

    const gainers = sorted
      .filter((t: any) => parseFloat(t.priceChangePercent || "0") > 0)
      .slice(0, 10)
      .map((t: any) => t.symbol.replace("USDT", ""));

    const losers = sorted
      .filter((t: any) => parseFloat(t.priceChangePercent || "0") < 0)
      .slice(0, 10)
      .map((t: any) => t.symbol.replace("USDT", ""));

    await redis.publish(
      "movers:mexc",
      JSON.stringify({
        timestamp: Date.now(),
        gainers,
        losers,
        source: "mexc"
      })
    );

    console.log(`[MEXC Movers] Published ${gainers.length} gainers, ${losers.length} losers`);
  } catch (error: any) {
    console.error(`[MEXC Movers] Error:`, error.message);
  }
}


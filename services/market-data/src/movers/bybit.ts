import axios from "axios";
import Redis from "ioredis";

const redis = new Redis();

export async function publishBybitMovers() {
  try {
    const { data } = await axios.get(
      "https://api.bybit.com/v5/market/tickers",
      { 
        params: { category: "spot" },
        timeout: 5000 
      }
    );

    if (!data.result?.list) {
      throw new Error("Invalid Bybit response");
    }

    const sorted = data.result.list
      .filter((t: any) => t.symbol.endsWith("USDT"))
      .sort((a: any, b: any) => {
        const aChange = Math.abs(parseFloat(a.price24hPcnt || "0"));
        const bChange = Math.abs(parseFloat(b.price24hPcnt || "0"));
        return bChange - aChange;
      });

    const gainers = sorted
      .filter((t: any) => parseFloat(t.price24hPcnt || "0") > 0)
      .slice(0, 10)
      .map((t: any) => t.symbol.replace("USDT", ""));

    const losers = sorted
      .filter((t: any) => parseFloat(t.price24hPcnt || "0") < 0)
      .slice(0, 10)
      .map((t: any) => t.symbol.replace("USDT", ""));

    await redis.publish(
      "movers:bybit",
      JSON.stringify({
        timestamp: Date.now(),
        gainers,
        losers,
        source: "bybit"
      })
    );

    console.log(`[Bybit Movers] Published ${gainers.length} gainers, ${losers.length} losers`);
  } catch (error: any) {
    console.error(`[Bybit Movers] Error:`, error.message);
  }
}


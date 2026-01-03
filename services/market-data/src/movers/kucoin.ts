import axios from "axios";
import Redis from "ioredis";

const redis = new Redis();

export async function publishKuCoinMovers() {
  try {
    const { data } = await axios.get(
      "https://api.kucoin.com/api/v1/market/allTickers",
      { timeout: 5000 }
    );

    if (!data.data?.ticker) {
      throw new Error("Invalid KuCoin response");
    }

    const sorted = data.data.ticker
      .filter((t: any) => t.symbol.endsWith("-USDT"))
      .sort((a: any, b: any) => {
        const aChange = Math.abs(parseFloat(a.changeRate || "0"));
        const bChange = Math.abs(parseFloat(b.changeRate || "0"));
        return bChange - aChange;
      });

    const gainers = sorted
      .filter((t: any) => parseFloat(t.changeRate || "0") > 0)
      .slice(0, 10)
      .map((t: any) => t.symbol.replace("-USDT", ""));

    const losers = sorted
      .filter((t: any) => parseFloat(t.changeRate || "0") < 0)
      .slice(0, 10)
      .map((t: any) => t.symbol.replace("-USDT", ""));

    await redis.publish(
      "movers:kucoin",
      JSON.stringify({
        timestamp: Date.now(),
        gainers,
        losers,
        source: "kucoin"
      })
    );

    console.log(`[KuCoin Movers] Published ${gainers.length} gainers, ${losers.length} losers`);
  } catch (error: any) {
    console.error(`[KuCoin Movers] Error:`, error.message);
  }
}


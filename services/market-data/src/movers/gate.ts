import axios from "axios";
import Redis from "ioredis";

const redis = new Redis();

export async function publishGateMovers() {
  try {
    const { data } = await axios.get(
      "https://api.gateio.ws/api/v4/spot/tickers",
      { timeout: 5000 }
    );

    if (!Array.isArray(data)) {
      throw new Error("Invalid Gate.io response");
    }

    const sorted = data
      .filter((t: any) => t.currency_pair.endsWith("_USDT"))
      .sort((a: any, b: any) => {
        const aChange = Math.abs(parseFloat(a.change_percentage || "0"));
        const bChange = Math.abs(parseFloat(b.change_percentage || "0"));
        return bChange - aChange;
      });

    const gainers = sorted
      .filter((t: any) => parseFloat(t.change_percentage || "0") > 0)
      .slice(0, 10)
      .map((t: any) => t.currency_pair.replace("_USDT", ""));

    const losers = sorted
      .filter((t: any) => parseFloat(t.change_percentage || "0") < 0)
      .slice(0, 10)
      .map((t: any) => t.currency_pair.replace("_USDT", ""));

    await redis.publish(
      "movers:gate",
      JSON.stringify({
        timestamp: Date.now(),
        gainers,
        losers,
        source: "gate"
      })
    );

    console.log(`[Gate Movers] Published ${gainers.length} gainers, ${losers.length} losers`);
  } catch (error: any) {
    console.error(`[Gate Movers] Error:`, error.message);
  }
}


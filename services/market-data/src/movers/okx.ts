import axios from "axios";
import Redis from "ioredis";

const redis = new Redis();

export async function publishOKXMovers() {
  try {
    const { data } = await axios.get(
      "https://www.okx.com/api/v5/market/tickers",
      { 
        params: { instType: "SPOT" },
        timeout: 5000 
      }
    );

    if (!data.data) {
      throw new Error("Invalid OKX response");
    }

    const sorted = data.data
      .filter((t: any) => t.instId.endsWith("-USDT"))
      .sort((a: any, b: any) => {
        const aChange = Math.abs(parseFloat(a.last || "0") - parseFloat(a.open24h || "0")) / parseFloat(a.open24h || "1");
        const bChange = Math.abs(parseFloat(b.last || "0") - parseFloat(b.open24h || "0")) / parseFloat(b.open24h || "1");
        return bChange - aChange;
      });

    const gainers = sorted
      .filter((t: any) => {
        const change = (parseFloat(t.last || "0") - parseFloat(t.open24h || "0")) / parseFloat(t.open24h || "1");
        return change > 0;
      })
      .slice(0, 10)
      .map((t: any) => t.instId.replace("-USDT", ""));

    const losers = sorted
      .filter((t: any) => {
        const change = (parseFloat(t.last || "0") - parseFloat(t.open24h || "0")) / parseFloat(t.open24h || "1");
        return change < 0;
      })
      .slice(0, 10)
      .map((t: any) => t.instId.replace("-USDT", ""));

    await redis.publish(
      "movers:okx",
      JSON.stringify({
        timestamp: Date.now(),
        gainers,
        losers,
        source: "okx"
      })
    );

    console.log(`[OKX Movers] Published ${gainers.length} gainers, ${losers.length} losers`);
  } catch (error: any) {
    console.error(`[OKX Movers] Error:`, error.message);
  }
}


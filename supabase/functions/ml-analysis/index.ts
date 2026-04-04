import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Verify admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    // Check admin
    const { data: adminData } = await supabase
      .from("admin_users")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!adminData) throw new Error("Admin access required");

    const { analysisType } = await req.json();

    // Fetch trading data
    const { data: opportunities } = await supabase
      .from("opportunities")
      .select("*")
      .order("detected_at", { ascending: false })
      .limit(500);

    const { data: trades } = await supabase
      .from("trade_history")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    const { data: mlFeatures } = await supabase
      .from("ml_features")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    // Build dataset summary for AI analysis
    const oppCount = opportunities?.length || 0;
    const tradeCount = trades?.length || 0;
    const completedTrades = trades?.filter((t: any) => t.status === "completed") || [];
    const failedTrades = trades?.filter((t: any) => t.status === "failed") || [];
    const successRate = tradeCount > 0 ? (completedTrades.length / tradeCount * 100).toFixed(1) : "0";
    const avgProfit = completedTrades.length > 0
      ? (completedTrades.reduce((s: number, t: any) => s + (t.actual_profit || 0), 0) / completedTrades.length).toFixed(4)
      : "0";
    
    // Strategy distribution
    const strategyDist: Record<string, number> = {};
    opportunities?.forEach((o: any) => {
      strategyDist[o.strategy] = (strategyDist[o.strategy] || 0) + 1;
    });

    // Profit distribution buckets
    const profitBuckets = { "<0.1%": 0, "0.1-0.5%": 0, "0.5-1%": 0, "1-2%": 0, ">2%": 0 };
    opportunities?.forEach((o: any) => {
      const p = o.profit_percent;
      if (p < 0.1) profitBuckets["<0.1%"]++;
      else if (p < 0.5) profitBuckets["0.1-0.5%"]++;
      else if (p < 1) profitBuckets["0.5-1%"]++;
      else if (p < 2) profitBuckets["1-2%"]++;
      else profitBuckets[">2%"]++;
    });

    // Exchange distribution
    const exchangeDist: Record<string, number> = {};
    opportunities?.forEach((o: any) => {
      [o.exchange1, o.exchange2, o.exchange3].filter(Boolean).forEach((e: string) => {
        exchangeDist[e] = (exchangeDist[e] || 0) + 1;
      });
    });

    // Time-based patterns
    const hourDist: Record<number, number> = {};
    opportunities?.forEach((o: any) => {
      const h = new Date(o.detected_at).getUTCHours();
      hourDist[h] = (hourDist[h] || 0) + 1;
    });

    // Slippage analysis
    const avgSlippage = oppCount > 0
      ? (opportunities!.reduce((s: number, o: any) => s + (o.estimated_slippage || 0), 0) / oppCount).toFixed(4)
      : "0";

    // Top paths
    const pathFreq: Record<string, { count: number; avgProfit: number }> = {};
    opportunities?.forEach((o: any) => {
      if (!pathFreq[o.path]) pathFreq[o.path] = { count: 0, avgProfit: 0 };
      pathFreq[o.path].count++;
      pathFreq[o.path].avgProfit += o.profit_percent;
    });
    Object.keys(pathFreq).forEach(k => {
      pathFreq[k].avgProfit = pathFreq[k].avgProfit / pathFreq[k].count;
    });
    const topPaths = Object.entries(pathFreq)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([path, data]) => ({ path, ...data }));

    const datasetSummary = {
      totalOpportunities: oppCount,
      totalTrades: tradeCount,
      completedTrades: completedTrades.length,
      failedTrades: failedTrades.length,
      successRate: `${successRate}%`,
      avgProfit,
      avgSlippage,
      strategyDistribution: strategyDist,
      profitDistribution: profitBuckets,
      exchangeDistribution: exchangeDist,
      hourlyDistribution: hourDist,
      topPaths,
      mlFeaturesCount: mlFeatures?.length || 0,
      sampleOpportunities: opportunities?.slice(0, 5),
      sampleTrades: trades?.slice(0, 5),
    };

    let systemPrompt = "";
    let userPrompt = "";

    if (analysisType === "pattern") {
      systemPrompt = "You are a quantitative trading analyst specializing in crypto arbitrage. Analyze the provided dataset and identify actionable patterns, correlations, and anomalies. Focus on: which strategies perform best, optimal trading hours, most profitable paths, exchange reliability, and risk factors. Provide specific data-backed recommendations.";
      userPrompt = `Analyze this arbitrage trading dataset and identify key patterns:\n\n${JSON.stringify(datasetSummary, null, 2)}`;
    } else if (analysisType === "risk") {
      systemPrompt = "You are a risk management specialist for crypto arbitrage trading. Analyze the dataset for risk factors including slippage, failure rates, strategy-specific risks, and time-based vulnerabilities. Provide a risk score (1-100) and actionable mitigation strategies.";
      userPrompt = `Perform a risk assessment on this trading dataset:\n\n${JSON.stringify(datasetSummary, null, 2)}`;
    } else if (analysisType === "optimization") {
      systemPrompt = "You are a trading strategy optimizer. Analyze the dataset and recommend specific filter/config changes to improve profitability. Suggest optimal min/max profit thresholds, best exchanges, ideal trading hours, and strategy weights. Be specific with numbers.";
      userPrompt = `Recommend optimization strategies based on this dataset:\n\n${JSON.stringify(datasetSummary, null, 2)}`;
    } else {
      systemPrompt = "You are a comprehensive trading data analyst. Provide a full overview including patterns, risks, and optimization suggestions for the arbitrage trading dataset.";
      userPrompt = `Provide a comprehensive ML analysis of this trading dataset:\n\n${JSON.stringify(datasetSummary, null, 2)}`;
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Settings > Workspace > Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const analysis = aiData.choices?.[0]?.message?.content || "No analysis generated.";

    return new Response(
      JSON.stringify({ analysis, datasetSummary, analysisType }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("ml-analysis error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

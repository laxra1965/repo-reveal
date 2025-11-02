// functions/scheduled-arb-scan/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const client = createClient(supabaseUrl, supabaseServiceKey);

const PROFIT_THRESHOLD = 1; // 1%

serve(async () => {
  console.log("Scheduled scan started...");

  // Call existing function
  const { data, error } = await client.functions.invoke("arbitrage-scanner", {
    body: { action: "scan" }
  });

  if (error) {
    console.error("scanner error", error);
    return new Response("Error", { status: 500 });
  }

  const results = data?.data || [];
  const profitable = results.filter((r: any) => r.profit_percent >= PROFIT_THRESHOLD);

  if (profitable.length === 0) {
    console.log("No profitable opportunities");
    return new Response("No opportunities");
  }

  // Insert into DB
  const formatted = profitable.map((r: any) => ({
    ...r,
    detected_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30000).toISOString(),
  }));

  const { error: insertError } = await client
    .from("arbitrage_opportunities")
    .insert(formatted);

  if (insertError) {
    console.error("DB insert error", insertError);
    return new Response("Insert failed");
  }

  console.log(`Inserted ${formatted.length} opportunities`);
  return new Response("Success");
});

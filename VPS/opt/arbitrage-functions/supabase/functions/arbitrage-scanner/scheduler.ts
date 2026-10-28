import scanner from './index.ts';
const seconds = Number(Deno.env.get('SCAN_INTERVAL_SECONDS') || 30);
if (!Number.isFinite(seconds) || seconds < 2) throw new Error('SCAN_INTERVAL_SECONDS must be at least 2');
let running = false;
async function tick() {
 if (running) return;
 running=true;
 try {
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!key)throw new Error('Missing Supabase service configuration');
  const response=await scanner(new Request('http://localhost/arbitrage',{method:'GET',headers:{Authorization:`Bearer ${key}`}}));
  console.log('[scanner] scan status',response.status);
 }catch{console.error('[scanner] scan failed');}finally{running=false;}
}
if(Deno.env.get('RUNTIME')==='vps'){void tick();setInterval(()=>void tick(),seconds*1000);}

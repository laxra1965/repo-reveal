import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {decryptValue,verifyKeys,type Keys} from './exchange-api.ts';
import {marketOrder} from './orders.ts';
import {validatePolicy} from './trading-policy.ts';
export function database() {
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!key)throw new Error('Missing VPS Supabase configuration');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function caller(req:Request) {
 const db=database(),token=req.headers.get('Authorization')?.replace(/^Bearer /,'');
 if(!token)throw new Error('Unauthorized');
 if(token===Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))return {db,userId:null,service:true};
 const {data,error}=await db.auth.getUser(token);
 if(error||!data.user)throw new Error('Unauthorized');
 return {db,userId:data.user.id,service:false};
}
export async function credentialKeys(c:any):Promise<Keys> {
 const secret=Deno.env.get('ENCRYPTION_KEY')||'';
 if(c.encrypted_api_key||c.encrypted_api_secret) {
  if(!c.encrypted_api_key||!c.encrypted_api_secret)throw new Error('Incomplete encrypted credentials');
  return {apiKey:await decryptValue(c.encrypted_api_key,secret),apiSecret:await decryptValue(c.encrypted_api_secret,secret),apiPassphrase:c.encrypted_api_passphrase?await decryptValue(c.encrypted_api_passphrase,secret):undefined};
 }
 if(!c.api_key||!c.api_secret||c.api_key.includes('...')||c.api_secret.includes('*'))throw new Error('Re-save credentials using VPS encryption');
 return {apiKey:c.api_key,apiSecret:c.api_secret};
}
export function liveEnabled(){return Deno.env.get('RUNTIME')==='vps'&&Deno.env.get('TRADING_ENABLED')==='true'&&Deno.env.get('EXECUTION_MODE')==='live'}
export async function executeTrade(tradeId:string,userId?:string|null) {
 const db=database();
 if(!liveEnabled())throw new Error('Live trading disabled on VPS');
 let query=db.from('trade_history').select('*').eq('id',tradeId);
 if(userId)query=query.eq('user_id',userId);
 const {data:t,error}=await query.maybeSingle();
 if(error||!t)throw new Error('Trade not found');
 if(t.status!=='pending')return {success:true,tradeId,status:t.status};
 const details=t.execution_details||{};
 if(details.mode!=='live'||details.is_paper_trade)throw new Error('Only explicitly live pending trades may execute');
 const [{data:o,error:oe},{data:s,error:se},{data:flags,error:fe},{data:sub,error:sue},{data:admin,error:ae}]=await Promise.all([
  db.from('opportunities').select('*').eq('id',t.opportunity_id).maybeSingle(),
  db.from('user_settings').select('*').eq('user_id',t.user_id).maybeSingle(),
  db.from('admin_settings').select('key,value').in('key',['real_money_approved','real_money_allowed_exchanges']),
  db.from('user_subscriptions').select('id').eq('user_id',t.user_id).eq('status','active').gt('end_date',new Date().toISOString()).limit(1),
  db.from('admin_users').select('id').eq('user_id',t.user_id).limit(1)
 ]);
 if(oe||se||fe||sue||ae||!o||!s)throw new Error('Cannot load trading configuration');
 if(!sub?.length&&!admin?.length)throw new Error('Active subscription required');
 if(details.queue_id&&!s.auto_trade)throw new Error('Auto trading disabled by user');
 const legs=validatePolicy(o,s,Object.fromEntries((flags||[]).map(r=>[r.key,r.value])),Number(t.start_amount));
 const {data:creds,error:ce}=await db.from('exchange_credentials').select('*').eq('user_id',t.user_id).eq('exchange',legs[0].exchange).maybeSingle();
 if(ce||!creds||creds.test_mode!==false)throw new Error('Live credentials required; turn off paper mode');
 const keys=await credentialKeys(creds),verified=await verifyKeys(legs[0].exchange,keys);
 await db.from('exchange_credentials').update({is_connected:verified.valid&&verified.canTrade}).eq('id',creds.id);
 if(!verified.valid||!verified.canTrade)throw new Error('Exchange trading permissions not verified from VPS');
 const {data:claim,error:claimError}=await db.from('trade_history').update({status:'executing',started_at:new Date().toISOString()}).eq('id',tradeId).eq('status','pending').select('id');
 if(claimError)throw claimError;if(!claim?.length)return {success:true,tradeId,status:'already_claimed'};
 const log:any[]=[];let amount=Number(t.start_amount);
 let submissionStarted=false;
 const persist=async()=>{
  const {error}=await db.from('trade_history').update({completed_steps:log.filter(l=>l.success).length,execution_details:{...details,mode:'live',route:'vps',log}}).eq('id',tradeId);
  if(error)throw new Error('Cannot persist execution evidence; reconcile before retry');
 };
 try {
  for(let i=0;i<legs.length;i++) {
   if(!liveEnabled())throw new Error('Live safety switch disabled');
   const clientId=tradeId.replace(/-/g,'').slice(0,26)+'L'+(i+1);
   const row={...legs[i],step:i+1,amountIn:amount,clientOrderId:clientId,at:new Date().toISOString(),status:'submitting'};
   log.push(row);await persist();submissionStarted=true;
   const fill=await marketOrder(legs[i].exchange,keys,legs[i].symbol,legs[i].side,amount,clientId);
   Object.assign(row,fill,{success:true,status:'filled',at:new Date().toISOString()});await persist();
   amount=fill.fillAmount;
  }
  // Third-asset commission is preserved, but cannot safely be priced in USDT without a conversion fill.
  const hasExternalFees=log.some(l=>l.fees?.some((f:any)=>f.amount>0&&f.asset!==l.fromAsset&&f.asset!==l.toAsset));
  const {error}=await db.from('trade_history').update({status:'completed',final_amount:amount,actual_profit:hasExternalFees?null:amount-Number(t.start_amount),completed_at:new Date().toISOString(),execution_details:{...details,mode:'live',route:'vps',log,profit_requires_fee_conversion:hasExternalFees}}).eq('id',tradeId);
  if(error)throw new Error('Final write failed; reconcile exchange orders');
  if(details.queue_id)await db.from('auto_trade_queue').update({status:'completed',completed_at:new Date().toISOString()}).eq('id',details.queue_id);
  return {success:true,tradeId,status:'completed'};
 } catch {
  const message=submissionStarted?'Execution interrupted; reconcile recorded client order IDs before retry.':'Execution stopped before submission';
  await db.from('trade_history').update({status:submissionStarted?'executing':'failed',error_message:message,execution_details:{...details,mode:'live',route:'vps',log,reconciliation_required:submissionStarted}}).eq('id',tradeId);
  if(details.queue_id)await db.from('auto_trade_queue').update({status:submissionStarted?'executing':'failed',error_message:message}).eq('id',details.queue_id);
  return {success:false,tradeId,status:submissionStarted?'executing':'failed',error:message};
 }
}
let busy=false;
export async function autoCycle() {
 if(busy||!liveEnabled())return {success:true,status:'disabled_or_busy'};
 busy=true;const db=database();let processed=0,failed=0;const started=new Date().toISOString();
 try {
  const {error:q}=await db.rpc('queue_auto_trades_for_users');if(q)throw q;
  const {error:p}=await db.rpc('process_pending_auto_trades');if(p)throw p;
  const {data,error}=await db.from('trade_history').select('id').eq('status','pending').eq('execution_details->>mode','live').order('created_at').limit(10);if(error)throw error;
  for(const t of data||[]) {try {const result=await executeTrade(t.id);if(result.status==='completed')processed++;if(!result.success)failed++;}catch {
   failed++;await db.from('trade_history').update({status:'failed',error_message:'VPS preflight rejected trade; check configuration, expiry and key verification',completed_at:new Date().toISOString()}).eq('id',t.id).eq('status','pending');
  }}
  await db.from('scheduler_runs').insert({source:'vps',started_at:started,finished_at:new Date().toISOString(),users_processed:0,inserts_attempted:0,successes:processed,failures:failed,details:{execution_mode:'live'}});
  return {success:true,processed,failed};
 }finally{busy=false}
}

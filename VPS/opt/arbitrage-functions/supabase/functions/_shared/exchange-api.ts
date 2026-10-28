export interface Keys { apiKey: string; apiSecret: string; apiPassphrase?: string }
export const exchanges = ['binance','bybit','okx','gate','mexc'];
const urls: Record<string,string> = {binance:'https://api.binance.com',bybit:'https://api.bybit.com',okx:'https://www.okx.com',gate:'https://api.gateio.ws',mexc:'https://api.mexc.com'};
const encoder = new TextEncoder();
const hex = (data: ArrayBuffer) => Array.from(new Uint8Array(data),x=>x.toString(16).padStart(2,'0')).join('');
export async function signedRequest(exchange: string, keys: Keys, method: string, path: string, params: Record<string,string> = {}, body?: unknown) {
 if (!exchanges.includes(exchange)) throw new Error('Unsupported exchange');
 const query = new URLSearchParams(params);
 const raw = body === undefined ? '' : JSON.stringify(body);
 const headers: Record<string,string> = {'Content-Type':'application/json'};
 async function sign(message: string, hash='SHA-256', base64=false) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(keys.apiSecret),{name:'HMAC',hash},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',key,encoder.encode(message));
  return base64 ? btoa(String.fromCharCode(...new Uint8Array(sig))) : hex(sig);
 }
 if(exchange==='binance'||exchange==='mexc') {
  query.set('timestamp',String(Date.now())); query.set('recvWindow','5000');
  query.set('signature',await sign(query.toString()));
  headers[exchange==='binance'?'X-MBX-APIKEY':'X-MEXC-APIKEY']=keys.apiKey;
 } else if(exchange==='bybit') {
  const t=String(Date.now());
  Object.assign(headers,{'X-BAPI-API-KEY':keys.apiKey,'X-BAPI-TIMESTAMP':t,'X-BAPI-RECV-WINDOW':'5000','X-BAPI-SIGN':await sign(t+keys.apiKey+'5000'+(method==='GET'?query.toString():raw))});
 } else if(exchange==='okx') {
  if(!keys.apiPassphrase) throw new Error('OKX passphrase required');
  const t=new Date().toISOString(); const suffix=query.size?'?'+query.toString():'';
  Object.assign(headers,{'OK-ACCESS-KEY':keys.apiKey,'OK-ACCESS-TIMESTAMP':t,'OK-ACCESS-PASSPHRASE':keys.apiPassphrase,'OK-ACCESS-SIGN':await sign(t+method+path+suffix+raw,'SHA-256',true)});
 } else {
  const t=String(Math.floor(Date.now()/1000));
  Object.assign(headers,{KEY:keys.apiKey,Timestamp:t,SIGN:await sign([method,path,query.toString(),hex(await crypto.subtle.digest('SHA-512',encoder.encode(raw))),t].join('\n'),'SHA-512')});
 }
 const response=await fetch(urls[exchange]+path+(query.size?'?'+query.toString():''),{method,headers,body:body===undefined?undefined:raw,signal:AbortSignal.timeout(10000)});
 const data=await response.json();
 if(!response.ok || (exchange==='bybit' && data.retCode!==0) || (exchange==='okx' && data.code!=='0') || data.label || (typeof data.code==='number' && data.code<0)) throw new Error(`Exchange rejected request (${exchange}, HTTP ${response.status})`);
 return data;
}
export async function verifyKeys(exchange: string, keys: Keys) {
 if(!exchanges.includes(exchange)) return {valid:false,canTrade:false,error:'Unsupported exchange'};
 try {
  if(exchange==='binance'||exchange==='mexc') {
   const data=await signedRequest(exchange,keys,'GET','/api/v3/account');
   return {valid:true,canTrade:data.canTrade===true,error:data.canTrade===true?undefined:'Spot trading permission not confirmed'};
  }
  if(exchange==='bybit') {
   const data=await signedRequest(exchange,keys,'GET','/v5/user/query-api');
   return {valid:true,canTrade:Number(data.result?.readOnly)===0 && data.result?.permissions?.Spot?.includes('SpotTrade')===true};
  }
  if(exchange==='okx') {
   const data=await signedRequest(exchange,keys,'GET','/api/v5/account/config');
   return {valid:true,canTrade:String(data.data?.[0]?.perm||'').split(',').includes('trade')};
  }
  const data=await signedRequest(exchange,keys,'GET','/api/v4/account/detail');
  const perms=data.permissions || data.key?.permissions || [];
  return {valid:true,canTrade:Array.isArray(perms)&&perms.some((p: any)=>p.name==='spot' && p.read_only===false),error:'Spot write permission must be confirmed by the exchange'};
 } catch {return {valid:false,canTrade:false,error:'Verification failed. Check key, secret, passphrase, permissions and VPS IP allowlist.'};}
}
export async function decryptValue(value: string, secret: string) {
 if(!secret) throw new Error('ENCRYPTION_KEY missing on VPS');
 const [iv,ct]=value.split(':'); if(!iv||!ct) throw new Error('Unsupported credential encryption. Re-save your keys.');
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret.substring(0,32).padEnd(32,'0')),{name:'AES-GCM'},false,['decrypt']);
 const bytes=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
 return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv)},key,bytes(ct)));
}

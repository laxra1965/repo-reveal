import {caller,credentialKeys} from '../_shared/trading-runtime.ts';
import {verifyKeys,exchanges} from '../_shared/exchange-api.ts';
export default async function handler(req:Request) {
 try {
  const auth=await caller(req);const body=await req.json();
  if(typeof body.exchange!=='string'||!exchanges.includes(body.exchange))return Response.json({valid:false,canTrade:false,error:'Unsupported exchange'},{status:400});
  let keys;
  if(body.credentialId){
   let query=auth.db.from('exchange_credentials').select('*').eq('id',body.credentialId).eq('exchange',body.exchange);
   if(!auth.service)query=query.eq('user_id',auth.userId);
   const {data,error}=await query.maybeSingle();if(error||!data)return Response.json({error:'Credential not found'},{status:404});
   keys=await credentialKeys(data);
  } else {
   if(typeof body.apiKey!=='string'||typeof body.apiSecret!=='string'||!body.apiKey||!body.apiSecret||body.apiKey.length>4096||body.apiSecret.length>4096)return Response.json({error:'Key and secret required'},{status:400});
   keys={apiKey:body.apiKey,apiSecret:body.apiSecret,apiPassphrase:typeof body.apiPassphrase==='string'?body.apiPassphrase:undefined};
  }
  const result=await verifyKeys(body.exchange,keys);
  if(body.credentialId)await auth.db.from('exchange_credentials').update({is_connected:result.valid&&result.canTrade}).eq('id',body.credentialId);
  return Response.json(result);
 }catch{return Response.json({valid:false,canTrade:false,error:'Authentication or encrypted credential verification failed'},{status:401});}
}

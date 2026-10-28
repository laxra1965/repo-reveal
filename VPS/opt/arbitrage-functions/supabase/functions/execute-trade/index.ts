import {caller,executeTrade} from '../_shared/trading-runtime.ts';
export default async function handler(req:Request) {
 try {
  const auth=await caller(req);const body=await req.json();
  if(body.action!=='execute_single'||typeof body.tradeId!=='string'||! /^[0-9a-f-]{36}$/i.test(body.tradeId))return Response.json({error:'Valid execute_single tradeId required'},{status:400});
  return Response.json(await executeTrade(body.tradeId,auth.userId));
 }catch(e){const message=e instanceof Error?e.message:'Execution failed';return Response.json({success:false,error:message},{status:message==='Unauthorized'?401:400});}
}

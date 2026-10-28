import {caller,autoCycle} from '../_shared/trading-runtime.ts';
export default async function handler(req:Request) {
 try {
  const auth=await caller(req);
  if(!auth.service){const {data,error}=await auth.db.from('admin_users').select('id').eq('user_id',auth.userId).maybeSingle();if(error||!data)return Response.json({error:'Admin required'},{status:403});}
  return Response.json(await autoCycle());
 }catch{return Response.json({error:'Scheduler request failed'},{status:401});}
}

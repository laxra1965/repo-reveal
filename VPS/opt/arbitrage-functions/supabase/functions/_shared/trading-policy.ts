export function prepareLegs(o:any) {
 const path=String(o.path||'').split(/\s*(?:→|->|>)\s*/).filter(Boolean);
 const pairs=[o.pair1,o.pair2,o.pair3];
 const exchange=String(o.exchange1||'').toLowerCase();
 if(!['triangular','triangular_arbitrage'].includes(String(o.strategy)) || path[0]!=='USDT' || path.length!==4 || path[3]!=='USDT')throw new Error('Only closed USDT triangular routes supported');
 if([o.exchange2,o.exchange3].some(e=>String(e||exchange).toLowerCase()!==exchange))throw new Error('Cross-exchange transfers are not supported for automatic execution');
 return pairs.map((p,i)=>{
  const [base,quote]=String(p||'').split('/');
  if(!base||!quote)throw new Error('Pairs must use BASE/QUOTE format');
  const side=path[i]===quote?'BUY':path[i]===base?'SELL':null;
  if(!side || path[i+1] !== (side==='BUY'?base:quote))throw new Error('Pair does not match trade path');
  return {exchange,symbol:p,side:side as 'BUY'|'SELL',fromAsset:path[i],toAsset:path[i+1]};
 });
}
export function validatePolicy(o:any,s:any,flags:Record<string,string>,amount:number,now=Date.now()) {
 const legs=prepareLegs(o);
 const age=now-Date.parse(o.detected_at);
 if(o.status!=='active'||!Number.isFinite(age)||age< -5000||age>60000)throw new Error('Opportunity expired');
 if(flags.real_money_approved!=='true')throw new Error('Admin has not approved live trading');
 let allowed:string[]=[];try{allowed=JSON.parse(flags.real_money_allowed_exchanges||'[]')}catch{}
 if(!Array.isArray(allowed)||legs.some(l=>!allowed.includes(l.exchange)||!s.enabled_exchanges?.includes(l.exchange)))throw new Error('Exchange not enabled by admin and user');
 if(!Number.isFinite(amount)||amount<1||amount>Number(s.trade_amount)||amount>Number(s.max_position_size)||amount>Number(o.volume_estimate))throw new Error('Trade exceeds saved amount, position limit or liquidity');
 const gross=Number(o.profit_percent),slippage=Number(o.estimated_slippage);
 if(!Number.isFinite(gross)||!Number.isFinite(slippage)||gross-0.3-slippage*100<=0)throw new Error('Profit does not cover fees and slippage');
 if(s.min_profit_percent!=null&&gross<Number(s.min_profit_percent)||s.max_profit_percent!=null&&gross>Number(s.max_profit_percent)||s.slippage_buffer!=null&&slippage>Number(s.slippage_buffer))throw new Error('Opportunity outside user filters');
 const normalize=(v:string)=>v.toLowerCase().replace(/[-_]arbitrage$/,'').replace(/-/g,'_');
 if(s.arbitrage_types?.length&&!s.arbitrage_types.some((v:string)=>normalize(v)===normalize(o.strategy)))throw new Error('Strategy not enabled');
 return legs;
}

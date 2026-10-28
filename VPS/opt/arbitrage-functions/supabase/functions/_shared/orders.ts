import {signedRequest,type Keys} from './exchange-api.ts';
export interface Fill {orderId:string; fillPrice:number; fillAmount:number; fee:number; feeAsset:string; fees?:{asset:string;amount:number}[]}
export function assertFill(fill: Fill) {
 if(!fill.orderId || !Number.isFinite(fill.fillPrice)||fill.fillPrice<=0||!Number.isFinite(fill.fillAmount)||fill.fillAmount<=0||!Number.isFinite(fill.fee)||fill.fee<0) throw new Error('Fill not confirmed; manual reconciliation required');
 return fill;
}
export async function marketOrder(exchange:string, keys:Keys, pair:string, side:'BUY'|'SELL',amount:number,clientId:string):Promise<Fill> {
 const [base,quote]=pair.split('/'); if(!base||!quote||!Number.isFinite(amount)||amount<=0) throw new Error('Invalid leg');
 const symbol=base+quote;
 let data:any;
 let id:string;
 if(exchange==='binance'||exchange==='mexc') {
  // Explicit quote spend for buys; base quantity for sells. Exchange filters reject invalid precision, never silently increase size.
  const params:Record<string,string>={symbol,side,type:'MARKET',newClientOrderId:clientId,...(side==='BUY'?{quoteOrderQty:String(amount)}:{quantity:String(amount)})};
  if(exchange==='binance')params.newOrderRespType='FULL';
  data=await signedRequest(exchange,keys,'POST','/api/v3/order',params);
  id=String(data.orderId||''); if(!id)throw new Error('Order acknowledgement missing');
  if(data.status!=='FILLED') data=await signedRequest(exchange,keys,'GET','/api/v3/order',{symbol,orderId:id});
  if(data.status!=='FILLED')throw new Error('Order is not fully filled; reconcile before retry');
  const trades=await signedRequest(exchange,keys,'GET','/api/v3/myTrades',{symbol,orderId:id});
  const fills=(Array.isArray(trades)?trades:[]).filter((t:any)=>String(t.orderId)===id);
  if(!fills.length)throw new Error('Fee and fill evidence missing; reconcile before retry');
  const fees=fills.map((t:any)=>({asset:String(t.commissionAsset),amount:Number(t.commission)}));
  const qty=Number(data.executedQty),value=Number(data.cummulativeQuoteQty);
  const out=side==='BUY'?base:quote;
  return assertFill({orderId:id,fillPrice:value/qty,fillAmount:(side==='BUY'?qty:value)-fees.filter((f:any)=>f.asset===out).reduce((s:number,f:any)=>s+f.amount,0),fee:fees.filter((f:any)=>f.asset===out).reduce((s:number,f:any)=>s+f.amount,0),feeAsset:out,fees});
 }
 if(exchange==='bybit') {
  data=await signedRequest(exchange,keys,'POST','/v5/order/create',{}, {category:'spot',symbol,side:side==='BUY'?'Buy':'Sell',orderType:'Market',qty:String(amount),marketUnit:side==='BUY'?'quoteCoin':'baseCoin',orderLinkId:clientId});
  id=String(data.result?.orderId||'');
 } else if(exchange==='okx') {
  data=await signedRequest(exchange,keys,'POST','/api/v5/trade/order',{}, {instId:base+'-'+quote,tdMode:'cash',side:side.toLowerCase(),ordType:'market',sz:String(amount),tgtCcy:side==='BUY'?'quote_ccy':'base_ccy',clOrdId:clientId});
  if(data.data?.[0]?.sCode!=='0')throw new Error('OKX rejected order');
  id=String(data.data?.[0]?.ordId||'');
 } else if(exchange==='gate') {
  data=await signedRequest(exchange,keys,'POST','/api/v4/spot/orders',{}, {currency_pair:base+'_'+quote,account:'spot',type:'market',side:side.toLowerCase(),amount:String(amount),time_in_force:'ioc',text:'t-'+clientId});
  id=String(data.id||'');
 } else throw new Error('Unsupported execution exchange');
 if(!id)throw new Error('Order acknowledgement missing; reconcile before retry');
 for(let i=0;i<8;i++) {
  if(exchange==='bybit') {
   data=await signedRequest(exchange,keys,'GET','/v5/order/realtime',{category:'spot',symbol,orderId:id});
   const o=data.result?.list?.[0];
   if(o?.orderStatus==='Filled') {
    const executions=await signedRequest(exchange,keys,'GET','/v5/execution/list',{category:'spot',symbol,orderId:id});
    const rows=executions.result?.list||[];if(!rows.length||rows.some((r:any)=>!r.feeCurrency))throw new Error('Bybit fee evidence missing');
    const out=side==='BUY'?base:quote,fees=rows.map((r:any)=>({asset:r.feeCurrency,amount:Number(r.execFee)}));
    const fee=fees.filter((f:any)=>f.asset===out).reduce((s:number,f:any)=>s+f.amount,0);
    return assertFill({orderId:id,fillPrice:Number(o.avgPrice),fillAmount:(side==='BUY'?Number(o.cumExecQty):Number(o.cumExecValue))-fee,fee,feeAsset:out,fees});
   }
  } else if(exchange==='okx') {
   data=await signedRequest(exchange,keys,'GET','/api/v5/trade/order',{instId:base+'-'+quote,ordId:id});
   const o=data.data?.[0];
   if(o?.state==='filled') {
    const fee=Math.abs(Number(o.fee)),out=side==='BUY'?base:quote;
    return assertFill({orderId:id,fillPrice:Number(o.avgPx),fillAmount:(side==='BUY'?Number(o.accFillSz):Number(o.accFillSz)*Number(o.avgPx))-(o.feeCcy===out?fee:0),fee,feeAsset:o.feeCcy,fees:[{asset:o.feeCcy,amount:fee}]});
   }
  } else {
   data=await signedRequest(exchange,keys,'GET','/api/v4/spot/orders/'+id,{currency_pair:base+'_'+quote});
   if(data.status==='closed' && data.finish_as==='filled') {
    const value=Number(data.filled_total),price=Number(data.avg_deal_price),fee=Number(data.fee),out=side==='BUY'?base:quote;
    return assertFill({orderId:id,fillPrice:price,fillAmount:(side==='BUY'?value/price:value)-(data.fee_currency===out?fee:0),fee,feeAsset:data.fee_currency,fees:[{asset:data.fee_currency,amount:fee}]});
   }
  }
  await new Promise(r=>setTimeout(r,500));
 }
 throw new Error('Order fill uncertain; manual reconciliation required. Do not resubmit.');
}

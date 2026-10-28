import {database} from '../_shared/trading-runtime.ts';
import {findTriangular,type Book} from '../_shared/triangular.ts';
export const scannerHealth = {lastScanAt:null as string|null,lastSavedAt:null as string|null,lastError:null as string|null,feeds:{} as Record<string,{pairs:number;price:number|null;at:string}>};
const sources:Record<string,string>={binance:'https://api.binance.com/api/v3/ticker/bookTicker',bybit:'https://api.bybit.com/v5/market/tickers?category=spot',okx:'https://www.okx.com/api/v5/market/tickers?instType=SPOT'};
async function bookFor(exchange:string):Promise<Book> {
 const res=await fetch(sources[exchange],{signal:AbortSignal.timeout(10000)});if(!res.ok)throw new Error('Market feed unavailable');
 const data=await res.json(),rows=exchange==='binance'?data:exchange==='bybit'?data.result?.list:data.data;
 if(!Array.isArray(rows))throw new Error('Invalid market response');
 const book:Book={},now=Date.now();
 for(const row of rows) {
  let pair=exchange==='okx'?row.instId?.replace('-','/'):undefined;
  const symbol=row.symbol;
  if(!pair&&typeof symbol==='string')for(const quote of ['USDT','USDC','BTC','ETH','BNB'])if(symbol.endsWith(quote)&&symbol.length>quote.length){pair=symbol.slice(0,-quote.length)+'/'+quote;break;}
  if(!pair)continue;
  const bid=Number(row.bidPrice??row.bid1Price??row.bidPx),ask=Number(row.askPrice??row.ask1Price??row.askPx);
  if(bid>0&&ask>=bid)book[pair]={bid,ask,ts:now,bidSize:Number(row.bidQty??row.bid1Size??row.bidSz),askSize:Number(row.askQty??row.ask1Size??row.askSz)};
 }
 scannerHealth.feeds[exchange]={pairs:Object.keys(book).length,price:book['BTC/USDT']?.bid??null,at:new Date().toISOString()};
 return book;
}
export default async function scanner(_req:Request) {
 const db=database();let saved=0,failures=0;
 const requested=(Deno.env.get('SCANNER_EXCHANGES')||'binance,bybit,okx').split(',').map(s=>s.trim());
 const configured=requested.filter(e=>e in sources);
 await Promise.all(configured.map(async exchange=>{
  try {
   const book=await bookFor(exchange);
   const bases=Object.keys(book).filter(p=>p.endsWith('/USDT')).map(p=>p.split('/')[0]);
   const opps=findTriangular(exchange,book,bases).filter(o=>o.volumeEstimate>0).slice(0,100);
   if(opps.length) {
    const rows=opps.map(o=>({detected_at:new Date(o.detectedAt).toISOString(),strategy:'triangular',path:o.path,exchange1:exchange,exchange2:exchange,exchange3:exchange,pair1:o.pairs[0],pair2:o.pairs[1],pair3:o.pairs[2],profit_percent:o.grossPercent,liquidity_score:Math.min(1,o.volumeEstimate/50000),volume_estimate:o.volumeEstimate,estimated_slippage:0,status:'active'}));
    const {error}=await db.from('opportunities').insert(rows);if(error)throw new Error('Database opportunity write rejected');
    saved+=rows.length;scannerHealth.lastSavedAt=new Date().toISOString();
   }
  }catch{failures++;}
 }));
 scannerHealth.lastScanAt=new Date().toISOString();scannerHealth.lastError=failures?`${failures} feed or database checks failed`:null;
 await db.from('scanner_health_metrics').insert([{metric_name:'vps_scanner_heartbeat',metric_value:Date.now()},{metric_name:'vps_scanner_saved',metric_value:saved},{metric_name:'vps_scanner_failures',metric_value:failures}]);
 return Response.json({success:failures===0,saved,feeds:scannerHealth.feeds,failures});
}

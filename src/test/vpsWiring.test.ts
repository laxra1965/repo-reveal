import {describe,it,expect} from 'vitest';
import {prepareLegs,validatePolicy} from '../../VPS/opt/arbitrage-functions/supabase/functions/_shared/trading-policy';
import {assertFill} from '../../VPS/opt/arbitrage-functions/supabase/functions/_shared/orders';
const now=Date.now();
const o={strategy:'triangular',path:'USDT > BTC > ETH > USDT',pair1:'BTC/USDT',pair2:'ETH/BTC',pair3:'ETH/USDT',exchange1:'binance',exchange2:'binance',exchange3:'binance',detected_at:new Date(now).toISOString(),status:'active',profit_percent:1,estimated_slippage:0.001,volume_estimate:1000};
const s={trade_amount:50,max_position_size:100,enabled_exchanges:['binance'],arbitrage_types:['triangular']};
const flags={real_money_approved:'true',real_money_allowed_exchanges:'["binance"]'};
describe('VPS live execution safeguards',()=>{
 it('respects saved 50 USDT trade amount',()=>{expect(validatePolicy(o,s,flags,50,now)).toHaveLength(3);expect(()=>validatePolicy(o,s,flags,51,now)).toThrow('Trade exceeds');});
 it('blocks expired quotes',()=>{expect(()=>validatePolicy({...o,detected_at:new Date(now-61000).toISOString()},s,flags,50,now)).toThrow('expired');});
 it('blocks missing approval',()=>{expect(()=>validatePolicy(o,s,{...flags,real_money_approved:'false'},50,now)).toThrow('approved');});
 it('blocks exchanges not enabled by user',()=>{expect(()=>validatePolicy(o,{...s,enabled_exchanges:[]},flags,50,now)).toThrow('Exchange');});
 it('blocks cross exchange execution',()=>{expect(()=>prepareLegs({...o,exchange2:'bybit'})).toThrow('Cross-exchange');});
 it('builds quote-spend BUY, BUY, SELL legs',()=>{expect(prepareLegs(o).map(l=>l.side)).toEqual(['BUY','BUY','SELL']);});
 it('never accepts synthetic zero-price fills',()=>{expect(()=>assertFill({orderId:'123',fillPrice:0,fillAmount:50,fee:0,feeAsset:'USDT'})).toThrow('Fill not confirmed');});
 it('never accepts zero-quantity fills',()=>{expect(()=>assertFill({orderId:'123',fillPrice:10,fillAmount:0,fee:0,feeAsset:'USDT'})).toThrow('Fill not confirmed');});
 it('subtracts 0.3 percent fees and slippage',()=>{expect(()=>validatePolicy({...o,profit_percent:0.4,estimated_slippage:0.002},s,flags,50,now)).toThrow('fees and slippage');});
});

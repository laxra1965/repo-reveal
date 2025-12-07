import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { wsPoolManager, type WebSocketMetrics } from '@/lib/websocket-monitor';

interface BinancePrice {
  s: string; // symbol
  b: string; // bid
  a: string; // ask  
  c: string; // close
  h: string; // high
  l: string; // low
  v: string; // volume
}

interface BinancePriceStreamProps {
  isVisible?: boolean;
}

export const BinancePriceStream = ({ isVisible = false }: BinancePriceStreamProps) => {
  const [prices, setPrices] = useState<BinancePrice[]>([]);
  const [metrics, setMetrics] = useState<WebSocketMetrics | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    if (!isVisible) return;

    // Get WebSocket connection from pool
    const wsUrl = 'wss://zupbliefzhnohsoguwuk.functions.supabase.co/binance-websocket';

    const connectWebSocket = () => {
      setConnectionStatus('connecting');
      ws = new WebSocket('wss://zupbliefzhnohsoguwuk.functions.supabase.co/binance-websocket');

      ws.onopen = () => {
        console.log('Connected to Binance price stream');
        setConnectionStatus('connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'price_update' || data.type === 'initial_data') {
            const bnbPairs = data.data
              .filter((price: BinancePrice) =>
                price.s.includes('BNB') &&
                (price.s.endsWith('USDT') || price.s.startsWith('BNB'))
              )
              .slice(0, 20); // Show top 20 BNB pairs

            setPrices(bnbPairs);
            setLastUpdate(new Date());
          }
        } catch (error) {
          console.error('Error processing price data:', error);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting...');
        setConnectionStatus('disconnected');
        setTimeout(connectWebSocket, 3000);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionStatus('disconnected');
      };
    };

    connectWebSocket();

    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, [isVisible]);

  if (!isVisible) return null;

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'text-green-600';
      case 'connecting': return 'text-yellow-600';
      default: return 'text-red-600';
    }
  };

  const getPriceChangeColor = (current: string, high: string, low: string) => {
    const currentPrice = parseFloat(current);
    const highPrice = parseFloat(high);
    const lowPrice = parseFloat(low);
    const midPrice = (highPrice + lowPrice) / 2;

    return currentPrice > midPrice ? 'text-green-600' : 'text-red-600';
  };

  return (
    <Card className="mt-4">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="text-lg">BNB Pairs - Real-Time Prices</CardTitle>
          <div className="flex items-center gap-2">
            <Activity className={`h-4 w-4 ${getStatusColor()}`} />
            <Badge variant="outline" className={getStatusColor()}>
              {connectionStatus}
            </Badge>
          </div>
        </div>
        {lastUpdate && (
          <p className="text-sm text-muted-foreground">
            Last update: {lastUpdate.toLocaleTimeString()}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {prices.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {connectionStatus === 'connecting' ? 'Connecting to Binance...' : 'No price data available'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {prices.map((price) => (
              <div key={price.s} className="border rounded-lg p-3 hover:bg-muted/50 transition-colors">
                <div className="flex justify-between items-start mb-2">
                  <span className="font-semibold text-sm">{price.s}</span>
                  <div className="flex items-center gap-1">
                    {getPriceChangeColor(price.c, price.h, price.l) === 'text-green-600' ? (
                      <TrendingUp className="h-3 w-3 text-green-600" />
                    ) : (
                      <TrendingDown className="h-3 w-3 text-red-600" />
                    )}
                  </div>
                </div>

                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Price:</span>
                    <span className={`font-mono ${getPriceChangeColor(price.c, price.h, price.l)}`}>
                      {parseFloat(price.c).toFixed(6)}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bid:</span>
                    <span className="font-mono text-green-600">
                      {parseFloat(price.b).toFixed(6)}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Ask:</span>
                    <span className="font-mono text-red-600">
                      {parseFloat(price.a).toFixed(6)}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-muted-foreground">24h Vol:</span>
                    <span className="font-mono">
                      {parseFloat(price.v).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Wifi, WifiOff, TrendingUp, TrendingDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface PriceData {
  symbol: string;
  exchange: string;
  bidPrice: number;
  askPrice: number;
  timestamp: number;
  change?: number;
}

interface RealTimePricesProps {
  onPriceUpdate?: (prices: Record<string, PriceData[]>) => void;
}

export const RealTimePrices = ({ onPriceUpdate }: RealTimePricesProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isConnected, setIsConnected] = useState(false);
  const [prices, setPrices] = useState<Record<string, PriceData[]>>({});
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [ws, setWs] = useState<WebSocket | null>(null);

  const connectWebSocket = useCallback(async () => {
    if (!user || ws?.readyState === WebSocket.OPEN) return;

    setConnectionStatus('connecting');
    
    try {
      // Get the current session to get the access token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No valid session found');
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//zupbliefzhnohsoguwuk.supabase.co/functions/v1/price-websocket`;
      
      // Create WebSocket with proper headers
      const newWs = new WebSocket(wsUrl);
      
      // Set authorization header after connection
      newWs.addEventListener('open', () => {
        newWs.send(JSON.stringify({
          type: 'auth',
          token: session.access_token
        }));
      });
      
      newWs.onopen = () => {
        console.log('WebSocket connection opened, sending authentication');
      };

      newWs.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          switch (message.type) {
            case 'auth_required':
              console.log('Authentication required, sending token');
              break;
            case 'authenticated':
              console.log('Authentication successful');
              setIsConnected(true);
              setConnectionStatus('connected');
              
              // Subscribe to BNB pairs after authentication
              newWs.send(JSON.stringify({
                type: 'subscribe',
                symbols: ['BNBUSDT', 'BNBBTC', 'BNBETH', 'BNBBUSD', 'ADABNB', 'DOTBNB', 'LINKBNB', 'LTCBNB']
              }));

              toast({
                title: "Connected",
                description: "Real-time price stream connected",
              });
              break;
            case 'auth_error':
              console.error('Authentication failed:', message.message);
              setIsConnected(false);
              setConnectionStatus('disconnected');
              toast({
                title: "Authentication Error",
                description: "Failed to authenticate with price service",
                variant: "destructive",
              });
              break;
            case 'initial_prices':
            case 'price_update':
              handlePriceUpdate(message.data);
              break;
            case 'connected':
              console.log('WebSocket connected:', message.message);
              break;
            case 'pong':
              console.log('Received pong');
              break;
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      newWs.onclose = () => {
        console.log('WebSocket connection closed');
        setIsConnected(false);
        setConnectionStatus('disconnected');
        setWs(null);
        
        // Attempt to reconnect after 3 seconds
        setTimeout(() => {
          if (connectionStatus !== 'connected') {
            connectWebSocket();
          }
        }, 3000);
      };

      newWs.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
        setConnectionStatus('disconnected');
        
        toast({
          title: "Connection Error",
          description: "Failed to connect to real-time prices",
          variant: "destructive",
        });
      };

      setWs(newWs);
    } catch (error) {
      console.error('Error creating WebSocket:', error);
      setConnectionStatus('disconnected');
    }
  }, [user, ws, connectionStatus, toast]);

  const handlePriceUpdate = useCallback((newPrices: PriceData[]) => {
    setPrices(prev => {
      const updated = { ...prev };
      
      newPrices.forEach(price => {
        if (!updated[price.symbol]) {
          updated[price.symbol] = [];
        }
        
        // Find existing price for this exchange or add new one
        const existingIndex = updated[price.symbol].findIndex(p => p.exchange === price.exchange);
        
        if (existingIndex >= 0) {
          // Calculate price change
          const oldPrice = updated[price.symbol][existingIndex].askPrice;
          const change = ((price.askPrice - oldPrice) / oldPrice) * 100;
          
          updated[price.symbol][existingIndex] = { ...price, change };
        } else {
          updated[price.symbol].push(price);
        }
      });
      
      // Notify parent component
      onPriceUpdate?.(updated);
      
      return updated;
    });
  }, [onPriceUpdate]);

  const disconnect = useCallback(() => {
    if (ws) {
      ws.close();
      setWs(null);
      setIsConnected(false);
      setConnectionStatus('disconnected');
    }
  }, [ws]);

  // Auto-connect on mount
  useEffect(() => {
    if (user && connectionStatus === 'disconnected') {
      connectWebSocket();
    }

    return () => {
      disconnect();
    };
  }, [user, connectWebSocket, disconnect, connectionStatus]);

  // Ping keep-alive
  useEffect(() => {
    if (!ws || !isConnected) return;

    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000); // Ping every 30 seconds

    return () => clearInterval(interval);
  }, [ws, isConnected]);

  const getConnectionBadgeVariant = () => {
    switch (connectionStatus) {
      case 'connected': return 'default';
      case 'connecting': return 'secondary';
      case 'disconnected': return 'destructive';
      default: return 'secondary';
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Real-Time BNB Prices</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant={getConnectionBadgeVariant()} className="text-xs">
            {isConnected ? <Wifi className="h-3 w-3 mr-1" /> : <WifiOff className="h-3 w-3 mr-1" />}
            {connectionStatus === 'connected' ? 'Live' : connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
          </Badge>
          {!isConnected && (
            <Button size="sm" variant="outline" onClick={connectWebSocket}>
              Reconnect
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {Object.entries(prices).map(([symbol, exchangePrices]) => (
            <div key={symbol} className="border rounded p-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{symbol}</span>
                <div className="text-xs text-muted-foreground">
                  {exchangePrices.length} exchange{exchangePrices.length !== 1 ? 's' : ''}
                </div>
              </div>
              {exchangePrices.map((price, index) => (
                <div key={`${price.exchange}-${index}`} className="flex items-center justify-between text-xs">
                  <span className="capitalize">{price.exchange}</span>
                  <div className="flex items-center gap-2">
                    <span>${price.askPrice.toFixed(6)}</span>
                    {price.change !== undefined && (
                      <div className={`flex items-center ${price.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {price.change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        <span>{Math.abs(price.change).toFixed(2)}%</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
          
          {Object.keys(prices).length === 0 && (
            <div className="text-center text-muted-foreground py-4">
              {isConnected ? 'Waiting for price data...' : 'Connect to see real-time prices'}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

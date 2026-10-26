import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Map to manage active WebSocket connections
const activeConnections = new Set<WebSocket>();
let lastBroadcast = Date.now();

interface OpportunityUpdate {
  type: 'new_opportunity' | 'snapshot' | 'heartbeat';
  data?: any;
  timestamp: string;
}

/**
 * Real-time WebSocket endpoint for streaming opportunities
 * Usage: ws://localhost:8000/ws-opportunities
 * 
 * Messages received:
 * - { type: 'heartbeat', timestamp: '2026-03-22T20:40:00Z' } (every 30s)
 * - { type: 'snapshot', data: [...], timestamp: '2026-03-22T20:40:00Z' } (on connect + every 30s)
 * - { type: 'new_opportunity', data: {...}, timestamp: '2026-03-22T20:40:00Z' } (when detected)
 */

async function getLatestOpportunities(limit: number = 50): Promise<any[]> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) return [];

    const client = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await client
      .from('opportunities')
      .select('*')
      .eq('status', 'active')
      .order('detected_at', { ascending: false })
      .limit(limit);

    return error ? [] : (data || []);
  } catch {
    return [];
  }
}

function broadcastToAll(message: OpportunityUpdate) {
  activeConnections.forEach((ws) => {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Connection likely closed
      activeConnections.delete(ws);
    }
  });
}

export default async (req: Request): Promise<Response> => {
  // Only WebSocket requests
  if (req.headers.get('upgrade') !== 'websocket') {
    return new Response('WebSocket required', { status: 400 });
  }

  try {
    const { socket, response } = Deno.upgradeWebSocket(req);

    activeConnections.add(socket);
    console.log(`[WS] New connection. Total: ${activeConnections.size}`);

    // Send initial snapshot
    const snapshot = await getLatestOpportunities(50);
    socket.send(JSON.stringify({
      type: 'snapshot',
      data: snapshot,
      timestamp: new Date().toISOString(),
      connection_count: activeConnections.size
    } as OpportunityUpdate));

    // Heartbeat + periodic snapshots
    const heartbeatInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        broadcastToAll({
          type: 'heartbeat',
          timestamp: new Date().toISOString()
        });
      }
    }, 30000); // Every 30s

    // Periodic snapshot refresh
    const snapshotInterval = setInterval(async () => {
      if (socket.readyState === WebSocket.OPEN) {
        const data = await getLatestOpportunities(50);
        broadcastToAll({
          type: 'snapshot',
          data,
          timestamp: new Date().toISOString()
        });
      }
    }, 30000); // Every 30s

    socket.addEventListener('close', () => {
      activeConnections.delete(socket);
      clearInterval(heartbeatInterval);
      clearInterval(snapshotInterval);
      console.log(`[WS] Connection closed. Total: ${activeConnections.size}`);
    });

    socket.addEventListener('error', (err) => {
      console.error('[WS] Error:', err);
      activeConnections.delete(socket);
      clearInterval(heartbeatInterval);
      clearInterval(snapshotInterval);
    });

    socket.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        
        // Handle client commands
        if (msg.command === 'refresh') {
          // Client requested immediate snapshot refresh
          getLatestOpportunities(msg.limit || 50).then((data) => {
            socket.send(JSON.stringify({
              type: 'snapshot',
              data,
              timestamp: new Date().toISOString()
            }));
          });
        }
      } catch {
        // Ignore invalid messages
      }
    });

    return response;
  } catch (err) {
    return new Response(`WebSocket upgrade failed: ${err}`, { status: 400 });
  }
};

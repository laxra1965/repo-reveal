/**
 * WebSocket Connection Monitor
 * 
 * Manages WebSocket connections with health monitoring, connection pooling,
 * and automatic reconnection with exponential backoff.
 */

interface WebSocketConfig {
    url: string;
    protocols?: string | string[];
    maxReconnectDelay?: number;
    minReconnectDelay?: number;
    reconnectDecay?: number;
    maxReconnectAttempts?: number;
}

interface WebSocketMetrics {
    connectionId: string;
    url: string;
    status: 'connecting' | 'connected' | 'disconnected' | 'error';
    connectedAt?: Date;
    disconnectedAt?: Date;
    reconnectAttempts: number;
    latency?: number;
    messagesReceived: number;
    messagesSent: number;
    lastMessageAt?: Date;
}

type MessageHandler = (event: MessageEvent) => void;
type ErrorHandler = (error: Event) => void;
type StatusChangeHandler = (metrics: WebSocketMetrics) => void;

class WebSocketMonitor {
    private socket: WebSocket | null = null;
    private config: Required<WebSocketConfig>;
    private metrics: WebSocketMetrics;
    private reconnectTimeout: number | null = null;
    private reconnectDelay: number;
    private messageHandlers: Set<MessageHandler> = new Set();
    private errorHandlers: Set<ErrorHandler> = new Set();
    private statusChangeHandlers: Set<StatusChangeHandler> = new Set();
    private pingInterval: number | null = null;
    private lastPingTime: number = 0;

    constructor(config: WebSocketConfig) {
        this.config = {
            url: config.url,
            protocols: config.protocols,
            maxReconnectDelay: config.maxReconnectDelay ?? 30000,
            minReconnectDelay: config.minReconnectDelay ?? 1000,
            reconnectDecay: config.reconnectDecay ?? 1.5,
            maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
        };

        this.reconnectDelay = this.config.minReconnectDelay;

        this.metrics = {
            connectionId: this.generateConnectionId(),
            url: this.config.url,
            status: 'disconnected',
            reconnectAttempts: 0,
            messagesReceived: 0,
            messagesSent: 0,
        };
    }

    private generateConnectionId(): string {
        return `ws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    public connect(): void {
        if (this.socket?.readyState === WebSocket.OPEN) {
            console.warn('[WebSocketMonitor] Already connected');
            return;
        }

        this.updateStatus('connecting');

        try {
            this.socket = new WebSocket(this.config.url, this.config.protocols);
            this.attachEventListeners();
        } catch (error) {
            console.error('[WebSocketMonitor] Connection error:', error);
            this.updateStatus('error');
            this.scheduleReconnect();
        }
    }

    private attachEventListeners(): void {
        if (!this.socket) return;

        this.socket.onopen = () => {
            console.log('[WebSocketMonitor] Connected:', this.config.url);
            this.metrics.connectedAt = new Date();
            this.metrics.reconnectAttempts = 0;
            this.reconnectDelay = this.config.minReconnectDelay;
            this.updateStatus('connected');
            this.startPingInterval();
        };

        this.socket.onmessage = (event: MessageEvent) => {
            this.metrics.messagesReceived++;
            this.metrics.lastMessageAt = new Date();

            // Handle pong for latency measurement
            if (event.data === 'pong' && this.lastPingTime) {
                this.metrics.latency = Date.now() - this.lastPingTime;
            }

            // Notify all message handlers
            this.messageHandlers.forEach((handler) => {
                try {
                    handler(event);
                } catch (error) {
                    console.error('[WebSocketMonitor] Message handler error:', error);
                }
            });
        };

        this.socket.onerror = (error: Event) => {
            console.error('[WebSocketMonitor] Error:', error);
            this.updateStatus('error');

            this.errorHandlers.forEach((handler) => {
                try {
                    handler(error);
                } catch (err) {
                    console.error('[WebSocketMonitor] Error handler error:', err);
                }
            });
        };

        this.socket.onclose = () => {
            console.log('[WebSocketMonitor] Disconnected');
            this.metrics.disconnectedAt = new Date();
            this.updateStatus('disconnected');
            this.stopPingInterval();
            this.scheduleReconnect();
        };
    }

    private startPingInterval(): void {
        // Send ping every 30 seconds to measure latency and keep connection alive
        this.pingInterval = window.setInterval(() => {
            if (this.socket?.readyState === WebSocket.OPEN) {
                this.lastPingTime = Date.now();
                this.send('ping');
            }
        }, 30000);
    }

    private stopPingInterval(): void {
        if (this.pingInterval !== null) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimeout !== null) return;

        if (this.metrics.reconnectAttempts >= this.config.maxReconnectAttempts) {
            console.error('[WebSocketMonitor] Max reconnect attempts reached');
            return;
        }

        this.metrics.reconnectAttempts++;

        console.log(
            `[WebSocketMonitor] Reconnecting in ${this.reconnectDelay}ms (attempt ${this.metrics.reconnectAttempts}/${this.config.maxReconnectAttempts})`
        );

        this.reconnectTimeout = window.setTimeout(() => {
            this.reconnectTimeout = null;
            this.connect();
        }, this.reconnectDelay);

        // Exponential backoff
        this.reconnectDelay = Math.min(
            this.reconnectDelay * this.config.reconnectDecay,
            this.config.maxReconnectDelay
        );
    }

    public send(data: string | ArrayBuffer | Blob): boolean {
        if (this.socket?.readyState !== WebSocket.OPEN) {
            console.warn('[WebSocketMonitor] Cannot send - not connected');
            return false;
        }

        try {
            this.socket.send(data);
            this.metrics.messagesSent++;
            return true;
        } catch (error) {
            console.error('[WebSocketMonitor] Send error:', error);
            return false;
        }
    }

    public disconnect(): void {
        if (this.reconnectTimeout !== null) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        this.stopPingInterval();

        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
    }

    public onMessage(handler: MessageHandler): () => void {
        this.messageHandlers.add(handler);
        return () => this.messageHandlers.delete(handler);
    }

    public onError(handler: ErrorHandler): () => void {
        this.errorHandlers.add(handler);
        return () => this.errorHandlers.delete(handler);
    }

    public onStatusChange(handler: StatusChangeHandler): () => void {
        this.statusChangeHandlers.add(handler);
        return () => this.statusChangeHandlers.delete(handler);
    }

    private updateStatus(status: WebSocketMetrics['status']): void {
        this.metrics.status = status;
        this.statusChangeHandlers.forEach((handler) => {
            try {
                handler({ ...this.metrics });
            } catch (error) {
                console.error('[WebSocketMonitor] Status change handler error:', error);
            }
        });
    }

    public getMetrics(): WebSocketMetrics {
        return { ...this.metrics };
    }

    public isConnected(): boolean {
        return this.socket?.readyState === WebSocket.OPEN;
    }

    public getReadyState(): number | undefined {
        return this.socket?.readyState;
    }
}

// Connection Pool Manager
class WebSocketPoolManager {
    private static instance: WebSocketPoolManager;
    private connections: Map<string, WebSocketMonitor> = new Map();
    private maxConnections: number;

    private constructor() {
        // Get max connections from environment or default to 5
        this.maxConnections = parseInt(
            import.meta.env.VITE_MAX_WEBSOCKET_CONNECTIONS || '5'
        );
    }

    public static getInstance(): WebSocketPoolManager {
        if (!WebSocketPoolManager.instance) {
            WebSocketPoolManager.instance = new WebSocketPoolManager();
        }
        return WebSocketPoolManager.instance;
    }

    public getConnection(url: string, config?: Omit<WebSocketConfig, 'url'>): WebSocketMonitor {
        // Check if connection already exists
        if (this.connections.has(url)) {
            const existing = this.connections.get(url)!;
            if (existing.isConnected()) {
                return existing;
            }
        }

        // Check connection limit
        if (this.connections.size >= this.maxConnections) {
            console.warn(`[WebSocketPoolManager] Max connections (${this.maxConnections}) reached`);
            // Optionally close oldest connection
            const oldestKey = this.connections.keys().next().value;
            if (oldestKey) {
                this.closeConnection(oldestKey);
            }
        }

        // Create new connection
        const monitor = new WebSocketMonitor({ url, ...config });
        this.connections.set(url, monitor);
        monitor.connect();

        return monitor;
    }

    public closeConnection(url: string): void {
        const connection = this.connections.get(url);
        if (connection) {
            connection.disconnect();
            this.connections.delete(url);
        }
    }

    public closeAll(): void {
        this.connections.forEach((connection) => connection.disconnect());
        this.connections.clear();
    }

    public getActiveConnections(): number {
        return Array.from(this.connections.values()).filter((conn) =>
            conn.isConnected()
        ).length;
    }

    public getAllMetrics(): WebSocketMetrics[] {
        return Array.from(this.connections.values()).map((conn) => conn.getMetrics());
    }
}

// Export singleton instance
export const wsPoolManager = WebSocketPoolManager.getInstance();
export { WebSocketMonitor };
export type { WebSocketConfig, WebSocketMetrics };

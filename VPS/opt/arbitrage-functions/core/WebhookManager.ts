/**
 * WebhookManager - Send alerts and notifications to external services
 * Supports Discord, Slack, Telegram, HTTP webhooks, and Email
 */

export interface WebhookConfig {
    enabled: boolean;
    type: 'discord' | 'slack' | 'telegram' | 'http' | 'email';
    url?: string;  // For Discord, Slack, HTTP, Telegram bot URL
    token?: string;  // For Telegram or custom auth
    email?: string;  // For email alerts
    channels?: {
        trades?: string;
        errors?: string;
        milestones?: string;
    };
}

export interface AlertMessage {
    title: string;
    message: string;
    type: 'trade' | 'error' | 'milestone' | 'drawdown' | 'info';
    severity: 'low' | 'medium' | 'high' | 'critical';
    data?: Record<string, any>;
    timestamp?: number;
}

export class WebhookManager {
    private config: WebhookConfig;
    private lastSentTime: Record<string, number> = {};  // Prevent alert spam

    constructor(config: WebhookConfig) {
        this.config = config;
        if (config.enabled) {
            console.log(`📬 [WebhookManager] Initialized for ${config.type}`);
        }
    }

    /**
     * Send alert based on configuration
     */
    async sendAlert(alert: AlertMessage): Promise<boolean> {
        if (!this.config.enabled) {
            return false;
        }

        // Rate limit alerts (max 1 per type per 5 seconds)
        const key = alert.type;
        const now = Date.now();
        if (this.lastSentTime[key] && now - this.lastSentTime[key] < 5000) {
            return false;  // Skip duplicate alerts
        }

        try {
            switch (this.config.type) {
                case 'discord':
                    await this.sendDiscordAlert(alert);
                    break;
                case 'slack':
                    await this.sendSlackAlert(alert);
                    break;
                case 'telegram':
                    await this.sendTelegramAlert(alert);
                    break;
                case 'http':
                    await this.sendHTTPAlert(alert);
                    break;
                case 'email':
                    await this.sendEmailAlert(alert);
                    break;
            }

            this.lastSentTime[key] = now;
            return true;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(`❌ [WebhookManager] Alert failed:`, msg);
            return false;
        }
    }

    /**
     * Send Discord embed alert
     */
    private async sendDiscordAlert(alert: AlertMessage): Promise<void> {
        const colors: Record<string, number> = {
            low: 0x808080,      // Gray
            medium: 0xFFA500,   // Orange
            high: 0xFF6900,     // Red-Orange
            critical: 0xFF0000  // Red
        };

        const embed = {
            title: alert.title,
            description: alert.message,
            color: colors[alert.severity] || colors.low,
            fields: [
                {
                    name: 'Type',
                    value: alert.type.toUpperCase(),
                    inline: true
                },
                {
                    name: 'Severity',
                    value: alert.severity.toUpperCase(),
                    inline: true
                },
                ...(alert.data 
                    ? Object.entries(alert.data).map(([key, value]) => ({
                        name: key.charAt(0).toUpperCase() + key.slice(1),
                        value: String(value),
                        inline: true
                    }))
                    : []
                )
            ],
            timestamp: alert.timestamp || Date.now(),
            footer: {
                text: 'Arbitrage Bot',
                icon_url: 'https://binance.com/favicon.ico'
            }
        };

        const payload = {
            embeds: [embed]
        };

        const response = await fetch(this.config.url!, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Discord API error: ${response.statusText}`);
        }

        console.log(`📤 [Discord] Alert sent: ${alert.title}`);
    }

    /**
     * Send Slack message alert
     */
    private async sendSlackAlert(alert: AlertMessage): Promise<void> {
        const colors: Record<string, string> = {
            low: '#808080',
            medium: '#FFA500',
            high: '#FF6900',
            critical: '#FF0000'
        };

        const attachment = {
            color: colors[alert.severity],
            title: alert.title,
            text: alert.message,
            fields: [
                {
                    title: 'Type',
                    value: alert.type.toUpperCase(),
                    short: true
                },
                {
                    title: 'Severity',
                    value: alert.severity.toUpperCase(),
                    short: true
                },
                ...(alert.data
                    ? Object.entries(alert.data).map(([key, value]) => ({
                        title: key.charAt(0).toUpperCase() + key.slice(1),
                        value: String(value),
                        short: true
                    }))
                    : []
                )
            ],
            ts: Math.floor((alert.timestamp || Date.now()) / 1000)
        };

        const payload = {
            attachments: [attachment]
        };

        const response = await fetch(this.config.url!, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Slack API error: ${response.statusText}`);
        }

        console.log(`📤 [Slack] Alert sent: ${alert.title}`);
    }

    /**
     * Send Telegram message alert
     */
    private async sendTelegramAlert(alert: AlertMessage): Promise<void> {
        const emoji: Record<string, string> = {
            trade: '💰',
            error: '❌',
            milestone: '🎯',
            drawdown: '📉',
            info: 'ℹ️'
        };

        const severityEmoji: Record<string, string> = {
            low: '⚪',
            medium: '🟡',
            high: '🟠',
            critical: '🔴'
        };

        const message = `${emoji[alert.type]} ${alert.title}

${alert.message}

${severityEmoji[alert.severity]} **${alert.severity.toUpperCase()}**

${alert.data ? Object.entries(alert.data)
    .map(([k, v]) => `• **${k}:** ${v}`)
    .join('\n') : ''}

_${new Date(alert.timestamp || Date.now()).toISOString()}_`;

        const url = `${this.config.url!}/sendMessage`;
        const payload = {
            text: message,
            parse_mode: 'Markdown'
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Telegram API error: ${response.statusText}`);
        }

        console.log(`📤 [Telegram] Alert sent: ${alert.title}`);
    }

    /**
     * Send generic HTTP webhook
     */
    private async sendHTTPAlert(alert: AlertMessage): Promise<void> {
        const payload = {
            title: alert.title,
            message: alert.message,
            type: alert.type,
            severity: alert.severity,
            timestamp: alert.timestamp || Date.now(),
            data: alert.data || {}
        };

        const response = await fetch(this.config.url!, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP webhook error: ${response.statusText}`);
        }

        console.log(`📤 [HTTP] Alert sent: ${alert.title}`);
    }

    /**
     * Send email alert (via service)
     */
    private async sendEmailAlert(alert: AlertMessage): Promise<void> {
        // This would typically be handled by a service like SendGrid, AWS SES, etc.
        // For now, we'll just log it
        console.log(`📧 [Email] Alert to ${this.config.email}:\n${alert.title}\n${alert.message}`);

        // Example SendGrid integration (uncomment if using SendGrid):
        /*
        const payload = {
            personalizations: [{
                to: [{ email: this.config.email }]
            }],
            from: { email: 'alerts@arbitrage.bot' },
            subject: alert.title,
            content: [{
                type: 'text/html',
                value: `<h2>${alert.title}</h2><p>${alert.message}</p><p>${JSON.stringify(alert.data, null, 2)}</p>`
            }]
        };

        const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        */
    }

    /**
     * Send trade execution alert
     */
    async alertTrade(trade: {
        symbol: string;
        side: string;
        quantity: number;
        price: number;
        pnl: number;
        timestamp: number;
    }): Promise<void> {
        await this.sendAlert({
            title: `📈 Trade Executed: ${trade.symbol}`,
            message: `${trade.side} ${trade.quantity} @ $${trade.price.toFixed(8)}\nP&L: $${trade.pnl.toFixed(2)}`,
            type: 'trade',
            severity: trade.pnl > 0 ? 'low' : 'medium',
            data: trade,
            timestamp: trade.timestamp
        });
    }

    /**
     * Send drawdown warning alert
     */
    async alertDrawdown(drawdown: {
        percent: number;
        amount: number;
        capital: number;
        timestamp: number;
    }): Promise<void> {
        const severity = drawdown.percent > 50 ? 'critical' : 
                        drawdown.percent > 30 ? 'high' : 
                        drawdown.percent > 10 ? 'medium' : 'low';

        await this.sendAlert({
            title: `📉 High Drawdown: ${drawdown.percent.toFixed(1)}%`,
            message: `Capital: $${drawdown.capital.toFixed(2)}\nLoss: $${drawdown.amount.toFixed(2)}`,
            type: 'drawdown',
            severity,
            data: drawdown,
            timestamp: drawdown.timestamp
        });
    }

    /**
     * Send error alert
     */
    async alertError(error: {
        message: string;
        code?: string;
        context?: string;
        timestamp: number;
    }): Promise<void> {
        await this.sendAlert({
            title: `❌ Error: ${error.code || 'UNKNOWN'}`,
            message: error.message,
            type: 'error',
            severity: 'high',
            data: { context: error.context },
            timestamp: error.timestamp
        });
    }

    /**
     * Send milestone alert (daily profit, win streak, etc.)
     */
    async alertMilestone(milestone: {
        type: string;
        value: number;
        unit: string;
        timestamp: number;
    }): Promise<void> {
        await this.sendAlert({
            title: `🎯 Milestone: ${milestone.type}`,
            message: `Reached: ${milestone.value.toFixed(2)} ${milestone.unit}`,
            type: 'milestone',
            severity: 'low',
            data: milestone,
            timestamp: milestone.timestamp
        });
    }
}

/**
 * Factory function to create webhook manager from env vars
 */
export function createWebhookManager(): WebhookManager {
    const enabled = Deno.env.get('WEBHOOK_ENABLED') === 'true';
    const type = (Deno.env.get('WEBHOOK_TYPE') || 'discord') as any;

    const config: WebhookConfig = {
        enabled,
        type,
        url: Deno.env.get('WEBHOOK_URL'),
        token: Deno.env.get('WEBHOOK_TOKEN'),
        email: Deno.env.get('ALERT_EMAIL'),
        channels: {
            trades: Deno.env.get('WEBHOOK_CHANNEL_TRADES'),
            errors: Deno.env.get('WEBHOOK_CHANNEL_ERRORS'),
            milestones: Deno.env.get('WEBHOOK_CHANNEL_MILESTONES')
        }
    };

    return new WebhookManager(config);
}

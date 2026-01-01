
import { createClient } from '@supabase/supabase-js';
import Redis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

export enum LogLevel {
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR',
    TRADE = 'TRADE'
}

export class AsyncLogger {
    private buffer: any[] = [];
    private flushInterval: NodeJS.Timeout | null = null;
    private supabase: any = null;
    private redis: Redis | null = null;

    constructor(redisInstance?: Redis) {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        this.redis = redisInstance || null;
        if (url && key) {
            this.supabase = createClient(url, key);
            this.startFlushLoop();
        }
    }

    log(level: LogLevel, message: string, meta?: any, correlationId?: string) {
        const timestamp = new Date().toISOString();
        const cidStr = correlationId ? ` [CID:${correlationId}]` : '';
        const logEntry = `[${timestamp}] [${level}]${cidStr} ${message} ${meta ? JSON.stringify(meta) : ''}`;

        switch (level) {
            case LogLevel.ERROR: console.error(logEntry); break;
            case LogLevel.WARN: console.warn(logEntry); break;
            default: console.log(logEntry);
        }

        if (this.redis) {
            this.redis.publish(`logs:${level.toLowerCase()}`, JSON.stringify({
                timestamp,
                level,
                message,
                meta,
                cid: correlationId
            }));
        }

        if (this.supabase) {
            this.buffer.push({
                level,
                message,
                meta,
                cid: correlationId,
                created_at: timestamp
            });
        }
    }

    private startFlushLoop() {
        this.flushInterval = setInterval(async () => {
            if (this.buffer.length === 0) return;

            const batch = [...this.buffer];
            this.buffer = [];

            try {
                // Future: Insert into Supabase logs table
                // await this.supabase.from('system_logs').insert(batch);
            } catch (e) {
                console.error('Log Flush failure', e);
            }
        }, 5000);
    }
}

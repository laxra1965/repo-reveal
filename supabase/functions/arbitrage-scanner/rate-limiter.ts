// Rate limiting utilities

import { RATE_LIMIT_CONFIG } from './config.ts';

const userRequestCounts = new Map<string, { count: number, resetTime: number }>();

/**
 * Check if user has exceeded rate limit
 * @param userId - User ID to check
 * @returns true if request is allowed, false if rate limited
 */
export function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const windowMs = RATE_LIMIT_CONFIG.windowMs;
  const maxRequests = RATE_LIMIT_CONFIG.maxRequests;
  let userData = userRequestCounts.get(userId);
  if (!userData || now > userData.resetTime) {
    userData = { count: 0, resetTime: now + windowMs };
    userRequestCounts.set(userId, userData);
  }
  if (userData.count >= maxRequests) return false;
  userData.count++;
  return true;
}


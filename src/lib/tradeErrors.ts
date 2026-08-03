/**
 * Human-friendly messages for trade creation failures, especially the
 * database unique constraints that stop duplicate auto-trades.
 */

type SupabaseLikeError = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
} | null | undefined;

const CONSTRAINT_MESSAGES: Record<string, string> = {
  uniq_trade_history_open_per_user_opp:
    'You already have an open trade for this opportunity. Wait for it to finish (or cancel it) before submitting again.',
  uniq_auto_trade_queue_open_per_user:
    'You already have a trade queued or executing. Only one auto-trade can run at a time — it will pick up the next opportunity automatically.',
};

export function describeTradeError(error: SupabaseLikeError, fallback = 'Failed to execute trade'): {
  title: string;
  description: string;
  constraint?: string;
} {
  const blob = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');

  for (const [constraint, description] of Object.entries(CONSTRAINT_MESSAGES)) {
    if (blob.includes(constraint)) {
      return {
        title: 'Duplicate trade blocked',
        description: `${description} (rule: ${constraint})`,
        constraint,
      };
    }
  }

  if (error?.code === '23505') {
    return {
      title: 'Duplicate trade blocked',
      description: `A matching trade already exists, so this one was not created. ${blob}`.trim(),
    };
  }

  if (error?.code === '42501' || blob.toLowerCase().includes('row-level security')) {
    return {
      title: 'Not allowed',
      description: 'Your account is not permitted to create this trade. Check your subscription and exchange settings.',
    };
  }

  return { title: 'Trade Failed', description: error?.message || fallback };
}

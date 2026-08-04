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

export interface TradeErrorContext {
  userId?: string | null;
  opportunityId?: string | null;
  idempotencyKey?: string | null;
}

export interface TradeErrorInfo {
  title: string;
  description: string;
  constraint?: string;
  /** Structured field/value pairs parsed from the Postgres detail line. */
  conflictFields: Record<string, string>;
  userId?: string;
  opportunityId?: string;
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  uniq_trade_history_open_per_user_opp:
    'You already have an open trade for this opportunity. Wait for it to finish (or cancel it) before submitting again.',
  uniq_auto_trade_queue_open_per_user:
    'You already have a trade queued or executing. Only one auto-trade can run at a time — it will pick up the next opportunity automatically.',
};

/**
 * Parses Postgres unique-violation details of the form:
 *   Key (user_id, opportunity_id)=(abc, def) already exists.
 */
export function parseConflictKey(detail?: string | null): Record<string, string> {
  if (!detail) return {};
  const match = detail.match(/Key \(([^)]+)\)=\(([^)]*)\)/);
  if (!match) return {};
  const keys = match[1].split(',').map(k => k.trim());
  const values = match[2].split(',').map(v => v.trim());
  const out: Record<string, string> = {};
  keys.forEach((k, i) => { out[k] = values[i] ?? ''; });
  return out;
}

const short = (v?: string | null) => (v && v.length > 12 ? `${v.slice(0, 8)}…` : v || '');

export function describeTradeError(
  error: SupabaseLikeError,
  fallback = 'Failed to execute trade',
  context: TradeErrorContext = {},
): TradeErrorInfo {
  const blob = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
  const conflictFields = parseConflictKey(error?.details ?? error?.message);

  const userId = conflictFields.user_id || context.userId || undefined;
  const opportunityId =
    conflictFields.opportunity_id || conflictFields.op_id || context.opportunityId || undefined;

  const detailLines = () => {
    const lines: string[] = [];
    if (userId) lines.push(`user_id: ${userId}`);
    if (opportunityId) lines.push(`opportunity_id: ${opportunityId}`);
    Object.entries(conflictFields).forEach(([k, v]) => {
      if (k !== 'user_id' && k !== 'opportunity_id' && k !== 'op_id') lines.push(`${k}: ${v}`);
    });
    if (context.idempotencyKey) lines.push(`idempotency_key: ${short(context.idempotencyKey)}`);
    return lines;
  };

  for (const [constraint, description] of Object.entries(CONSTRAINT_MESSAGES)) {
    if (blob.includes(constraint)) {
      return {
        title: 'Duplicate trade blocked',
        description: [description, `rule: ${constraint}`, ...detailLines()].join('\n'),
        constraint,
        conflictFields,
        userId,
        opportunityId,
      };
    }
  }

  if (error?.code === '23505') {
    return {
      title: 'Duplicate trade blocked',
      description: ['A matching trade already exists, so this one was not created.', ...detailLines(), blob]
        .filter(Boolean)
        .join('\n'),
      conflictFields,
      userId,
      opportunityId,
    };
  }

  if (error?.code === '42501' || blob.toLowerCase().includes('row-level security')) {
    return {
      title: 'Not allowed',
      description: [
        'Your account is not permitted to create this trade. Check your subscription and exchange settings.',
        ...detailLines(),
      ].join('\n'),
      conflictFields,
      userId,
      opportunityId,
    };
  }

  return {
    title: 'Trade Failed',
    description: error?.message || fallback,
    conflictFields,
    userId,
    opportunityId,
  };
}

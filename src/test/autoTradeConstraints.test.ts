import { describe, it, expect, beforeEach } from "vitest";
import { describeTradeError, parseConflictKey } from "@/lib/tradeErrors";

/**
 * In-memory model of the two unique partial indexes that guard auto-trades:
 *   uniq_trade_history_open_per_user_opp  -> one open trade per (user_id, opportunity_id)
 *   uniq_auto_trade_queue_open_per_user   -> one open queue entry per user_id
 * The tests below exercise concurrent creation and scheduler runs against it.
 */

type PgError = { code: string; message: string; details: string };

const OPEN_TRADE = ["pending", "executing"];
const OPEN_QUEUE = ["queued", "processing", "executing"];

class FakeDb {
  trades: { id: string; user_id: string; opportunity_id: string; status: string }[] = [];
  queue: { id: string; user_id: string; opportunity_id: string; status: string }[] = [];
  private seq = 0;

  private uniqueViolation(constraint: string, keys: string[], values: string[]): PgError {
    return {
      code: "23505",
      message: `duplicate key value violates unique constraint "${constraint}"`,
      details: `Key (${keys.join(", ")})=(${values.join(", ")}) already exists.`,
    };
  }

  insertTrade(user_id: string, opportunity_id: string, status = "pending") {
    if (
      OPEN_TRADE.includes(status) &&
      this.trades.some(
        (t) => t.user_id === user_id && t.opportunity_id === opportunity_id && OPEN_TRADE.includes(t.status),
      )
    ) {
      throw this.uniqueViolation("uniq_trade_history_open_per_user_opp", ["user_id", "opportunity_id"], [
        user_id,
        opportunity_id,
      ]);
    }
    const row = { id: `t${++this.seq}`, user_id, opportunity_id, status };
    this.trades.push(row);
    return row;
  }

  insertQueue(user_id: string, opportunity_id: string, status = "queued") {
    if (
      OPEN_QUEUE.includes(status) &&
      this.queue.some((q) => q.user_id === user_id && OPEN_QUEUE.includes(q.status))
    ) {
      throw this.uniqueViolation("uniq_auto_trade_queue_open_per_user", ["user_id"], [user_id]);
    }
    const row = { id: `q${++this.seq}`, user_id, opportunity_id, status };
    this.queue.push(row);
    return row;
  }
}

/** Mimics one scheduler cycle: queue one opportunity per eligible user, then materialise trades. */
async function runSchedulerCycle(db: FakeDb, users: string[], opportunityId: string) {
  let queued = 0;
  let failed = 0;
  await Promise.all(
    users.map(async (u) => {
      try {
        db.insertQueue(u, opportunityId);
        queued++;
      } catch {
        failed++;
      }
    }),
  );

  let succeeded = 0;
  for (const entry of db.queue.filter((q) => q.status === "queued")) {
    try {
      db.insertTrade(entry.user_id, entry.opportunity_id);
      entry.status = "completed";
      succeeded++;
    } catch {
      entry.status = "failed";
      failed++;
    }
  }
  return { queued, succeeded, failed };
}

describe("unique constraints prevent duplicate auto-trades", () => {
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb();
  });

  it("blocks concurrent trade creation for the same user + opportunity", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 10 }, async () => {
        try {
          db.insertTrade("user-1", "opp-1");
          return "ok";
        } catch (e) {
          return (e as PgError).message;
        }
      }),
    );

    expect(attempts.filter((a) => a === "ok")).toHaveLength(1);
    expect(db.trades).toHaveLength(1);
    expect(attempts.filter((a) => a.includes("uniq_trade_history_open_per_user_opp"))).toHaveLength(9);
  });

  it("allows a new trade once the previous one is closed", () => {
    const first = db.insertTrade("user-1", "opp-1");
    expect(() => db.insertTrade("user-1", "opp-1")).toThrow();
    first.status = "completed";
    expect(() => db.insertTrade("user-1", "opp-1")).not.toThrow();
    expect(db.trades).toHaveLength(2);
  });

  it("allows different users to trade the same opportunity", () => {
    db.insertTrade("user-1", "opp-1");
    db.insertTrade("user-2", "opp-1");
    expect(db.trades).toHaveLength(2);
  });

  it("blocks a second open queue entry per user", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, async (_, i) => {
        try {
          db.insertQueue("user-1", `opp-${i}`);
          return "ok";
        } catch {
          return "blocked";
        }
      }),
    );
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(db.queue).toHaveLength(1);
  });

  it("keeps overlapping scheduler runs idempotent", async () => {
    const users = ["u1", "u2", "u3"];
    const [a, b] = await Promise.all([
      runSchedulerCycle(db, users, "opp-x"),
      runSchedulerCycle(db, users, "opp-x"),
    ]);

    expect(a.queued + b.queued).toBe(users.length);
    expect(db.trades).toHaveLength(users.length);
    users.forEach((u) => {
      expect(db.trades.filter((t) => t.user_id === u)).toHaveLength(1);
    });
  });
});

describe("describeTradeError structured output", () => {
  it("parses the conflicting key fields from the Postgres detail line", () => {
    expect(parseConflictKey("Key (user_id, opportunity_id)=(u-1, o-2) already exists.")).toEqual({
      user_id: "u-1",
      opportunity_id: "o-2",
    });
  });

  it("surfaces user_id and opportunity_id for a constraint violation", () => {
    const info = describeTradeError({
      code: "23505",
      message: 'duplicate key value violates unique constraint "uniq_trade_history_open_per_user_opp"',
      details: "Key (user_id, opportunity_id)=(u-1, o-2) already exists.",
    });

    expect(info.constraint).toBe("uniq_trade_history_open_per_user_opp");
    expect(info.userId).toBe("u-1");
    expect(info.opportunityId).toBe("o-2");
    expect(info.description).toContain("user_id: u-1");
    expect(info.description).toContain("opportunity_id: o-2");
  });

  it("falls back to caller-supplied context when the detail line is absent", () => {
    const info = describeTradeError(
      { code: "23505", message: "duplicate key value violates unique constraint" },
      undefined,
      { userId: "ctx-user", opportunityId: "ctx-opp" },
    );
    expect(info.userId).toBe("ctx-user");
    expect(info.description).toContain("opportunity_id: ctx-opp");
  });
});

import type { Database } from "@uptimewatch/db";
import { schema } from "@uptimewatch/db";
import { and, asc, inArray, isNull, lte, sql } from "drizzle-orm";

const { outboxEvents } = schema;

export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type Publisher = (event: OutboxEvent) => Promise<void>;

export const MAX_BACKOFF_SECONDS = 300;
export const backoffSeconds = (attempts: number) => Math.min(2 ** attempts, MAX_BACKOFF_SECONDS);

/**
 * Publishes pending outbox events. Rows are locked with SKIP LOCKED, so several dispatchers can run.
 * Delivery is at-least-once: a crash after publishing but before commit re-publishes the event,
 * which consumers absorb (deterministic job ids + idempotent processing).
 */
export async function dispatchOutbox(
  db: Database,
  publish: Publisher,
  { now = new Date(), batchSize = 200 }: { now?: Date; batchSize?: number } = {},
): Promise<{ published: number; failed: number }> {
  return db.transaction(async (tx) => {
    const events = await tx
      .select()
      .from(outboxEvents)
      .where(and(isNull(outboxEvents.publishedAt), lte(outboxEvents.availableAt, now)))
      .orderBy(asc(outboxEvents.availableAt))
      .limit(batchSize)
      .for("update", { skipLocked: true });

    const published: string[] = [];
    let failed = 0;
    for (const event of events) {
      try {
        await publish(event);
        published.push(event.id);
      } catch (error) {
        failed++;
        const attempts = event.attempts + 1;
        await tx
          .update(outboxEvents)
          .set({
            attempts,
            lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
            availableAt: new Date(now.getTime() + backoffSeconds(attempts) * 1000),
          })
          .where(sql`${outboxEvents.id} = ${event.id}`);
      }
    }
    if (published.length) {
      await tx.update(outboxEvents).set({ publishedAt: now }).where(inArray(outboxEvents.id, published));
    }
    return { published: published.length, failed };
  });
}

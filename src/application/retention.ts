import type { AppData } from "@/domain/models";

const KEEP_DAYS = 90;

/**
 * Keeps the stored state small (hosted key-value stores cap request size):
 * finished notifications older than 90 days are dropped. Queued ones and the
 * course audit trail are never removed.
 */
export function pruneOldNotifications(data: AppData, now: Date = new Date()): AppData {
  const cutoff = now.getTime() - KEEP_DAYS * 86_400_000;
  const kept = data.notifications.filter((n) => n.status === "queued" || new Date(n.scheduledAt).getTime() >= cutoff);
  return kept.length === data.notifications.length ? data : { ...data, notifications: kept };
}

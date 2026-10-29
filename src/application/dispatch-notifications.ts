import type { AppData, AppNotification } from "@/domain/models";
import { appointmentInstant } from "@/application/notification-planner";

export type SendOutcome =
  | { status: "sent" }
  | { status: "skipped" | "failed"; reason: string };

/** Port for the outbound channel (LINE today). Implemented in infrastructure. */
export interface MessageGateway {
  /** `appointmentId` asks the channel to add "confirm" and "reschedule" buttons to the message. */
  send(
    recipientLineId: string,
    text: string,
    options?: { appointmentId?: string; audience?: "patient" | "therapist" },
  ): Promise<SendOutcome>;
  reply?(replyToken: string, text: string): Promise<void>;
  /** The LINE display name of a user, to help staff recognise who asked to be linked. */
  displayName?(lineUserId: string): Promise<string | undefined>;
}

export const ADMIN_RECIPIENT = "admin";
export const MAX_ATTEMPTS = 3;

const TIMED_KINDS = new Set(["appointment-confirmation", "evening-reminder", "lead-reminder", "schedule-change", "manual-reminder"]);

export function resolveRecipients(data: AppData, n: AppNotification): string[] {
  if (n.audience === "admin") return [ADMIN_RECIPIENT];
  if (n.audience === "therapist") {
    const t = data.therapists.find(({ id }) => id === n.recipientId);
    return t?.lineUserId ? [t.lineUserId] : [];
  }
  const p = data.patients.find(({ id }) => id === n.recipientId);
  return [...new Set([p?.lineUserId, p?.relativeLineUserId].filter((x): x is string => Boolean(x)))];
}

/** Why a due message should be dropped instead of sent, or null if it is still relevant. */
function staleReason(data: AppData, n: AppNotification, now: Date): string | null {
  if (!n.appointmentId || !TIMED_KINDS.has(n.kind)) return null;
  const a = data.appointments.find(({ id }) => id === n.appointmentId);
  if (!a) return "ไม่พบนัดหมายแล้ว";
  if (a.status === "ยกเลิก" || a.status === "เสร็จสิ้น" || a.status === "ไม่มาตามนัด") {
    return `นัดหมายอยู่ในสถานะ "${a.status}" แล้ว`;
  }
  if (appointmentInstant(a.date, a.time) <= now) return "เลยเวลานัดแล้ว จึงไม่ส่งข้อความเตือนย้อนหลัง";
  return null;
}

/**
 * Sends every queued notification that is due.
 * - Only marked "sent" once the gateway accepted it for every recipient.
 * - Messages that are no longer relevant (cancelled, past) are skipped, not sent late.
 * - Failures are retried up to MAX_ATTEMPTS, never re-sending to someone who already got it.
 */
export async function dispatchDueNotifications(
  data: AppData,
  gateway: MessageGateway,
  now: Date = new Date(),
): Promise<AppData> {
  const notifications: AppNotification[] = [];
  for (const n of data.notifications) {
    if (n.status !== "queued" || new Date(n.scheduledAt) > now) {
      notifications.push(n);
      continue;
    }
    const stale = staleReason(data, n, now);
    if (stale) {
      notifications.push({ ...n, status: "skipped", detail: stale });
      continue;
    }
    const recipients = resolveRecipients(data, n);
    if (!recipients.length) {
      notifications.push({ ...n, status: "skipped", detail: "ผู้รับยังไม่ได้ผูกบัญชี LINE" });
      continue;
    }

    const delivered = new Set(n.deliveredTo ?? []);
    const pending = recipients.filter((to) => !delivered.has(to));
    // Messages about a booking carry the confirm/reschedule buttons (not cancellations or admin alerts).
    const options =
      n.appointmentId && n.audience !== "admin" && TIMED_KINDS.has(n.kind)
        ? { appointmentId: n.appointmentId, audience: n.audience }
        : undefined;
    const outcomes = await Promise.all(pending.map(async (to) => ({ to, outcome: await gateway.send(to, n.message, options) })));
    for (const { to, outcome } of outcomes) if (outcome.status === "sent") delivered.add(to);

    const failed = outcomes.find(({ outcome }) => outcome.status === "failed");
    const skipped = outcomes.find(({ outcome }) => outcome.status === "skipped");
    const reason = (o?: { outcome: SendOutcome }) => (o && o.outcome.status !== "sent" ? o.outcome.reason : undefined);

    if (failed) {
      const attempts = (n.attempts ?? 0) + 1;
      notifications.push({
        ...n,
        attempts,
        deliveredTo: [...delivered],
        status: attempts >= MAX_ATTEMPTS ? "failed" : "queued",
        detail: `ส่งไม่สำเร็จ (ครั้งที่ ${attempts}/${MAX_ATTEMPTS}): ${reason(failed)}`,
      });
    } else if (skipped) {
      // Channel not configured: keep the item visible rather than claiming success.
      notifications.push({ ...n, status: "skipped", detail: reason(skipped) });
    } else {
      notifications.push({ ...n, status: "sent", sentAt: now.toISOString(), deliveredTo: [...delivered], detail: undefined });
    }
  }
  return { ...data, notifications };
}

/**
 * Applies the outcome of a dispatch run (computed from `snapshot`) onto the
 * current stored data. Sending takes a while, so users may have changed things
 * meanwhile; only notifications untouched since the snapshot take the new
 * status, and anything else is left exactly as the user last saved it.
 */
export function mergeDispatchResult(fresh: AppData, snapshot: AppData, sent: AppData): AppData {
  const before = new Map(snapshot.notifications.map((n) => [n.id, JSON.stringify(n)]));
  const after = new Map(sent.notifications.map((n) => [n.id, n]));
  const freshIds = new Set(fresh.notifications.map((n) => n.id));
  const freshKeys = new Set(fresh.notifications.map((n) => n.dedupeKey));

  const merged = fresh.notifications.map((n) => {
    const next = after.get(n.id);
    const original = before.get(n.id);
    return next && original !== undefined && JSON.stringify(n) === original ? next : n;
  });
  // Course alerts raised by this run that nobody else created in the meantime.
  for (const n of sent.notifications) {
    if (!before.has(n.id) && !freshIds.has(n.id) && !freshKeys.has(n.dedupeKey)) merged.push(n);
  }
  return { ...fresh, notifications: merged };
}

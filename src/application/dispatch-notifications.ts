import type { AppData, AppNotification } from "@/domain/models";
import { appointmentInstant } from "@/application/notification-planner";

export type SendOutcome =
  | { status: "sent" }
  | { status: "skipped" | "failed"; reason: string };

/** Port for the outbound channel (LINE today). Implemented in infrastructure. */
export interface MessageGateway {
  send(recipientLineId: string, text: string): Promise<SendOutcome>;
  reply?(replyToken: string, text: string): Promise<void>;
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
  return [p?.lineUserId, p?.relativeLineUserId].filter((x): x is string => Boolean(x));
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
    const outcomes = await Promise.all(pending.map(async (to) => ({ to, outcome: await gateway.send(to, n.message) })));
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

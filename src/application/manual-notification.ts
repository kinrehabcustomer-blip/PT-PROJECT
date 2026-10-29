import type { AppData, NotificationAudience } from "@/domain/models";
import type { ActionContext, AppointmentActionResult } from "@/application/appointment-use-cases";
import {
  makeNotification,
  patientMessage,
  therapistMessage,
  withNotifications,
} from "@/application/notification-planner";

export const MANUAL_NOTE_MAX = 300;
const THROTTLE_MS = 60_000;

/**
 * Admin-triggered reminder for one appointment. The messages are queued as due
 * "now"; the caller dispatches them right away so the admin sees the outcome.
 */
export function queueManualReminder(
  data: AppData,
  appointmentId: string,
  input: { audiences: NotificationAudience[]; note?: string },
  ctx: ActionContext = {},
): AppointmentActionResult {
  if (ctx.actor?.role !== "admin") {
    return { ok: false, message: "เฉพาะผู้ดูแลระบบเท่านั้นที่ส่งข้อความแจ้งเตือนเองได้" };
  }
  const now = ctx.now ?? new Date();
  const a = data.appointments.find(({ id }) => id === appointmentId);
  if (!a) return { ok: false, message: "ไม่พบรายการนัดหมาย" };
  if (a.status !== "รอยืนยัน" && a.status !== "ยืนยันแล้ว") {
    return { ok: false, message: "ส่งแจ้งเตือนได้เฉพาะนัดที่ยังไม่เสร็จสิ้นหรือยกเลิก" };
  }
  const audiences = [...new Set(input.audiences)].filter((x): x is "patient" | "therapist" => x === "patient" || x === "therapist");
  if (!audiences.length) return { ok: false, message: "กรุณาเลือกผู้รับอย่างน้อย 1 กลุ่ม" };
  const note = (input.note ?? "").trim();
  if (note.length > MANUAL_NOTE_MAX) return { ok: false, message: `ข้อความเพิ่มเติมต้องไม่เกิน ${MANUAL_NOTE_MAX} ตัวอักษร` };

  const recentlySent = data.notifications.some(
    (n) =>
      n.kind === "manual-reminder" &&
      n.appointmentId === appointmentId &&
      (audiences as NotificationAudience[]).includes(n.audience) &&
      now.getTime() - new Date(n.scheduledAt).getTime() < THROTTLE_MS,
  );
  if (recentlySent) return { ok: false, message: "เพิ่งส่งแจ้งเตือนนัดนี้ไป กรุณารอ 1 นาทีก่อนส่งซ้ำ" };

  const additions = audiences.map((audience) => {
    const base = audience === "patient" ? patientMessage(data, a, "manual-reminder") : therapistMessage(data, a, "manual-reminder");
    return makeNotification({
      kind: "manual-reminder",
      audience,
      recipientId: audience === "patient" ? a.patientId : a.therapistId,
      appointmentId: a.id,
      message: note ? `${base}\nข้อความจากเจ้าหน้าที่: ${note}` : base,
      scheduledAt: now.toISOString(),
    });
  });
  return { ok: true, data: withNotifications(data, additions) };
}

import type {
  AppData,
  AppNotification,
  Appointment,
  NotificationAudience,
  NotificationKind,
  TreatmentCourse,
} from "@/domain/models";
import { remainingSessions } from "@/domain/models";

export const COURSE_ALERT_THRESHOLDS = [3, 1, 0] as const;

export function appointmentInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+07:00`);
}

function previousDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function formatThaiDate(date: string): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "long", timeZone: "Asia/Bangkok" }).format(
    appointmentInstant(date, "12:00"),
  );
}

export function makeNotification(
  base: Omit<AppNotification, "id" | "dedupeKey" | "status">,
): AppNotification {
  const dedupeKey = [
    base.kind,
    base.audience,
    base.recipientId,
    base.appointmentId ?? base.courseId ?? "",
    base.scheduledAt,
  ].join("|");
  return { ...base, id: `n-${dedupeKey}`, dedupeKey, status: "queued" };
}

export function patientMessage(data: AppData, a: Appointment, kind: NotificationKind): string {
  const patient = data.patients.find(({ id }) => id === a.patientId);
  const when = `${formatThaiDate(a.date)} เวลา ${a.time} น.`;
  const where = `${a.location} (${a.address})`;
  const contact = `หากต้องการเลื่อนหรือยกเลิกนัด โปรดติดต่อ ${data.settings.contactPhone}`;
  const head: Record<string, string> = {
    "appointment-confirmation": "ยืนยันนัดหมายกายภาพบำบัด",
    "evening-reminder": "เตือนนัดหมายกายภาพบำบัดพรุ่งนี้",
    "lead-reminder": "เตือนนัดหมายกายภาพบำบัดใกล้ถึงเวลา",
    "schedule-change": "นัดหมายมีการเปลี่ยนแปลง",
    "manual-reminder": "แจ้งเตือนนัดหมายกายภาพบำบัด",
    cancellation: "นัดหมายถูกยกเลิก",
  };
  if (kind === "cancellation") {
    return `${head[kind]}\nผู้ป่วย: ${patient?.name}\nนัดเดิม: ${when}\nบริการ: ${a.serviceName}\n${contact}`;
  }
  return `${head[kind]}\nผู้ป่วย: ${patient?.name}\nวันเวลา: ${when}\nบริการ: ${a.serviceName}\nสถานที่: ${where}\n${contact}`;
}

export function therapistMessage(data: AppData, a: Appointment, kind: NotificationKind): string {
  const patient = data.patients.find(({ id }) => id === a.patientId);
  const when = `${formatThaiDate(a.date)} เวลา ${a.time} น.`;
  const head: Record<string, string> = {
    "appointment-confirmation": "มีนัดหมายใหม่ในตารางงาน",
    "evening-reminder": "ตารางงานพรุ่งนี้",
    "lead-reminder": "เตือนก่อนเข้ารักษา",
    "schedule-change": "นัดหมายมีการเปลี่ยนแปลง",
    "manual-reminder": "แจ้งเตือนนัดหมาย",
    cancellation: "นัดหมายถูกยกเลิก",
  };
  const map = a.mapUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.address)}`;
  return [
    head[kind] ?? "แจ้งนัดหมาย",
    `ผู้ป่วย: ${patient?.name} (${patient?.phone})`,
    `วันเวลา: ${when}`,
    `สถานที่: ${a.location} — ${a.address}`,
    `แผนที่: ${map}`,
    `อาการเบื้องต้น: ${patient?.condition}`,
    kind === "cancellation" ? "" : "กรุณากดยืนยันรับทราบในระบบ",
  ].filter(Boolean).join("\n");
}

/** Notifications generated when an appointment is created or rescheduled. */
export function planAppointmentNotifications(
  data: AppData,
  a: Appointment,
  now: Date,
  initial: "appointment-confirmation" | "schedule-change",
): AppNotification[] {
  const { settings } = data;
  const patient = data.patients.find(({ id }) => id === a.patientId);
  const patientMode = patient?.reminder?.patientReminder ?? settings.patientReminder;
  const patientLeadHours = patient?.reminder?.leadHours ?? settings.leadHours;
  const nowIso = now.toISOString();
  const out: AppNotification[] = [
    makeNotification({
      kind: initial,
      audience: "patient",
      recipientId: a.patientId,
      appointmentId: a.id,
      message: patientMessage(data, a, initial),
      scheduledAt: nowIso,
    }),
  ];
  // The therapist hears about every new or moved booking immediately, so a
  // late booking (after the evening digest) is never missed.
  out.push(
    makeNotification({
      kind: initial,
      audience: "therapist",
      recipientId: a.therapistId,
      appointmentId: a.id,
      message: therapistMessage(data, a, initial),
      scheduledAt: nowIso,
    }),
  );

  const start = appointmentInstant(a.date, a.time);
  const eveningAt = appointmentInstant(previousDay(a.date), settings.eveningTime);
  const leadFor = (hours: number) => (hours > 0 ? new Date(start.getTime() - hours * 3_600_000) : null);
  const therapistLeadAt = leadFor(settings.leadHours);
  const patientLeadAt = leadFor(patientLeadHours);

  const add = (kind: NotificationKind, audience: NotificationAudience, at: Date) => {
    if (at <= now) return;
    const recipientId = audience === "patient" ? a.patientId : a.therapistId;
    out.push(
      makeNotification({
        kind,
        audience,
        recipientId,
        appointmentId: a.id,
        message: audience === "patient" ? patientMessage(data, a, kind) : therapistMessage(data, a, kind),
        scheduledAt: at.toISOString(),
      }),
    );
  };

  // Therapists always get both the evening schedule and the repeat reminder.
  add("evening-reminder", "therapist", eveningAt);
  if (therapistLeadAt) add("lead-reminder", "therapist", therapistLeadAt);
  if (patientMode !== "lead") add("evening-reminder", "patient", eveningAt);
  if (patientMode !== "evening" && patientLeadAt) add("lead-reminder", "patient", patientLeadAt);
  return out;
}

/** Notify patient and therapist that a booking was cancelled. */
export function planCancellationNotifications(
  data: AppData,
  a: Appointment,
  now: Date,
): AppNotification[] {
  const at = now.toISOString();
  return [
    makeNotification({ kind: "cancellation", audience: "patient", recipientId: a.patientId, appointmentId: a.id, message: patientMessage(data, a, "cancellation"), scheduledAt: at }),
    makeNotification({ kind: "cancellation", audience: "therapist", recipientId: a.therapistId, appointmentId: a.id, message: therapistMessage(data, a, "cancellation"), scheduledAt: at }),
  ];
}

/** Admin alert when a course reaches 3, 1 or 0 sessions left. */
export function planCourseAlert(
  data: AppData,
  course: TreatmentCourse,
  now: Date,
): AppNotification[] {
  const remaining = remainingSessions(course);
  if (!(COURSE_ALERT_THRESHOLDS as readonly number[]).includes(remaining)) return [];
  const patient = data.patients.find(({ id }) => id === course.patientId);
  const exhausted = remaining === 0;
  const message = exhausted
    ? `คอร์สของ ${patient?.name} (${course.serviceName}) ใช้ครบ ${course.totalSessions} ครั้งแล้ว กรุณาติดตามการต่อคอร์สหรือเสนอโปรแกรมที่เหมาะสม`
    : `คอร์สของ ${patient?.name} (${course.serviceName}) เหลือ ${remaining} ครั้ง`;
  const n = makeNotification({
    kind: exhausted ? "course-exhausted" : "course-low",
    audience: "admin",
    recipientId: "admin",
    courseId: course.id,
    message,
    scheduledAt: now.toISOString(),
  });
  // One alert per course per remaining-count, however many times it is recomputed.
  const dedupeKey = `${n.kind}|admin|${course.id}|remaining:${remaining}|total:${course.totalSessions}`;
  if (data.notifications.some((x) => x.dedupeKey === dedupeKey)) return [];
  return [{ ...n, id: `n-${dedupeKey}`, dedupeKey }];
}

/** Drop reminders that no longer apply and add the new ones, ignoring duplicates. */
export function withNotifications(
  data: AppData,
  additions: AppNotification[],
  supersedeAppointmentId?: string,
): AppData {
  const kept = data.notifications.map((n) =>
    supersedeAppointmentId &&
    n.appointmentId === supersedeAppointmentId &&
    n.status === "queued" &&
    (n.kind === "evening-reminder" || n.kind === "lead-reminder")
      ? {
          ...n,
          status: "skipped" as const,
          detail: "ยกเลิกเพราะนัดหมายมีการเปลี่ยนแปลง",
          // Free the key so moving the booking back re-creates this reminder.
          dedupeKey: `${n.dedupeKey}|superseded:${additions[0]?.scheduledAt ?? "x"}`,
        }
      : n,
  );
  const known = new Set(kept.map((n) => n.dedupeKey));
  return { ...data, notifications: [...kept, ...additions.filter((n) => !known.has(n.dedupeKey))] };
}

/** Raise alerts for any course already at 3/1/0 left (e.g. data that predates the rule). */
export function syncCourseAlerts(data: AppData, now: Date): AppData {
  let next = data;
  for (const course of data.courses) {
    next = withNotifications(next, planCourseAlert(next, course, now));
  }
  return next;
}

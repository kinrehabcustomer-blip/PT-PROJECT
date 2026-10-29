import type { AppData, User } from "@/domain/models";

const NOTIFICATION_WINDOW_DAYS = 14;

/** The browser only needs to know whether an account is linked, never the LINE id itself. */
const REDACTED = "•";
const redact = (id?: string) => (id ? REDACTED : undefined);

function redactLineIds(data: AppData): AppData {
  return {
    ...data,
    patients: data.patients.map((p) => ({ ...p, lineUserId: redact(p.lineUserId), relativeLineUserId: redact(p.relativeLineUserId) })),
    therapists: data.therapists.map((t) => ({ ...t, lineUserId: redact(t.lineUserId) })),
    linkRequests: data.linkRequests.map((r) => ({ ...r, lineUserId: REDACTED })),
  };
}

/**
 * The screens need a fortnight of history plus anything still tied to an open
 * appointment (its delivery status). Older rows stay in the database but are
 * not sent to the browser on every refresh, so the payload does not grow with time.
 */
export function recentNotifications(data: AppData, now: Date = new Date()): AppData["notifications"] {
  const cutoff = now.getTime() - NOTIFICATION_WINDOW_DAYS * 86_400_000;
  const open = new Set(data.appointments.filter((a) => a.status === "รอยืนยัน" || a.status === "ยืนยันแล้ว").map((a) => a.id));
  return data.notifications.filter(
    (n) => n.status === "queued" || new Date(n.scheduledAt).getTime() >= cutoff || (n.appointmentId !== undefined && open.has(n.appointmentId)),
  );
}

/** What a given user is allowed to see. Therapists only get their own caseload. */
export function viewFor(user: User, data: AppData, now: Date = new Date()): AppData {
  if (user.role === "admin") return redactLineIds({ ...data, notifications: recentNotifications(data, now) });
  if (user.role === "staff") return redactLineIds({ ...data, users: [], notifications: recentNotifications(data, now) });

  // Everyone in the therapist's care, plus anyone they have an appointment with.
  const appointments = data.appointments.filter((a) => a.therapistId === user.therapistId);
  const assignments = data.assignments.filter((a) => a.therapistId === user.therapistId);
  const patientIds = new Set([...appointments.map((a) => a.patientId), ...assignments.map((a) => a.patientId)]);
  return {
    ...data,
    therapists: data.therapists.map(({ lineUserId: _t, ...t }) => t),
    appointments,
    assignments,
    patients: data.patients
      .filter((p) => patientIds.has(p.id))
      .map(({ lineUserId: _l, relativeLineUserId: _r, ...p }) => p),
    courses: data.courses.filter((c) => patientIds.has(c.patientId)),
    notifications: data.notifications.filter((n) => n.audience === "therapist" && n.recipientId === user.therapistId),
    courseAudit: [],
    users: [],
    linkCodes: [],
    linkRequests: [],
  };
}

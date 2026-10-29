import type { AppData, User } from "@/domain/models";

/** What a given user is allowed to see. Therapists only get their own caseload. */
export function viewFor(user: User, data: AppData): AppData {
  if (user.role === "admin") return data;
  if (user.role === "staff") return { ...data, users: [] };

  const appointments = data.appointments.filter((a) => a.therapistId === user.therapistId);
  const patientIds = new Set(appointments.map((a) => a.patientId));
  const courseIds = new Set(appointments.map((a) => a.courseId));
  return {
    ...data,
    appointments,
    patients: data.patients
      .filter((p) => patientIds.has(p.id))
      .map(({ lineUserId: _l, relativeLineUserId: _r, ...p }) => p),
    courses: data.courses.filter((c) => courseIds.has(c.id)),
    notifications: data.notifications.filter((n) => n.audience === "therapist" && n.recipientId === user.therapistId),
    courseAudit: [],
    users: [],
    linkCodes: [],
  };
}

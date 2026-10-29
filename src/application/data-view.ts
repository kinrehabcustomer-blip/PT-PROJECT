import type { AppData, User } from "@/domain/models";

/** What a given user is allowed to see. Therapists only get their own caseload. */
export function viewFor(user: User, data: AppData): AppData {
  if (user.role === "admin") return data;
  if (user.role === "staff") return { ...data, users: [] };

  // Everyone in the therapist's care, plus anyone they have an appointment with.
  const appointments = data.appointments.filter((a) => a.therapistId === user.therapistId);
  const assignments = data.assignments.filter((a) => a.therapistId === user.therapistId);
  const patientIds = new Set([...appointments.map((a) => a.patientId), ...assignments.map((a) => a.patientId)]);
  return {
    ...data,
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

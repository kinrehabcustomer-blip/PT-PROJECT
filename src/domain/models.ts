export type AppointmentStatus =
  | "รอยืนยัน"
  | "ยืนยันแล้ว"
  | "เสร็จสิ้น"
  | "ไม่มาตามนัด"
  | "ยกเลิก";

export type Role = "admin" | "staff" | "therapist";

export interface Actor {
  name: string;
  role: Role;
  /** Set for therapist accounts: the therapist they may act as. */
  therapistId?: string;
}

export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
  therapistId?: string;
  active: boolean;
}

export interface ReminderPreference {
  patientReminder?: "evening" | "lead" | "both";
  leadHours?: 0 | 1 | 2;
}

export type LinkTarget = "patient" | "relative" | "therapist";

export interface LinkCode {
  code: string;
  target: LinkTarget;
  targetId: string;
  expiresAt: string;
}

export interface Patient {
  id: string;
  name: string;
  phone: string;
  condition: string;
  lineUserId?: string;
  relativeLineUserId?: string;
  /** Overrides the clinic-wide reminder settings for this patient. */
  reminder?: ReminderPreference;
}

export interface Therapist {
  id: string;
  name: string;
  initials: string;
  color: string;
  phone: string;
  lineUserId?: string;
}

export interface TreatmentCourse {
  id: string;
  patientId: string;
  serviceName: string;
  totalSessions: number;
  usedSessions: number;
  history: CourseHistoryEntry[];
}

export interface CourseHistoryEntry {
  id: string;
  appointmentId: string;
  date: string;
  therapistName: string;
  serviceName: string;
  voided?: boolean;
}

export interface CourseAuditEntry {
  id: string;
  courseId: string;
  at: string;
  actor: string;
  action: "deduct" | "restore" | "adjust-total" | "adjust-used";
  before: { totalSessions: number; usedSessions: number };
  after: { totalSessions: number; usedSessions: number };
  reason: string;
}

export interface Appointment {
  id: string;
  patientId: string;
  therapistId: string;
  courseId: string;
  date: string;
  time: string;
  serviceName: string;
  location: string;
  address: string;
  mapUrl?: string;
  status: AppointmentStatus;
  acknowledged: boolean;
  noShowResolution?: "deducted" | "waived";
}

export type NotificationKind =
  | "appointment-confirmation"
  | "evening-reminder"
  | "lead-reminder"
  | "schedule-change"
  | "manual-reminder"
  | "cancellation"
  | "course-low"
  | "course-exhausted";

export type NotificationAudience = "patient" | "therapist" | "admin";

export interface AppNotification {
  id: string;
  dedupeKey: string;
  kind: NotificationKind;
  audience: NotificationAudience;
  recipientId: string;
  appointmentId?: string;
  courseId?: string;
  message: string;
  scheduledAt: string;
  status: "queued" | "sent" | "failed" | "skipped";
  sentAt?: string;
  detail?: string;
  /** Failed delivery attempts so far; retried until it reaches the limit. */
  attempts?: number;
  /** LINE ids that already received this message, so retries never duplicate it. */
  deliveredTo?: string[];
}

export interface NotificationSettings {
  channel: "LINE";
  eveningTime: string;
  leadHours: 0 | 1 | 2;
  patientReminder: "evening" | "lead" | "both";
  contactPhone: string;
}

export interface AppData {
  patients: Patient[];
  therapists: Therapist[];
  courses: TreatmentCourse[];
  appointments: Appointment[];
  notifications: AppNotification[];
  courseAudit: CourseAuditEntry[];
  settings: NotificationSettings;
  users: User[];
  linkCodes: LinkCode[];
}

export interface DashboardAppointment extends Appointment {
  patient: Patient;
  therapist: Therapist;
  course: TreatmentCourse;
}

export function remainingSessions(course: TreatmentCourse): number {
  return course.totalSessions - course.usedSessions;
}

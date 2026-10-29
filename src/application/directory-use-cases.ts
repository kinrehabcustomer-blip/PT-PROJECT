import type {
  AppData,
  LinkTarget,
  Patient,
  ReminderPreference,
  Role,
  Therapist,
  TreatmentCourse,
  User,
} from "@/domain/models";
import type { ActionContext, AppointmentActionResult } from "@/application/appointment-use-cases";
import { planCourseAlert, withNotifications } from "@/application/notification-planner";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const CODE_TTL_MS = 24 * 3_600_000;
const COLORS = ["violet", "blue", "rose"];

const newId = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID().slice(0, 8)}`;

function isFrontDesk(ctx: ActionContext): boolean {
  return ctx.actor?.role === "admin" || ctx.actor?.role === "staff";
}
const DENIED = "เฉพาะเจ้าหน้าที่และผู้ดูแลระบบเท่านั้นที่ดำเนินการนี้ได้";
const DENIED_ADMIN = "เฉพาะผู้ดูแลระบบเท่านั้นที่ดำเนินการนี้ได้";

function cleanPhone(value: string): string {
  return value.trim();
}

export interface PatientInput {
  name: string;
  phone: string;
  condition: string;
  reminder?: ReminderPreference;
}

function validatePatient(input: PatientInput): string | null {
  if (!input.name.trim()) return "กรุณาระบุชื่อผู้รับบริการ";
  if (input.name.length > 120 || input.condition.length > 500) return "ชื่อหรืออาการยาวเกินไป";
  if (!/^[0-9+\-\s]{8,20}$/.test(input.phone.trim())) return "เบอร์โทรไม่ถูกต้อง";
  if (input.reminder?.leadHours !== undefined && ![0, 1, 2].includes(input.reminder.leadHours)) {
    return "ต้องเลือกเตือนก่อนนัด 0, 1 หรือ 2 ชั่วโมง";
  }
  return null;
}

export function createPatient(data: AppData, input: PatientInput, ctx: ActionContext = {}): AppointmentActionResult {
  if (!isFrontDesk(ctx)) return { ok: false, message: DENIED };
  const error = validatePatient(input);
  if (error) return { ok: false, message: error };
  const patient: Patient = {
    id: newId("p"),
    name: input.name.trim(),
    phone: cleanPhone(input.phone),
    condition: input.condition.trim(),
    reminder: input.reminder,
  };
  return { ok: true, data: { ...data, patients: [...data.patients, patient] } };
}

export function updatePatient(
  data: AppData,
  patientId: string,
  input: PatientInput,
  ctx: ActionContext = {},
): AppointmentActionResult {
  if (!isFrontDesk(ctx)) return { ok: false, message: DENIED };
  if (!data.patients.some(({ id }) => id === patientId)) return { ok: false, message: "ไม่พบผู้รับบริการ" };
  const error = validatePatient(input);
  if (error) return { ok: false, message: error };
  return {
    ok: true,
    data: {
      ...data,
      patients: data.patients.map((p) =>
        p.id === patientId
          ? { ...p, name: input.name.trim(), phone: cleanPhone(input.phone), condition: input.condition.trim(), reminder: input.reminder }
          : p,
      ),
    },
  };
}

/** Start a new course (first purchase or renewal) for a patient. */
export function createCourse(
  data: AppData,
  input: { patientId: string; serviceName: string; totalSessions: number },
  ctx: ActionContext = {},
): AppointmentActionResult {
  if (!isFrontDesk(ctx)) return { ok: false, message: DENIED };
  if (!data.patients.some(({ id }) => id === input.patientId)) return { ok: false, message: "ไม่พบผู้รับบริการ" };
  if (!input.serviceName.trim()) return { ok: false, message: "กรุณาระบุประเภทบริการ" };
  if (!Number.isInteger(input.totalSessions) || input.totalSessions < 1 || input.totalSessions > 200) {
    return { ok: false, message: "จำนวนครั้งต้องเป็นจำนวนเต็ม 1–200" };
  }
  const course: TreatmentCourse = {
    id: newId("c"),
    patientId: input.patientId,
    serviceName: input.serviceName.trim(),
    totalSessions: input.totalSessions,
    usedSessions: 0,
    history: [],
  };
  const next = { ...data, courses: [...data.courses, course] };
  return { ok: true, data: withNotifications(next, planCourseAlert(next, course, ctx.now ?? new Date())) };
}

export function createTherapist(
  data: AppData,
  input: { name: string; phone: string },
  ctx: ActionContext = {},
): AppointmentActionResult {
  if (ctx.actor?.role !== "admin") return { ok: false, message: DENIED_ADMIN };
  const name = input.name.trim();
  if (!name) return { ok: false, message: "กรุณาระบุชื่อนักกายภาพบำบัด" };
  if (name.length > 80) return { ok: false, message: "ชื่อยาวเกินไป" };
  if (!/^[0-9+\-\s]{8,20}$/.test(input.phone.trim())) return { ok: false, message: "เบอร์โทรไม่ถูกต้อง" };
  const therapist: Therapist = {
    id: newId("t"),
    name,
    initials: [...name.replace(/^กภ\.?\s*/, "")].slice(0, 2).join(""),
    color: COLORS[data.therapists.length % COLORS.length],
    phone: cleanPhone(input.phone),
  };
  return { ok: true, data: { ...data, therapists: [...data.therapists, therapist] } };
}

export function createUser(
  data: AppData,
  input: { username: string; name: string; role: Role; therapistId?: string },
  ctx: ActionContext = {},
): AppointmentActionResult & { user?: User } {
  if (ctx.actor?.role !== "admin") return { ok: false, message: DENIED_ADMIN };
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    return { ok: false, message: "ชื่อผู้ใช้ต้องเป็นอักษรอังกฤษ/ตัวเลข 3–32 ตัว" };
  }
  if (!input.name.trim() || input.name.length > 80) return { ok: false, message: "กรุณาระบุชื่อ (ไม่เกิน 80 ตัวอักษร)" };
  if (!["admin", "staff", "therapist"].includes(input.role)) return { ok: false, message: "บทบาทไม่ถูกต้อง" };
  if (data.users.some((u) => u.username === username)) return { ok: false, message: "ชื่อผู้ใช้นี้ถูกใช้แล้ว" };
  if (input.role === "therapist") {
    if (!data.therapists.some(({ id }) => id === input.therapistId)) {
      return { ok: false, message: "บัญชีนักกายภาพต้องเลือกนักกายภาพที่เชื่อมกัน" };
    }
  }
  const user: User = {
    id: newId("u"),
    username,
    name: input.name.trim(),
    role: input.role,
    therapistId: input.role === "therapist" ? input.therapistId : undefined,
    active: true,
  };
  return { ok: true, data: { ...data, users: [...data.users, user] }, user };
}

export function setUserActive(
  data: AppData,
  userId: string,
  active: boolean,
  ctx: ActionContext = {},
): AppointmentActionResult {
  if (ctx.actor?.role !== "admin") return { ok: false, message: DENIED_ADMIN };
  const user = data.users.find(({ id }) => id === userId);
  if (!user) return { ok: false, message: "ไม่พบผู้ใช้งาน" };
  if (!active && user.role === "admin" && data.users.filter((u) => u.role === "admin" && u.active).length <= 1) {
    return { ok: false, message: "ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน" };
  }
  return { ok: true, data: { ...data, users: data.users.map((u) => (u.id === userId ? { ...u, active } : u)) } };
}

function randomCode(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return "PT-" + [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** One-time code the person sends to the LINE official account to link their account. */
export function issueLinkCode(
  data: AppData,
  target: LinkTarget,
  targetId: string,
  ctx: ActionContext = {},
): AppointmentActionResult & { code?: string } {
  if (!isFrontDesk(ctx)) return { ok: false, message: DENIED };
  const exists =
    target === "therapist"
      ? data.therapists.some(({ id }) => id === targetId)
      : data.patients.some(({ id }) => id === targetId);
  if (!exists) return { ok: false, message: "ไม่พบผู้รับรหัส" };
  const now = ctx.now ?? new Date();
  const code = randomCode();
  const live = data.linkCodes.filter(
    (c) => new Date(c.expiresAt) > now && !(c.target === target && c.targetId === targetId),
  );
  return {
    ok: true,
    code,
    data: {
      ...data,
      linkCodes: [...live, { code, target, targetId, expiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString() }],
    },
  };
}

/** Called by the LINE webhook with the sender's LINE user id and their message text. */
export function redeemLinkCode(
  data: AppData,
  lineUserId: string,
  text: string,
  now: Date = new Date(),
): { linked: boolean; data: AppData; label?: string } {
  const code = text.trim().toUpperCase();
  const entry = data.linkCodes.find((c) => c.code === code && new Date(c.expiresAt) > now);
  if (!entry) return { linked: false, data };
  const remaining = data.linkCodes.filter((c) => c !== entry);
  if (entry.target === "therapist") {
    const t = data.therapists.find(({ id }) => id === entry.targetId);
    if (!t) return { linked: false, data };
    return {
      linked: true,
      label: t.name,
      data: { ...data, linkCodes: remaining, therapists: data.therapists.map((x) => (x === t ? { ...x, lineUserId } : x)) },
    };
  }
  const p = data.patients.find(({ id }) => id === entry.targetId);
  if (!p) return { linked: false, data };
  const patch = entry.target === "relative" ? { relativeLineUserId: lineUserId } : { lineUserId };
  return {
    linked: true,
    label: p.name,
    data: { ...data, linkCodes: remaining, patients: data.patients.map((x) => (x === p ? { ...x, ...patch } : x)) },
  };
}

export function unlinkLine(
  data: AppData,
  target: LinkTarget,
  targetId: string,
  ctx: ActionContext = {},
): AppointmentActionResult {
  if (!isFrontDesk(ctx)) return { ok: false, message: DENIED };
  if (target === "therapist") {
    return { ok: true, data: { ...data, therapists: data.therapists.map((t) => (t.id === targetId ? { ...t, lineUserId: undefined } : t)) } };
  }
  const field = target === "relative" ? "relativeLineUserId" : "lineUserId";
  return { ok: true, data: { ...data, patients: data.patients.map((p) => (p.id === targetId ? { ...p, [field]: undefined } : p)) } };
}

// --- Which patients are in which therapist's care ---------------------------------------

const careId = (therapistId: string, patientId: string) => `${therapistId}:${patientId}`;

export function assignPatient(
  data: AppData,
  therapistId: string,
  patientId: string,
  ctx: ActionContext = {},
): AppointmentActionResult {
  if (!isFrontDesk(ctx)) return { ok: false, message: DENIED };
  if (!data.therapists.some(({ id }) => id === therapistId)) return { ok: false, message: "ไม่พบนักกายภาพบำบัด" };
  if (!data.patients.some(({ id }) => id === patientId)) return { ok: false, message: "ไม่พบผู้รับบริการ" };
  const id = careId(therapistId, patientId);
  if (data.assignments.some((a) => a.id === id)) {
    return { ok: false, message: "ผู้รับบริการคนนี้อยู่ในความดูแลของนักกายภาพคนนี้แล้ว" };
  }
  return { ok: true, data: { ...data, assignments: [...data.assignments, { id, therapistId, patientId }] } };
}

export function unassignPatient(
  data: AppData,
  therapistId: string,
  patientId: string,
  ctx: ActionContext = {},
): AppointmentActionResult {
  if (!isFrontDesk(ctx)) return { ok: false, message: DENIED };
  const id = careId(therapistId, patientId);
  if (!data.assignments.some((a) => a.id === id)) return { ok: false, message: "ไม่พบรายการนี้ในความดูแล" };
  const open = data.appointments.some(
    (a) => a.therapistId === therapistId && a.patientId === patientId && (a.status === "รอยืนยัน" || a.status === "ยืนยันแล้ว"),
  );
  if (open) return { ok: false, message: "ยังมีนัดหมายที่เปิดอยู่กับนักกายภาพคนนี้ กรุณาเลื่อนหรือยกเลิกนัดก่อนนำออกจากความดูแล" };
  return { ok: true, data: { ...data, assignments: data.assignments.filter((a) => a.id !== id) } };
}

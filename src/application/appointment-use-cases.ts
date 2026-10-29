import type {
  Actor,
  AppData,
  Appointment,
  CourseAuditEntry,
  TreatmentCourse,
} from "@/domain/models";
import { remainingSessions } from "@/domain/models";
import {
  appointmentInstant,
  planAppointmentNotifications,
  planCancellationNotifications,
  planCourseAlert,
  withNotifications,
} from "@/application/notification-planner";

export type AppointmentActionResult =
  | { ok: true; data: AppData }
  | { ok: false; message: string };

export interface ActionContext {
  now?: Date;
  actor?: Actor;
}

const SYSTEM_ACTOR: Actor = { name: "ระบบ", role: "staff" };

const DENIED_SCHEDULING = "เฉพาะเจ้าหน้าที่และผู้ดูแลระบบเท่านั้นที่จัดการนัดหมายได้";

function canSchedule(ctx: ActionContext): boolean {
  return ctx.actor?.role === "admin" || ctx.actor?.role === "staff";
}

/** Admins, or the therapist assigned to this appointment. */
function canServe(ctx: ActionContext, appointment: Appointment): boolean {
  const actor = ctx.actor;
  if (!actor) return false;
  return actor.role === "admin" || (actor.role === "therapist" && actor.therapistId === appointment.therapistId);
}

const DENIED_SERVICE = "เฉพาะนักกายภาพที่รับผิดชอบนัดนี้หรือผู้ดูแลระบบเท่านั้นที่ดำเนินการได้";

export interface NewAppointmentInput {
  patientId: string;
  therapistId: string;
  date: string;
  time: string;
  location: string;
  address: string;
  mapUrl?: string;
  /** Required when the patient has more than one course with sessions left. */
  courseId?: string;
}

export function createAppointment(
  data: AppData,
  input: NewAppointmentInput,
  ctx: ActionContext = {},
): AppointmentActionResult {
  if (!canSchedule(ctx)) return { ok: false, message: DENIED_SCHEDULING };
  const now = ctx.now ?? new Date();
  const patient = data.patients.find(({ id }) => id === input.patientId);
  if (!patient) return { ok: false, message: "ไม่พบผู้รับบริการ" };
  if (!data.therapists.some(({ id }) => id === input.therapistId)) {
    return { ok: false, message: "ไม่พบข้อมูลนักกายภาพบำบัด" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) {
    return { ok: false, message: "วันหรือเวลานัดไม่ถูกต้อง" };
  }
  if (!input.address.trim()) return { ok: false, message: "กรุณาระบุที่อยู่ที่ใช้เข้ารับบริการ" };

  // A session already held by an open appointment is not available for a new booking.
  const held = (courseId: string) =>
    data.appointments.filter((a) => a.courseId === courseId && (a.status === "รอยืนยัน" || a.status === "ยืนยันแล้ว")).length;
  const usable = data.courses.filter((c) => c.patientId === input.patientId && remainingSessions(c) - held(c.id) > 0);
  if (!usable.length) {
    return { ok: false, message: "ผู้รับบริการนี้ไม่มีคอร์สที่เหลือจำนวนครั้งว่าง (อาจมีนัดอื่นจองครบแล้ว)" };
  }
  if (!input.courseId && usable.length > 1) {
    return { ok: false, message: "ผู้รับบริการมีหลายคอร์ส กรุณาเลือกคอร์สที่ต้องการใช้" };
  }
  const course = input.courseId ? usable.find((c) => c.id === input.courseId) : usable[0];
  if (!course) return { ok: false, message: "คอร์สที่เลือกไม่ใช่ของผู้รับบริการนี้ หรือไม่มีจำนวนครั้งเหลือ" };

  const clash = findTherapistClash(data, input.therapistId, input.date, input.time);
  if (clash) return { ok: false, message: "นักกายภาพบำบัดมีนัดหมายอื่นในวันและเวลาเดียวกัน" };

  const appointment: Appointment = {
    id: `a-${now.getTime()}`,
    patientId: input.patientId,
    therapistId: input.therapistId,
    courseId: course.id,
    date: input.date,
    time: input.time,
    serviceName: course.serviceName,
    location: input.location,
    address: input.address.trim(),
    mapUrl: input.mapUrl?.trim() || undefined,
    status: "รอยืนยัน",
    acknowledged: false,
  };
  const next = { ...data, appointments: [...data.appointments, appointment] };
  return {
    ok: true,
    data: withNotifications(
      next,
      planAppointmentNotifications(next, appointment, now, "appointment-confirmation"),
    ),
  };
}

export function rescheduleAppointment(
  data: AppData,
  appointmentId: string,
  change: { date: string; time: string },
  ctx: ActionContext = {},
): AppointmentActionResult {
  if (!canSchedule(ctx)) return { ok: false, message: DENIED_SCHEDULING };
  const now = ctx.now ?? new Date();
  const appointment = data.appointments.find(({ id }) => id === appointmentId);
  if (!appointment) return { ok: false, message: "ไม่พบรายการนัดหมาย" };
  if (appointment.status === "เสร็จสิ้น" || appointment.status === "ยกเลิก") {
    return { ok: false, message: "สถานะนัดหมายนี้ไม่สามารถเลื่อนได้" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(change.date) || !/^\d{2}:\d{2}$/.test(change.time)) {
    return { ok: false, message: "วันหรือเวลานัดไม่ถูกต้อง" };
  }
  if (change.date === appointment.date && change.time === appointment.time) {
    return { ok: false, message: "วันและเวลาใหม่ตรงกับนัดเดิม" };
  }
  if (findTherapistClash(data, appointment.therapistId, change.date, change.time, appointmentId)) {
    return { ok: false, message: "นักกายภาพบำบัดมีนัดหมายอื่นในวันและเวลาเดียวกัน" };
  }

  const moved: Appointment = {
    ...appointment,
    date: change.date,
    time: change.time,
    status: "รอยืนยัน",
    acknowledged: false,
    noShowResolution: undefined,
  };
  const next = updateAppointment(data, appointmentId, () => moved);
  return {
    ok: true,
    data: withNotifications(
      next,
      planAppointmentNotifications(next, moved, now, "schedule-change"),
      appointmentId,
    ),
  };
}

export function acknowledgeAppointment(
  data: AppData,
  appointmentId: string,
  ctx: ActionContext = {},
): AppointmentActionResult {
  const appointment = data.appointments.find(({ id }) => id === appointmentId);
  if (!appointment) return { ok: false, message: "ไม่พบรายการนัดหมาย" };
  if (!canServe(ctx, appointment)) return { ok: false, message: DENIED_SERVICE };
  if (appointment.status !== "รอยืนยัน" && appointment.status !== "ยืนยันแล้ว") {
    return { ok: false, message: "สถานะนัดหมายนี้ไม่สามารถยืนยันรับทราบได้" };
  }

  return {
    ok: true,
    data: updateAppointment(data, appointmentId, (item) => ({
      ...item,
      acknowledged: true,
      status: "ยืนยันแล้ว",
    })),
  };
}

export function completeAppointment(
  data: AppData,
  appointmentId: string,
  ctx: ActionContext = {},
): AppointmentActionResult {
  const appointment = data.appointments.find(({ id }) => id === appointmentId);
  if (!appointment) return { ok: false, message: "ไม่พบรายการนัดหมาย" };
  if (!canServe(ctx, appointment)) return { ok: false, message: DENIED_SERVICE };
  if (appointment.status === "เสร็จสิ้น") {
    return { ok: false, message: "รายการนี้ถูกบันทึกว่าเสร็จสิ้นแล้ว" };
  }
  if (appointment.status === "ยกเลิก") {
    return { ok: false, message: "นัดหมายที่ยกเลิกแล้วไม่สามารถตัดคอร์สได้" };
  }
  if (appointment.status === "ไม่มาตามนัด") {
    return { ok: false, message: "นัดที่ผู้รับบริการไม่มาต้องยืนยันการตัดคอร์สโดยแอดมินก่อน" };
  }

  const deducted = deductSession(data, appointment, ctx, "ให้บริการเรียบร้อย");
  if (!deducted.ok) return deducted;
  return {
    ok: true,
    data: updateAppointment(deducted.data, appointmentId, (item) => ({ ...item, status: "เสร็จสิ้น" })),
  };
}

export function cancelAppointment(
  data: AppData,
  appointmentId: string,
  ctx: ActionContext = {},
): AppointmentActionResult {
  if (!canSchedule(ctx)) return { ok: false, message: DENIED_SCHEDULING };
  const now = ctx.now ?? new Date();
  const appointment = data.appointments.find(({ id }) => id === appointmentId);
  if (!appointment) return { ok: false, message: "ไม่พบรายการนัดหมาย" };
  if (appointment.status === "เสร็จสิ้น") {
    return { ok: false, message: "รายการที่เสร็จสิ้นแล้วไม่สามารถยกเลิกได้" };
  }
  if (appointment.status === "ยกเลิก") {
    return { ok: false, message: "รายการนี้ถูกยกเลิกแล้ว" };
  }
  if (appointment.status === "ไม่มาตามนัด") {
    return { ok: false, message: "นัดที่บันทึกว่าไม่มาตามนัดแล้วไม่สามารถยกเลิกได้ ให้แอดมินเลือกตัดหรือไม่ตัดคอร์ส" };
  }

  const cancelled = updateAppointment(data, appointmentId, (item) => ({
    ...item,
    status: "ยกเลิก",
    acknowledged: false,
  }));
  const updated = cancelled.appointments.find(({ id }) => id === appointmentId) as Appointment;
  return {
    ok: true,
    data: withNotifications(cancelled, planCancellationNotifications(cancelled, updated, now), appointmentId),
  };
}

/** Patient did not show up. The course is untouched until an admin decides. */
export function markNoShow(
  data: AppData,
  appointmentId: string,
  ctx: ActionContext = {},
): AppointmentActionResult {
  const appointment = data.appointments.find(({ id }) => id === appointmentId);
  if (!appointment) return { ok: false, message: "ไม่พบรายการนัดหมาย" };
  if (!canSchedule(ctx) && !canServe(ctx, appointment)) return { ok: false, message: DENIED_SCHEDULING };
  if (appointment.status !== "รอยืนยัน" && appointment.status !== "ยืนยันแล้ว") {
    return { ok: false, message: "สถานะนัดหมายนี้ไม่สามารถบันทึกว่าไม่มาตามนัดได้" };
  }
  return {
    ok: true,
    data: updateAppointment(data, appointmentId, (item) => ({ ...item, status: "ไม่มาตามนัด" })),
  };
}

/** Admin confirms (or waives) the deduction for a no-show, per company policy. */
export function resolveNoShow(
  data: AppData,
  appointmentId: string,
  deduct: boolean,
  ctx: ActionContext = {},
): AppointmentActionResult {
  if (ctx.actor?.role !== "admin") {
    return { ok: false, message: "เฉพาะผู้ดูแลระบบเท่านั้นที่ยืนยันการตัดคอร์สกรณีไม่มาตามนัดได้" };
  }
  const appointment = data.appointments.find(({ id }) => id === appointmentId);
  if (!appointment) return { ok: false, message: "ไม่พบรายการนัดหมาย" };
  if (appointment.status !== "ไม่มาตามนัด" || appointment.noShowResolution) {
    return { ok: false, message: "รายการนี้ไม่อยู่ในสถานะรอยืนยันการตัดคอร์ส" };
  }
  if (!deduct) {
    return {
      ok: true,
      data: updateAppointment(data, appointmentId, (item) => ({ ...item, noShowResolution: "waived" })),
    };
  }
  const deducted = deductSession(data, appointment, ctx, "ไม่มาตามนัด (ตัดตามเงื่อนไขบริษัท)");
  if (!deducted.ok) return deducted;
  return {
    ok: true,
    data: updateAppointment(deducted.data, appointmentId, (item) => ({ ...item, noShowResolution: "deducted" })),
  };
}

function findTherapistClash(
  data: AppData,
  therapistId: string,
  date: string,
  time: string,
  ignoreId?: string,
): Appointment | undefined {
  return data.appointments.find(
    (a) =>
      a.id !== ignoreId &&
      a.therapistId === therapistId &&
      a.date === date &&
      a.time === time &&
      (a.status === "รอยืนยัน" || a.status === "ยืนยันแล้ว"),
  );
}

export function deductSession(
  data: AppData,
  appointment: Appointment,
  ctx: ActionContext,
  reason: string,
): AppointmentActionResult {
  const now = ctx.now ?? new Date();
  const course = data.courses.find(({ id }) => id === appointment.courseId);
  if (!course) return { ok: false, message: "ไม่พบคอร์สการรักษาที่เชื่อมกับนัดนี้" };
  if (remainingSessions(course) <= 0) return { ok: false, message: "คอร์สนี้ถูกใช้ครบจำนวนครั้งแล้ว" };
  const therapist = data.therapists.find(({ id }) => id === appointment.therapistId);
  if (!therapist) return { ok: false, message: "ไม่พบข้อมูลนักกายภาพบำบัด" };

  const updatedCourse: TreatmentCourse = {
    ...course,
    usedSessions: course.usedSessions + 1,
    history: [
      {
        id: `history-${appointment.id}`,
        appointmentId: appointment.id,
        date: `${appointment.date} ${appointment.time}`,
        therapistName: therapist.name,
        serviceName: appointment.serviceName,
      },
      ...course.history,
    ],
  };
  const audit: CourseAuditEntry = {
    id: `audit-${appointment.id}-${now.getTime()}`,
    courseId: course.id,
    at: now.toISOString(),
    actor: (ctx.actor ?? SYSTEM_ACTOR).name,
    action: "deduct",
    before: { totalSessions: course.totalSessions, usedSessions: course.usedSessions },
    after: { totalSessions: updatedCourse.totalSessions, usedSessions: updatedCourse.usedSessions },
    reason,
  };
  const next: AppData = {
    ...data,
    courses: data.courses.map((c) => (c.id === course.id ? updatedCourse : c)),
    courseAudit: [audit, ...data.courseAudit],
  };
  return { ok: true, data: withNotifications(next, planCourseAlert(next, updatedCourse, now)) };
}

function updateAppointment(
  data: AppData,
  appointmentId: string,
  update: (appointment: Appointment) => Appointment,
): AppData {
  return {
    ...data,
    appointments: data.appointments.map((appointment) =>
      appointment.id === appointmentId ? update(appointment) : appointment,
    ),
  };
}

export { appointmentInstant };

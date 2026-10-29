import type { Actor, AppData, CourseAuditEntry } from "@/domain/models";
import { remainingSessions } from "@/domain/models";
import { planCourseAlert, withNotifications } from "@/application/notification-planner";
import type { ActionContext, AppointmentActionResult } from "@/application/appointment-use-cases";

function requireAdmin(actor?: Actor): string | null {
  return actor?.role === "admin" ? null : "เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ไขรายการตัดคอร์สได้";
}

/** Correct a course's totals. Admin only, reason required, always audited. */
export function adjustCourse(
  data: AppData,
  courseId: string,
  change: { totalSessions: number; usedSessions: number; reason: string },
  ctx: ActionContext = {},
): AppointmentActionResult {
  const denied = requireAdmin(ctx.actor);
  if (denied) return { ok: false, message: denied };
  const now = ctx.now ?? new Date();
  const course = data.courses.find(({ id }) => id === courseId);
  if (!course) return { ok: false, message: "ไม่พบคอร์สการรักษา" };
  const { totalSessions, usedSessions } = change;
  if (!Number.isInteger(totalSessions) || !Number.isInteger(usedSessions) || totalSessions < 1 || usedSessions < 0) {
    return { ok: false, message: "จำนวนครั้งต้องเป็นจำนวนเต็ม และจำนวนครั้งทั้งหมดต้องมากกว่า 0" };
  }
  if (usedSessions > totalSessions) {
    return { ok: false, message: "จำนวนครั้งที่ใช้ไปต้องไม่เกินจำนวนครั้งทั้งหมด" };
  }
  if (!change.reason.trim()) return { ok: false, message: "กรุณาระบุเหตุผลในการแก้ไข" };
  if (totalSessions === course.totalSessions && usedSessions === course.usedSessions) {
    return { ok: false, message: "ไม่มีการเปลี่ยนแปลงข้อมูล" };
  }

  const updated = { ...course, totalSessions, usedSessions };
  const audit: CourseAuditEntry = {
    id: `audit-${courseId}-${now.getTime()}`,
    courseId,
    at: now.toISOString(),
    actor: ctx.actor!.name,
    action: totalSessions !== course.totalSessions ? "adjust-total" : "adjust-used",
    before: { totalSessions: course.totalSessions, usedSessions: course.usedSessions },
    after: { totalSessions, usedSessions },
    reason: change.reason.trim(),
  };
  const next: AppData = {
    ...data,
    courses: data.courses.map((c) => (c.id === courseId ? updated : c)),
    courseAudit: [audit, ...data.courseAudit],
  };
  return { ok: true, data: withNotifications(next, planCourseAlert(next, updated, now)) };
}

/** Void one history entry (e.g. recorded by mistake) and give the session back. */
export function voidHistoryEntry(
  data: AppData,
  courseId: string,
  historyId: string,
  reason: string,
  ctx: ActionContext = {},
): AppointmentActionResult {
  const denied = requireAdmin(ctx.actor);
  if (denied) return { ok: false, message: denied };
  const now = ctx.now ?? new Date();
  const course = data.courses.find(({ id }) => id === courseId);
  const entry = course?.history.find(({ id }) => id === historyId);
  if (!course || !entry) return { ok: false, message: "ไม่พบรายการตัดคอร์ส" };
  if (entry.voided) return { ok: false, message: "รายการนี้ถูกยกเลิกไปแล้ว" };
  if (!reason.trim()) return { ok: false, message: "กรุณาระบุเหตุผลในการแก้ไข" };
  if (course.usedSessions <= 0) return { ok: false, message: "จำนวนครั้งที่ใช้ไปเป็น 0 อยู่แล้ว" };

  const updated = {
    ...course,
    usedSessions: course.usedSessions - 1,
    history: course.history.map((h) => (h.id === historyId ? { ...h, voided: true } : h)),
  };
  const audit: CourseAuditEntry = {
    id: `audit-${historyId}-${now.getTime()}`,
    courseId,
    at: now.toISOString(),
    actor: ctx.actor!.name,
    action: "restore",
    before: { totalSessions: course.totalSessions, usedSessions: course.usedSessions },
    after: { totalSessions: updated.totalSessions, usedSessions: updated.usedSessions },
    reason: reason.trim(),
  };
  return {
    ok: true,
    data: {
      ...data,
      courses: data.courses.map((c) => (c.id === courseId ? updated : c)),
      courseAudit: [audit, ...data.courseAudit],
    },
  };
}

export function coursesNeedingAttention(data: AppData) {
  return data.courses.filter((course) => remainingSessions(course) <= 3);
}

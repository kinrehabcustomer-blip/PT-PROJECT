import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completeAppointment,
  createAppointment,
  markNoShow,
  rescheduleAppointment,
  resolveNoShow,
  cancelAppointment,
} from "../src/application/appointment-use-cases";
import { adjustCourse, voidHistoryEntry } from "../src/application/course-use-cases";
import { dispatchDueNotifications } from "../src/application/dispatch-notifications";
import { seedData } from "../src/infrastructure/repositories/seed-data";
import type { AppData } from "../src/domain/models";

const admin = { name: "แอดมิน", role: "admin" as const };
const staff = { name: "เจ้าหน้าที่", role: "staff" as const };
const now = new Date("2026-10-29T03:00:00Z"); // 10:00 Bangkok

function ok(r: { ok: boolean; data?: AppData; message?: string }): AppData {
  assert.equal(r.ok, true, r.message);
  return r.data as AppData;
}

const input = { patientId: "p-4", therapistId: "t-3", date: "2026-10-31", time: "10:00", location: "คลินิก", address: "บางนา" };

test("creating an appointment queues confirmation, evening and lead reminders", () => {
  const data = ok(createAppointment(seedData, input, { now, actor: staff }));
  const kinds = data.notifications.map((n) => `${n.kind}:${n.audience}`).sort();
  assert.deepEqual(kinds, [
    "appointment-confirmation:patient",
    "appointment-confirmation:therapist",
    "evening-reminder:patient",
    "evening-reminder:therapist",
    "lead-reminder:patient",
    "lead-reminder:therapist",
  ]);
  const evening = data.notifications.find((n) => n.kind === "evening-reminder");
  assert.equal(evening?.scheduledAt, "2026-10-30T11:00:00.000Z"); // 18:00 Bangkok the day before
  const lead = data.notifications.find((n) => n.kind === "lead-reminder");
  assert.equal(lead?.scheduledAt, "2026-10-31T01:00:00.000Z"); // 08:00 Bangkok, 2h before
});

test("therapist message carries phone, address, map and condition", () => {
  const data = ok(createAppointment(seedData, input, { now, actor: staff }));
  const msg = data.notifications.find((n) => n.audience === "therapist")!.message;
  assert.match(msg, /086|095/);
  assert.match(msg, /บางนา/);
  assert.match(msg, /google\.com\/maps/);
  assert.match(msg, /กายภาพบำบัดทั่วไป/);
});

test("double-booking the same therapist and slot is rejected", () => {
  const first = ok(createAppointment(seedData, input, { now, actor: staff }));
  const second = createAppointment(first, { ...input, patientId: "p-1" }, { now, actor: staff });
  assert.equal(second.ok, false);
});

test("rescheduling supersedes old reminders, resets acknowledgement and notifies both sides", () => {
  const created = ok(createAppointment(seedData, input, { now, actor: staff }));
  const id = created.appointments.at(-1)!.id;
  const moved = ok(rescheduleAppointment(created, id, { date: "2026-11-02", time: "14:00" }, { now, actor: staff }));
  const appt = moved.appointments.find((a) => a.id === id)!;
  assert.equal(appt.status, "รอยืนยัน");
  assert.equal(appt.acknowledged, false);
  assert.equal(moved.notifications.filter((n) => n.kind === "schedule-change").length, 2);
  const oldQueued = moved.notifications.filter((n) => n.status === "queued" && n.scheduledAt.startsWith("2026-10-30"));
  assert.equal(oldQueued.length, 0);
});

test("cancelling notifies patient and therapist and never deducts", () => {
  const data = ok(cancelAppointment(seedData, "a-1", { now, actor: staff }));
  assert.equal(data.notifications.filter((n) => n.kind === "cancellation").length, 2);
  assert.equal(data.courses.find((c) => c.id === "c-1")!.usedSessions, 7);
});

test("a no-show does not deduct until an admin decides; staff cannot decide", () => {
  const flagged = ok(markNoShow(seedData, "a-1", { actor: staff }));
  assert.equal(flagged.courses.find((c) => c.id === "c-1")!.usedSessions, 7);
  assert.equal(completeAppointment(flagged, "a-1", { actor: admin }).ok, false);
  assert.equal(resolveNoShow(flagged, "a-1", true, { actor: staff, now }).ok, false);

  const deducted = ok(resolveNoShow(flagged, "a-1", true, { actor: admin, now }));
  assert.equal(deducted.courses.find((c) => c.id === "c-1")!.usedSessions, 8);
  assert.equal(resolveNoShow(deducted, "a-1", true, { actor: admin, now }).ok, false);

  const waived = ok(resolveNoShow(flagged, "a-1", false, { actor: admin, now }));
  assert.equal(waived.courses.find((c) => c.id === "c-1")!.usedSessions, 7);
});

test("admin is alerted at 3, 1 and 0 sessions left, once each", () => {
  // c-1: 10 total, 7 used -> completing a-1 leaves 2 (no alert). c-2 has 1 left -> 0.
  const atZero = ok(completeAppointment(seedData, "a-2", { now, actor: admin }));
  assert.equal(atZero.notifications.filter((n) => n.kind === "course-exhausted").length, 1);
  const adjusted = ok(adjustCourse(seedData, "c-4", { totalSessions: 10, usedSessions: 7, reason: "แก้ไขข้อมูล" }, { actor: admin, now }));
  assert.equal(adjusted.notifications.filter((n) => n.kind === "course-low").length, 1);
});

test("course deduction writes an audit entry", () => {
  const data = ok(completeAppointment(seedData, "a-1", { now, actor: admin }));
  assert.equal(data.courseAudit[0].action, "deduct");
  assert.equal(data.courseAudit[0].after.usedSessions, 8);
});

test("only admins can adjust or void, with a reason, and edits are audited", () => {
  const change = { totalSessions: 20, usedSessions: 7, reason: "ต่อคอร์ส" };
  assert.equal(adjustCourse(seedData, "c-1", change, { actor: staff, now }).ok, false);
  assert.equal(adjustCourse(seedData, "c-1", { ...change, reason: " " }, { actor: admin, now }).ok, false);
  assert.equal(adjustCourse(seedData, "c-1", { ...change, usedSessions: 25 }, { actor: admin, now }).ok, false);
  const data = ok(adjustCourse(seedData, "c-1", change, { actor: admin, now }));
  assert.equal(data.courses.find((c) => c.id === "c-1")!.totalSessions, 20);
  assert.equal(data.courseAudit[0].reason, "ต่อคอร์ส");

  assert.equal(voidHistoryEntry(seedData, "c-1", "h-1", "ผิดพลาด", { actor: staff, now }).ok, false);
  const voided = ok(voidHistoryEntry(seedData, "c-1", "h-1", "ผิดพลาด", { actor: admin, now }));
  assert.equal(voided.courses.find((c) => c.id === "c-1")!.usedSessions, 6);
  assert.equal(voidHistoryEntry(voided, "c-1", "h-1", "ซ้ำ", { actor: admin, now }).ok, false);
});

test("dispatch never marks a message sent unless the gateway accepted it", async () => {
  let data = ok(createAppointment(seedData, input, { now, actor: staff }));
  data = {
    ...data,
    patients: data.patients.map((p) => (p.id === "p-4" ? { ...p, lineUserId: "U123" } : p)),
  };
  const sentTo: string[] = [];
  const result = await dispatchDueNotifications(
    data,
    { send: async (to) => { sentTo.push(to); return { status: "sent" }; } },
    now,
  );
  const confirmation = result.notifications.find((n) => n.kind === "appointment-confirmation")!;
  assert.equal(confirmation.status, "sent");
  assert.deepEqual(sentTo, ["U123"]);
  // Future reminders stay queued; therapist has no LINE id so it is skipped, not "sent".
  assert.ok(result.notifications.filter((n) => n.status === "queued").length >= 2);

  const unconfigured = await dispatchDueNotifications(
    data,
    { send: async () => ({ status: "skipped", reason: "no token" }) },
    now,
  );
  assert.equal(unconfigured.notifications.some((n) => n.status === "sent"), false);
});

import {
  createCourse,
  createPatient,
  createUser,
  issueLinkCode,
  redeemLinkCode,
  updatePatient,
} from "../src/application/directory-use-cases";
import { syncCourseAlerts } from "../src/application/notification-planner";
import { viewFor } from "../src/application/data-view";
import { hashPassword, signToken, verifyLineSignature, verifyPassword, verifyToken } from "../src/infrastructure/auth/crypto";
import { createHmac } from "node:crypto";

test("a patient with several courses must choose one; a foreign course is rejected", () => {
  const two = ok(createCourse(seedData, { patientId: "p-4", serviceName: "คอร์สที่ 2", totalSessions: 20 }, { actor: staff, now }));
  const second = two.courses.at(-1)!;
  assert.equal(createAppointment(two, input, { now, actor: staff }).ok, false);
  const chosen = ok(createAppointment(two, { ...input, courseId: second.id }, { now, actor: staff }));
  assert.equal(chosen.appointments.at(-1)!.courseId, second.id);
  assert.equal(createAppointment(two, { ...input, courseId: "c-1" }, { now, actor: staff }).ok, false);
});

test("creating a course validates the size and needs front-desk rights", () => {
  const base = { patientId: "p-1", serviceName: "ต่อคอร์ส", totalSessions: 30 };
  assert.equal(createCourse(seedData, base, { actor: { name: "t", role: "therapist", therapistId: "t-1" } }).ok, false);
  assert.equal(createCourse(seedData, { ...base, totalSessions: 0 }, { actor: staff }).ok, false);
  assert.equal(createCourse(seedData, { ...base, totalSessions: 2.5 }, { actor: staff }).ok, false);
  const data = ok(createCourse(seedData, base, { actor: staff, now }));
  assert.equal(data.courses.at(-1)!.totalSessions, 30);
  assert.equal(data.courses.at(-1)!.usedSessions, 0);
});

test("patients can be added and edited, with per-patient reminder overrides", () => {
  assert.equal(createPatient(seedData, { name: "", phone: "081-111-2222", condition: "" }, { actor: staff }).ok, false);
  assert.equal(createPatient(seedData, { name: "ก", phone: "abc", condition: "" }, { actor: staff }).ok, false);
  const created = ok(createPatient(seedData, { name: "คุณใหม่", phone: "081-111-2222", condition: "ปวดคอ" }, { actor: staff }));
  const id = created.patients.at(-1)!.id;
  const edited = ok(updatePatient(created, id, { name: "คุณใหม่", phone: "081-111-2222", condition: "ปวดคอ", reminder: { patientReminder: "lead", leadHours: 1 } }, { actor: staff }));
  const withAppt = ok(createCourse(edited, { patientId: id, serviceName: "ปวดคอ", totalSessions: 10 }, { actor: staff, now }));
  const booked = ok(createAppointment(withAppt, { ...input, patientId: id }, { now, actor: staff }));
  const patientKinds = booked.notifications.filter((n) => n.audience === "patient").map((n) => n.kind).sort();
  assert.deepEqual(patientKinds, ["appointment-confirmation", "lead-reminder"]); // no evening reminder
  const lead = booked.notifications.find((n) => n.audience === "patient" && n.kind === "lead-reminder")!;
  assert.equal(lead.scheduledAt, "2026-10-31T02:00:00.000Z"); // 1h before 10:00 Bangkok
});

test("a late booking still reaches the therapist immediately", () => {
  const late = new Date("2026-10-29T13:30:00Z"); // 20:30 Bangkok, after the evening digest
  const data = ok(createAppointment(seedData, { ...input, date: "2026-10-30", time: "08:00" }, { now: late, actor: staff }));
  const immediate = data.notifications.find((n) => n.audience === "therapist" && n.kind === "appointment-confirmation");
  assert.equal(immediate?.scheduledAt, late.toISOString());
});

test("syncCourseAlerts raises alerts for existing low courses exactly once", () => {
  const once = syncCourseAlerts(seedData, now);
  const kinds = once.notifications.map((n) => `${n.kind}:${n.courseId}`).sort();
  assert.deepEqual(kinds, ["course-exhausted:c-5", "course-low:c-1", "course-low:c-2", "course-low:c-3"]);
  assert.equal(syncCourseAlerts(once, now).notifications.length, once.notifications.length);
});

test("link codes bind a LINE id once, expire, and never leak to the wrong target", () => {
  const issued = issueLinkCode(seedData, "relative", "p-1", { actor: staff, now });
  assert.equal(issued.ok, true);
  const data = issued.data!;
  const code = issued.code!;
  assert.match(code, /^PT-[A-Z2-9]{6}$/);
  assert.equal(issueLinkCode(seedData, "patient", "nope", { actor: staff, now }).ok, false);
  assert.equal(issueLinkCode(seedData, "patient", "p-1", { actor: { name: "t", role: "therapist" }, now }).ok, false);

  assert.equal(redeemLinkCode(data, "Uabc", "PT-WRONG1", now).linked, false);
  assert.equal(redeemLinkCode(data, "Uabc", code, new Date(now.getTime() + 25 * 3_600_000)).linked, false); // expired
  const r = redeemLinkCode(data, "Uabc", ` ${code.toLowerCase()} `, now);
  assert.equal(r.linked, true);
  assert.equal(r.data.patients.find((p) => p.id === "p-1")!.relativeLineUserId, "Uabc");
  assert.equal(r.data.patients.find((p) => p.id === "p-1")!.lineUserId, undefined);
  assert.equal(redeemLinkCode(r.data, "Uxyz", code, now).linked, false); // single use
});

test("only admins can create users; therapist accounts must point at a therapist", () => {
  const u = { username: "nid", name: "นิด", role: "staff" as const };
  assert.equal(createUser(seedData, u, { actor: staff }).ok, false);
  assert.equal(createUser(seedData, { ...u, username: "A B" }, { actor: admin }).ok, false);
  assert.equal(createUser(seedData, { ...u, role: "therapist" }, { actor: admin }).ok, false);
  const withUser = ok(createUser(seedData, u, { actor: admin }));
  assert.equal(createUser(withUser, u, { actor: admin }).ok, false); // duplicate
});

test("therapists only see their own caseload and no LINE ids or audit", () => {
  const withLine = { ...seedData, patients: seedData.patients.map((p) => ({ ...p, lineUserId: "U1" })) };
  const view = viewFor({ id: "u", username: "u", name: "u", role: "therapist", therapistId: "t-1", active: true }, withLine);
  assert.ok(view.appointments.every((a) => a.therapistId === "t-1"));
  assert.ok(view.patients.every((p) => p.lineUserId === undefined));
  assert.equal(view.users.length + view.linkCodes.length + view.courseAudit.length, 0);
});

test("passwords, session tokens and LINE signatures verify correctly", () => {
  const hash = hashPassword("correct horse battery");
  assert.equal(verifyPassword("correct horse battery", hash), true);
  assert.equal(verifyPassword("wrong", hash), false);
  assert.notEqual(hashPassword("correct horse battery"), hash); // salted

  const token = signToken({ uid: "u1", exp: Date.now() + 60_000 });
  assert.equal(verifyToken(token)?.uid, "u1");
  assert.equal(verifyToken(token.slice(0, -2) + "xx"), null);
  assert.equal(verifyToken(signToken({ uid: "u1", exp: Date.now() - 1 })), null);

  const body = '{"events":[]}';
  const sig = createHmac("sha256", "s3cret").update(body).digest("base64");
  assert.equal(verifyLineSignature(body, sig, "s3cret"), true);
  assert.equal(verifyLineSignature(body + " ", sig, "s3cret"), false);
  assert.equal(verifyLineSignature(body, null, "s3cret"), false);
});

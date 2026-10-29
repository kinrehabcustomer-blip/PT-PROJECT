import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acknowledgeAppointment,
  completeAppointment,
  createAppointment,
  markNoShow,
  rescheduleAppointment,
  resolveNoShow,
} from "../src/application/appointment-use-cases";
import { adjustCourse, voidHistoryEntry } from "../src/application/course-use-cases";
import { planAppointmentNotifications } from "../src/application/notification-planner";
import { seedData } from "../src/infrastructure/repositories/seed-data";
import type { AppData } from "../src/domain/models";

const admin = { name: "แอดมิน", role: "admin" as const };
const staff = { name: "เจ้าหน้าที่", role: "staff" as const };
const now = new Date("2026-10-29T03:00:00Z"); // 10:00 Bangkok
const base = { patientId: "p-4", therapistId: "t-3", date: "2026-11-05", time: "10:00", location: "คลินิก", address: "บางนา" };

function ok(r: { ok: boolean; data?: AppData; message?: string }): AppData {
  assert.equal(r.ok, true, r.message);
  return r.data as AppData;
}

test("impossible calendar dates and clock times are refused, not crashed on", () => {
  for (const [date, time] of [["2026-13-45", "10:00"], ["2026-02-30", "10:00"], ["2026-11-05", "25:00"], ["2026-11-05", "10:99"], ["0000-00-00", "00:00"]]) {
    assert.doesNotThrow(() => createAppointment(seedData, { ...base, date, time }, { now, actor: staff }), `${date} ${time}`);
    assert.equal(createAppointment(seedData, { ...base, date, time }, { now, actor: staff }).ok, false, `${date} ${time}`);
  }
  const booked = ok(createAppointment(seedData, base, { now, actor: staff }));
  const id = booked.appointments.at(-1)!.id;
  assert.equal(rescheduleAppointment(booked, id, { date: "2026-02-30", time: "10:00" }, { now, actor: staff }).ok, false);
  assert.equal(rescheduleAppointment(booked, id, { date: "2026-11-06", time: "24:00" }, { now, actor: staff }).ok, false);
});

test("a no-show that was charged cannot be rescheduled back into a second charge", () => {
  let d = ok(markNoShow(seedData, "a-1", { actor: staff }));
  d = ok(resolveNoShow(d, "a-1", true, { now, actor: admin }));
  assert.equal(d.courses.find((c) => c.id === "c-1")!.usedSessions, 8);
  const again = rescheduleAppointment(d, "a-1", { date: "2026-11-09", time: "10:00" }, { now, actor: staff });
  assert.equal(again.ok, false, "moving a charged no-show would let the same visit be deducted twice");
});

test("a waived no-show can still be rebooked, and then deducts exactly once", () => {
  let d = ok(markNoShow(seedData, "a-1", { actor: staff }));
  d = ok(resolveNoShow(d, "a-1", false, { now, actor: admin }));
  d = ok(rescheduleAppointment(d, "a-1", { date: "2026-11-09", time: "10:00" }, { now, actor: staff }));
  d = ok(completeAppointment(d, "a-1", { now: new Date("2026-11-09T04:00:00Z"), actor: admin }));
  assert.equal(d.courses.find((c) => c.id === "c-1")!.usedSessions, 8);
  assert.equal(d.courses.find((c) => c.id === "c-1")!.history.filter((h) => h.appointmentId === "a-1").length, 1);
});

test("two bookings made in the same millisecond get different ids", () => {
  const first = ok(createAppointment(seedData, base, { now, actor: staff }));
  const second = ok(createAppointment(first, { ...base, patientId: "p-1", therapistId: "t-1", date: "2026-11-06", courseId: "c-1" }, { now, actor: staff }));
  const ids = second.appointments.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, "an id clash would silently overwrite an existing appointment in the database");
});

test("a future day's visit cannot be marked done or as a no-show yet", () => {
  const d = ok(createAppointment(seedData, base, { now, actor: staff }));
  const id = d.appointments.at(-1)!.id;
  assert.equal(completeAppointment(d, id, { now, actor: admin }).ok, false, "deducting a course for a visit that has not happened");
  assert.equal(markNoShow(d, id, { now, actor: staff }).ok, false, "a patient cannot be a no-show before the day");
  // On the day itself, and afterwards, it is allowed.
  assert.equal(completeAppointment(d, id, { now: new Date("2026-11-05T00:30:00Z"), actor: admin }).ok, true);
  assert.equal(markNoShow(d, id, { now: new Date("2026-11-06T09:00:00Z"), actor: staff }).ok, true);
});

test("a patient whose reminder is 'before the visit' still gets one when the clinic-wide lead time is off", () => {
  const data: AppData = {
    ...seedData,
    settings: { ...seedData.settings, leadHours: 0 },
    patients: seedData.patients.map((p) => (p.id === "p-4" ? { ...p, reminder: { patientReminder: "lead" as const } } : p)),
  };
  const a = ok(createAppointment(data, base, { now, actor: staff })).appointments.at(-1)!;
  const kinds = planAppointmentNotifications(data, a, now, "appointment-confirmation").filter((n) => n.audience === "patient").map((n) => n.kind);
  assert.ok(kinds.some((k) => k === "evening-reminder" || k === "lead-reminder"), `patient only gets: ${kinds.join(",")}`);
});

test("course counts can never be edited into a state the history contradicts", () => {
  // c-1 has 7 recorded visits: pretending only 3 were used must be refused (void the entries instead).
  const r = adjustCourse(seedData, "c-1", { totalSessions: 10, usedSessions: 3, reason: "ทดสอบ" }, { actor: admin, now });
  assert.equal(r.ok, false);
});

test("voiding a visit gives the session back and the visit can be booked and deducted again", () => {
  const voided = ok(voidHistoryEntry(seedData, "c-1", "h-1", "ลงผิด", { actor: admin, now }));
  const c = voided.courses.find((x) => x.id === "c-1")!;
  assert.equal(c.usedSessions, 6);
  assert.equal(c.history.filter((h) => !h.voided).length, c.usedSessions, "history and counter stay in step");
});

test("acknowledging twice, or after the visit, is harmless or refused", () => {
  const t = { actor: { name: "t", role: "therapist" as const, therapistId: "t-1" } };
  const once = ok(acknowledgeAppointment(seedData, "a-4", t));
  assert.equal(acknowledgeAppointment(once, "a-4", t).ok, true);
  const done = ok(completeAppointment(once, "a-4", { now, actor: admin }));
  assert.equal(acknowledgeAppointment(done, "a-4", t).ok, false);
});

import { resolveRecipients } from "../src/application/dispatch-notifications";
import { matchKeyword } from "../src/application/line-linking";

test("one LINE account that is both the patient and the relative receives each message once", () => {
  const data: AppData = {
    ...seedData,
    patients: seedData.patients.map((p) => (p.id === "p-1" ? { ...p, lineUserId: "Usame", relativeLineUserId: "Usame" } : p)),
  };
  const n = { id: "n", dedupeKey: "n", kind: "lead-reminder" as const, audience: "patient" as const, recipientId: "p-1", message: "x", scheduledAt: now.toISOString(), status: "queued" as const };
  assert.deepEqual(resolveRecipients(data, n), ["Usame"]);
});

test("a patient whose name begins with the letters กภ is still found as a patient", () => {
  const data: AppData = { ...seedData, patients: [...seedData.patients, { id: "p-kp", name: "คุณกภัทร สุขใจ", phone: "0812345678", condition: "" }] };
  assert.deepEqual(matchKeyword(data, "กภัทร สุขใจ"), { kind: "match", target: "patient", targetId: "p-kp", name: "คุณกภัทร สุขใจ" });
  for (const typed of ["กภ. ธนกร", "กภ.ธนกร", "กภ ธนกร"]) {
    assert.equal((matchKeyword(data, typed) as { targetId?: string }).targetId, "t-2", typed);
  }
});

test("a session still waiting on an admin's no-show decision is not offered to another booking", () => {
  // c-2 has exactly one session left; a-2 holds it. Mark a-2 as a no-show (undecided): the session is not free yet.
  const pending = ok(markNoShow(seedData, "a-2", { now, actor: staff }));
  const r = createAppointment(pending, { ...base, patientId: "p-2", therapistId: "t-3" }, { now, actor: staff });
  assert.equal(r.ok, false);
  // Once the admin waives the charge, the session is free again.
  const waived = ok(resolveNoShow(pending, "a-2", false, { now, actor: admin }));
  assert.equal(createAppointment(waived, { ...base, patientId: "p-2", therapistId: "t-3" }, { now, actor: staff }).ok, true);
});

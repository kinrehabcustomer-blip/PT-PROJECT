import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acknowledgeAppointment,
  cancelAppointment,
  completeAppointment,
  createAppointment,
  markNoShow,
  rescheduleAppointment,
  resolveNoShow,
} from "../src/application/appointment-use-cases";
import { dispatchDueNotifications, type MessageGateway } from "../src/application/dispatch-notifications";
import { seedData } from "../src/infrastructure/repositories/seed-data";
import type { AppData } from "../src/domain/models";

const admin = { name: "แอดมิน", role: "admin" as const };
const staff = { name: "เจ้าหน้าที่", role: "staff" as const };
const t4 = { name: "กภ. วรเทพ", role: "therapist" as const, therapistId: "t-4" };
const now = new Date("2026-10-29T03:00:00Z"); // 10:00 Bangkok

function ok(r: { ok: boolean; data?: AppData; message?: string }): AppData {
  assert.equal(r.ok, true, r.message);
  return r.data as AppData;
}

const booking = { patientId: "p-4", therapistId: "t-3", date: "2026-11-05", time: "10:00", location: "คลินิก", address: "บางนา" };

test("full lifecycle: book → acknowledge → complete deducts once, audited, history recorded", () => {
  let d = ok(createAppointment(seedData, booking, { now, actor: staff }));
  const id = d.appointments.at(-1)!.id;
  d = ok(acknowledgeAppointment(d, id, { actor: { name: "x", role: "therapist", therapistId: "t-3" } }));
  d = ok(completeAppointment(d, id, { now: new Date("2026-11-05T05:00:00Z"), actor: { name: "x", role: "therapist", therapistId: "t-3" } }));
  const c = d.courses.find((x) => x.id === "c-4")!;
  assert.equal(c.usedSessions, 5);
  assert.equal(c.history[0].appointmentId, id);
  assert.equal(d.courseAudit.length, 1);
});

test("rescheduling A → B → A restores the reminders for A", () => {
  let d = ok(createAppointment(seedData, booking, { now, actor: staff }));
  const id = d.appointments.at(-1)!.id;
  d = ok(rescheduleAppointment(d, id, { date: "2026-11-06", time: "10:00" }, { now, actor: staff }));
  d = ok(rescheduleAppointment(d, id, { date: "2026-11-05", time: "10:00" }, { now: new Date(now.getTime() + 1000), actor: staff }));
  const live = d.notifications.filter((n) => n.status === "queued" && n.audience === "patient" && n.kind === "evening-reminder");
  assert.equal(live.length, 1);
  assert.equal(live[0].scheduledAt, "2026-11-04T11:00:00.000Z");
});

test("a no-show that was already deducted cannot then be cancelled", () => {
  let d = ok(markNoShow(seedData, "a-1", { actor: staff }));
  d = ok(resolveNoShow(d, "a-1", true, { now, actor: admin }));
  assert.equal(cancelAppointment(d, "a-1", { now, actor: staff }).ok, false);
});

test("you cannot book more visits than the course has sessions left", () => {
  // c-2 has 1 session left and a-2 already holds it.
  const r = createAppointment(seedData, { ...booking, patientId: "p-2", therapistId: "t-3" }, { now, actor: staff });
  assert.equal(r.ok, false);
  // After cancelling a-2 the session is free to book again.
  const freed = ok(cancelAppointment(seedData, "a-2", { now, actor: staff }));
  assert.equal(createAppointment(freed, { ...booking, patientId: "p-2", therapistId: "t-3" }, { now, actor: staff }).ok, true);
});

test("stale reminders are not sent after the appointment time has passed", async () => {
  const d = ok(createAppointment({ ...seedData, patients: seedData.patients.map((p) => (p.id === "p-4" ? { ...p, lineUserId: "U1" } : p)) }, booking, { now, actor: staff }));
  const sent: string[] = [];
  const gateway: MessageGateway = { send: async (_to, text) => { sent.push(text); return { status: "sent" }; } };
  const weekLater = new Date("2026-11-12T03:00:00Z"); // cron was down for a week
  const out = await dispatchDueNotifications(d, gateway, weekLater);
  assert.equal(sent.length, 0);
  assert.ok(out.notifications.every((n) => n.status !== "sent"));
});

test("reminders for a cancelled appointment are never sent", async () => {
  let d = ok(createAppointment({ ...seedData, patients: seedData.patients.map((p) => (p.id === "p-4" ? { ...p, lineUserId: "U1" } : p)) }, booking, { now, actor: staff }));
  const id = d.appointments.at(-1)!.id;
  d = ok(cancelAppointment(d, id, { now, actor: staff }));
  const sent: string[] = [];
  await dispatchDueNotifications(d, { send: async (_t, text) => { sent.push(text); return { status: "sent" }; } }, new Date("2026-11-05T12:00:00Z"));
  assert.ok(sent.every((s) => s.includes("ยกเลิก")), "only the cancellation notice may go out");
});

test("a failed send is retried, and a recipient who already got it is not messaged twice", async () => {
  let d = ok(createAppointment({
    ...seedData,
    patients: seedData.patients.map((p) => (p.id === "p-4" ? { ...p, lineUserId: "U-patient", relativeLineUserId: "U-relative" } : p)),
  }, booking, { now, actor: staff }));
  const calls: string[] = [];
  let relativeDown = true;
  const gateway: MessageGateway = {
    send: async (to) => {
      calls.push(to);
      return to === "U-relative" && relativeDown ? { status: "failed", reason: "timeout" } : { status: "sent" };
    },
  };
  d = await dispatchDueNotifications(d, gateway, now);
  const first = d.notifications.find((n) => n.kind === "appointment-confirmation" && n.audience === "patient")!;
  assert.equal(first.status, "queued", "failed delivery stays queued for retry");
  relativeDown = false;
  calls.length = 0;
  d = await dispatchDueNotifications(d, gateway, new Date(now.getTime() + 60_000));
  assert.deepEqual(calls.filter((c) => c === "U-patient"), [], "patient must not get a duplicate");
  assert.equal(d.notifications.find((n) => n.id === first.id)!.status, "sent");
});

test("a message that keeps failing is eventually marked failed", async () => {
  let d = ok(createAppointment({ ...seedData, patients: seedData.patients.map((p) => (p.id === "p-4" ? { ...p, lineUserId: "U1" } : p)) }, booking, { now, actor: staff }));
  const gateway: MessageGateway = { send: async () => ({ status: "failed", reason: "down" }) };
  for (let i = 0; i < 4; i++) d = await dispatchDueNotifications(d, gateway, new Date(now.getTime() + i * 60_000));
  const n = d.notifications.find((x) => x.kind === "appointment-confirmation" && x.audience === "patient")!;
  assert.equal(n.status, "failed");
});

test("therapist can acknowledge only their own booking end to end", () => {
  const d = ok(createAppointment(seedData, { ...booking, patientId: "p-6", therapistId: "t-4", courseId: "c-6" }, { now, actor: staff }));
  const id = d.appointments.at(-1)!.id;
  assert.equal(acknowledgeAppointment(d, id, { actor: { ...t4, therapistId: "t-1" } }).ok, false);
  assert.equal(acknowledgeAppointment(d, id, { actor: t4 }).ok, true);
});

import { queueManualReminder } from "../src/application/manual-notification";
import { lineStatus } from "../src/application/line-status";

const linked: AppData = {
  ...seedData,
  patients: seedData.patients.map((p) => (p.id === "p-1" ? { ...p, lineUserId: "U-p1" } : p)),
  therapists: seedData.therapists.map((t) => (t.id === "t-1" ? { ...t, lineUserId: "U-t1" } : t)),
};

test("line status: unlinked → queued → sent, and failure is surfaced", async () => {
  assert.equal(lineStatus(seedData, "a-1", "patient").state, "unlinked");
  const booked = ok(createAppointment(linked, { ...booking, patientId: "p-1", therapistId: "t-1", courseId: "c-1" }, { now, actor: staff }));
  const id = booked.appointments.at(-1)!.id;
  assert.equal(lineStatus(booked, id, "patient").state, "queued");
  assert.equal(lineStatus(booked, id, "therapist").state, "queued");

  const sent = await dispatchDueNotifications(booked, { send: async () => ({ status: "sent" }) }, now);
  const s = lineStatus(sent, id, "patient");
  assert.equal(s.state, "sent");
  assert.ok(s.at);

  const down = await dispatchDueNotifications(booked, { send: async () => ({ status: "failed", reason: "boom" }) }, now);
  assert.equal(lineStatus(down, id, "patient").state, "queued"); // retry pending
  let d = down;
  for (let i = 1; i < 3; i++) d = await dispatchDueNotifications(d, { send: async () => ({ status: "failed", reason: "boom" }) }, new Date(now.getTime() + i * 60_000));
  assert.equal(lineStatus(d, id, "patient").state, "failed");
});

test("manual reminder: admin only, open appointments only, needs an audience, throttled", () => {
  const input = { audiences: ["patient" as const, "therapist" as const], note: "เตรียมผ้าขนหนู" };
  assert.equal(queueManualReminder(linked, "a-1", input, { actor: staff, now }).ok, false);
  assert.equal(queueManualReminder(linked, "a-1", { audiences: [] }, { actor: admin, now }).ok, false);
  assert.equal(queueManualReminder(linked, "a-1", { audiences: ["admin" as never] }, { actor: admin, now }).ok, false);
  assert.equal(queueManualReminder(linked, "a-1", { audiences: ["patient"], note: "x".repeat(301) }, { actor: admin, now }).ok, false);

  const done = ok(markNoShow(linked, "a-1", { actor: staff }));
  assert.equal(queueManualReminder(done, "a-1", input, { actor: admin, now }).ok, false);

  const d = ok(queueManualReminder(linked, "a-1", input, { actor: admin, now }));
  const manual = d.notifications.filter((n) => n.kind === "manual-reminder");
  assert.equal(manual.length, 2);
  assert.ok(manual.every((n) => n.message.includes("เตรียมผ้าขนหนู") && n.scheduledAt === now.toISOString()));
  assert.equal(queueManualReminder(d, "a-1", input, { actor: admin, now: new Date(now.getTime() + 10_000) }).ok, false);
  assert.equal(queueManualReminder(d, "a-1", input, { actor: admin, now: new Date(now.getTime() + 61_000) }).ok, true);
});

test("a manual reminder is delivered immediately and shows as sent", async () => {
  const early = new Date("2026-10-29T01:00:00Z"); // 08:00, two hours before a-1
  const d = ok(queueManualReminder(linked, "a-1", { audiences: ["patient"] }, { actor: admin, now: early }));
  const to: string[] = [];
  const out = await dispatchDueNotifications(d, { send: async (t) => { to.push(t); return { status: "sent" }; } }, early);
  assert.deepEqual(to, ["U-p1"]);
  assert.equal(lineStatus(out, "a-1", "patient").state, "sent");
});

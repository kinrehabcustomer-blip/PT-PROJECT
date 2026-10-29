import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatchDueNotifications, type MessageGateway } from "../src/application/dispatch-notifications";
import { handleAppointmentPostback } from "../src/application/line-responses";
import { makeNotification, withNotifications } from "../src/application/notification-planner";
import { seedData } from "../src/infrastructure/repositories/seed-data";
import type { AppData } from "../src/domain/models";

const now = new Date("2026-10-29T03:00:00Z");
const a = seedData.appointments.find((x) => x.status === "รอยืนยัน")!;
const future = { ...a, date: "2026-12-01", time: "10:00" };
const base: AppData = {
  ...seedData,
  appointments: seedData.appointments.map((x) => (x.id === a.id ? future : x)),
  patients: seedData.patients.map((p) => (p.id === a.patientId ? { ...p, lineUserId: "Upatient", relativeLineUserId: "Urelative" } : p)),
  therapists: seedData.therapists.map((t) => (t.id === a.therapistId ? { ...t, lineUserId: "Utherapist" } : t)),
};
const tap = (lineUserId: string, act: string, datetime?: string, data = base) =>
  handleAppointmentPostback(data, { lineUserId, data: `act=${act}&a=${a.id}`, datetime }, now);

test("a therapist's confirm tap acknowledges the appointment, once", () => {
  const r = tap("Utherapist", "confirm");
  assert.equal(r.data!.appointments.find((x) => x.id === a.id)!.acknowledged, true);
  const again = tap("Utherapist", "confirm", undefined, r.data);
  assert.equal(again.data, undefined);
  assert.match(again.reply, /ไปแล้ว/);
});

test("a patient's confirm tap tells staff, and a double tap does not repeat it", () => {
  const r = tap("Upatient", "confirm");
  const alerts = r.data!.notifications.filter((n) => n.kind === "patient-response");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].audience, "admin");
  const again = tap("Upatient", "confirm", undefined, r.data);
  assert.equal(again.data, undefined);
});

test("a reschedule pick becomes a request to staff and does not move the appointment", () => {
  const r = tap("Urelative", "reschedule", "2026-12-03T14:00");
  assert.equal(r.data!.appointments.find((x) => x.id === a.id)!.date, "2026-12-01");
  const alert = r.data!.notifications.find((n) => n.kind === "patient-response")!;
  assert.match(alert.message, /ขอเลื่อนเป็น/);
  assert.equal(tap("Urelative", "reschedule", "2026-12-03T14:00", r.data).data, undefined);
});

test("bad reschedule picks and strangers are refused without saving anything", () => {
  assert.equal(tap("Upatient", "reschedule", "2026-02-30T10:00").data, undefined);
  assert.equal(tap("Upatient", "reschedule", "2026-10-01T10:00").data, undefined, "in the past");
  assert.equal(tap("Upatient", "reschedule", "2026-12-01T10:00").data, undefined, "same time as now");
  assert.equal(tap("Upatient", "reschedule").data, undefined, "no time picked");
  assert.equal(tap("Ustranger", "confirm").data, undefined);
  assert.equal(tap("Utherapist", "delete").data, undefined);
});

test("only booking messages carry the buttons", async () => {
  const seen: Array<{ kind?: string; appointmentId?: string }> = [];
  const gateway: MessageGateway = { send: async (_to, _text, o) => { seen.push({ appointmentId: o?.appointmentId }); return { status: "sent" }; } };
  const booking = makeNotification({ kind: "evening-reminder", audience: "patient", recipientId: a.patientId, appointmentId: a.id, message: "x", scheduledAt: now.toISOString() });
  const withAlert = withNotifications(tap("Upatient", "confirm").data!, [booking]);
  await dispatchDueNotifications(withAlert, gateway, now);
  assert.ok(seen.some((s) => s.appointmentId === a.id), "booking messages get buttons");
  assert.ok(seen.every((s) => s.appointmentId === undefined || s.appointmentId === a.id));
});

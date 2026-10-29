import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acknowledgeAppointment,
  cancelAppointment,
  completeAppointment,
} from "../src/application/appointment-use-cases";

const SAME_DAY = new Date("2026-10-29T05:00:00Z"); // the day of the demo visits, so results never depend on the real clock
const admin = { now: SAME_DAY, actor: { name: "แอดมิน", role: "admin" as const } };
const therapist1 = { now: SAME_DAY, actor: { name: "กภ.", role: "therapist" as const, therapistId: "t-1" } };
const staff = { now: SAME_DAY, actor: { name: "เจ้าหน้าที่", role: "staff" as const } };
import { seedData } from "../src/infrastructure/repositories/seed-data";

test("completing an appointment deducts exactly one course session and records history", () => {
  const result = completeAppointment(seedData, "a-1", therapist1);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const course = result.data.courses.find(({ id }) => id === "c-1");
  assert.equal(course?.usedSessions, 8);
  assert.equal(course?.history[0]?.appointmentId, "a-1");
  assert.equal(result.data.appointments.find(({ id }) => id === "a-1")?.status, "เสร็จสิ้น");
});

test("a completed appointment cannot deduct the course twice", () => {
  const first = completeAppointment(seedData, "a-1", therapist1);
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = completeAppointment(first.data, "a-1", therapist1);
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.match(second.message, /เสร็จสิ้นแล้ว/);
  assert.equal(first.data.courses.find(({ id }) => id === "c-1")?.usedSessions, 8);
});

test("cancelling an appointment never deducts a course session", () => {
  const result = cancelAppointment(seedData, "a-1", staff);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.courses.find(({ id }) => id === "c-1")?.usedSessions, 7);
  assert.equal(result.data.appointments.find(({ id }) => id === "a-1")?.status, "ยกเลิก");
});

test("acknowledging a pending appointment confirms receipt", () => {
  const result = acknowledgeAppointment(seedData, "a-2", { actor: { name: "กภ.", role: "therapist", therapistId: "t-2" } });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const appointment = result.data.appointments.find(({ id }) => id === "a-2");
  assert.equal(appointment?.acknowledged, true);
  assert.equal(appointment?.status, "ยืนยันแล้ว");
});

test("a full course cannot be deducted", () => {
  const result = completeAppointment(seedData, "a-5", { now: new Date("2026-10-30T05:00:00Z"), actor: { name: "กภ.", role: "therapist", therapistId: "t-2" } });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /ครบจำนวนครั้ง/);
});

test("only the assigned therapist or an admin can acknowledge or complete; staff cannot", () => {
  assert.equal(acknowledgeAppointment(seedData, "a-2", { actor: { name: "x", role: "therapist", therapistId: "t-1" } }).ok, false);
  assert.equal(acknowledgeAppointment(seedData, "a-2", staff).ok, false);
  assert.equal(acknowledgeAppointment(seedData, "a-2").ok, false);
  assert.equal(completeAppointment(seedData, "a-1", staff).ok, false);
  assert.equal(completeAppointment(seedData, "a-1", { actor: { name: "x", role: "therapist", therapistId: "t-2" } }).ok, false);
  assert.equal(completeAppointment(seedData, "a-1", admin).ok, true);
});

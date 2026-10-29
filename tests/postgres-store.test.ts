import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { acknowledgeAppointment, completeAppointment, createAppointment, cancelAppointment } from "../src/application/appointment-use-cases";
import { adjustCourse } from "../src/application/course-use-cases";
import { createPatient, createUser, issueLinkCode } from "../src/application/directory-use-cases";
import { dispatchDueNotifications, mergeDispatchResult } from "../src/application/dispatch-notifications";
import { pruneOldNotifications } from "../src/application/retention";
import { createPostgresRepository, type SqlDb } from "../src/infrastructure/repositories/postgres-repository";
import { seedData } from "../src/infrastructure/repositories/seed-data";
import type { AppData } from "../src/domain/models";

// A real PostgreSQL (WASM build) running the project's own db/schema.sql.
const pg = new PGlite();
const db: SqlDb = {
  query: (text, params) => pg.query(text, params as unknown[]) as never,
  transaction: (fn) => pg.transaction((tx) => fn({ query: (text, params) => tx.query(text, params as unknown[]) as never })),
};
const repo = createPostgresRepository(db);

const admin = { name: "แอดมิน", role: "admin" as const };
const staff = { name: "เจ้าหน้าที่", role: "staff" as const };
const now = new Date("2026-10-29T03:00:00Z");

before(async () => {
  await pg.exec(readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8"));
});

const save = (next: (d: AppData) => AppData) => repo.transact((d) => ({ result: { ok: true as const }, data: next(d) }));
function ok(r: { ok: boolean; data?: AppData; message?: string }): AppData {
  assert.equal(r.ok, true, r.message);
  return r.data as AppData;
}

test("schema is idempotent", async () => {
  await pg.exec(readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8"));
});

test("an empty database serves the demo data until the first save", async () => {
  const d = await repo.loadData();
  assert.equal(d.patients.length, seedData.patients.length);
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM patients")).rows[0] && ((await pg.query("SELECT count(*)::int AS n FROM patients")).rows[0] as { n: number }).n, 0);
});

test("the first save writes everything, and the data round-trips exactly", async () => {
  await save(() => seedData);
  const back = await repo.loadData();
  assert.deepEqual(JSON.parse(JSON.stringify(back)), JSON.parse(JSON.stringify(seedData)));
  assert.equal(back.appointments[0].id, seedData.appointments[0].id, "insertion order preserved");
  assert.equal(back.courses.find((c) => c.id === "c-1")!.history[0].id, "h-1", "history order preserved");
});

test("a use case persists: booking, acknowledging and completing deduct once", async () => {
  const booked = await repo.transact((d) => {
    const r = createAppointment(d, { patientId: "p-4", therapistId: "t-3", date: "2026-11-05", time: "10:00", location: "คลินิก", address: "บางนา" }, { now, actor: staff });
    return { result: r, data: r.ok ? r.data : undefined };
  });
  assert.equal(booked.ok, true);
  let d = await repo.loadData();
  const id = d.appointments.at(-1)!.id;
  assert.ok(d.notifications.length >= 5);

  for (const step of [
    (x: AppData) => acknowledgeAppointment(x, id, { actor: { name: "t", role: "therapist", therapistId: "t-3" } }),
    (x: AppData) => completeAppointment(x, id, { now, actor: admin }),
  ]) {
    await repo.transact((x) => { const r = step(x); assert.equal(r.ok, true); return { result: r, data: r.ok ? r.data : undefined }; });
  }
  d = await repo.loadData();
  const course = d.courses.find((c) => c.id === "c-4")!;
  assert.equal(course.usedSessions, 5);
  assert.equal(course.history[0].appointmentId, id);
  assert.equal(d.courseAudit[0].action, "deduct", "audit is newest first");
  assert.equal(d.courseAudit[0].after.usedSessions, 5);
});

test("only changed rows are written", async () => {
  const before = (await pg.query("SELECT seq FROM patients WHERE id = 'p-1'")).rows[0] as { seq: string };
  await save((d) => ({ ...d, patients: d.patients.map((p) => (p.id === "p-2" ? { ...p, condition: "แก้ไข" } : p)) }));
  const after = (await pg.query("SELECT seq, condition FROM patients WHERE id IN ('p-1','p-2') ORDER BY id")).rows as Array<{ seq: string; condition: string }>;
  assert.equal(after[0].seq, before.seq);
  assert.equal(after[1].condition, "แก้ไข");
});

test("a failed use case writes nothing", async () => {
  const snapshot = JSON.stringify(await repo.loadData());
  await repo.transact((d) => ({ result: cancelAppointment(d, "does-not-exist", { actor: staff }) }));
  assert.equal(JSON.stringify(await repo.loadData()), snapshot);
});

test("database constraints reject impossible course counts and roll back the whole save", async () => {
  const snapshot = JSON.stringify(await repo.loadData());
  await assert.rejects(save((d) => ({ ...d, patients: [...d.patients, { id: "px", name: "x", phone: "0800000000", condition: "" }], courses: d.courses.map((c) => (c.id === "c-1" ? { ...c, usedSessions: 99 } : c)) })));
  assert.equal(JSON.stringify(await repo.loadData()), snapshot, "the patient inserted in the same transaction is rolled back too");
});

test("concurrent writers never lose an update", async () => {
  await Promise.all(Array.from({ length: 12 }, (_, i) => save((d) => ({ ...d, patients: [...d.patients, { id: `race-${i}`, name: `n${i}`, phone: "0800000000", condition: "" }] }))));
  const d = await repo.loadData();
  assert.equal(d.patients.filter((p) => p.id.startsWith("race-")).length, 12);
});

test("pruned notifications and used link codes are deleted", async () => {
  const code = ok(issueLinkCode(await repo.loadData(), "patient", "p-1", { actor: staff, now: new Date() }));
  await save(() => code);
  assert.equal((await repo.loadData()).linkCodes.length, 1);
  await save((d) => ({ ...d, linkCodes: [] }));
  assert.equal((await repo.loadData()).linkCodes.length, 0);

  const old = { id: "n-old", dedupeKey: "old", kind: "course-low" as const, audience: "admin" as const, recipientId: "admin", message: "x", scheduledAt: "2025-01-01T00:00:00.000Z", status: "sent" as const };
  await save((d) => ({ ...d, notifications: [...d.notifications, old] }));
  assert.ok((await repo.loadData()).notifications.some((n) => n.id === "n-old"));
  await save((d) => pruneOldNotifications(d, new Date("2026-10-29T00:00:00Z")));
  assert.ok(!(await repo.loadData()).notifications.some((n) => n.id === "n-old"));
});

test("course adjustments, users and settings persist", async () => {
  await save((d) => ok(adjustCourse(d, "c-3", { totalSessions: 30, usedSessions: 17, reason: "ต่อคอร์ส" }, { actor: admin, now })));
  await save((d) => ok(createUser(d, { username: "pim", name: "พิมพ์ชนก", role: "therapist", therapistId: "t-1" }, { actor: admin })));
  await save((d) => ok(createPatient(d, { name: "คุณใหม่", phone: "081-111-2222", condition: "ปวดคอ", reminder: { patientReminder: "lead", leadHours: 1 } }, { actor: staff })));
  await save((d) => ({ ...d, settings: { ...d.settings, eveningTime: "19:30", leadHours: 1 } }));
  const d = await repo.loadData();
  assert.equal(d.courses.find((c) => c.id === "c-3")!.totalSessions, 30);
  assert.equal(d.courseAudit[0].reason, "ต่อคอร์ส");
  assert.equal(d.users.find((u) => u.username === "pim")!.therapistId, "t-1");
  assert.deepEqual(d.patients.find((p) => p.name === "คุณใหม่")!.reminder, { patientReminder: "lead", leadHours: 1 });
  assert.equal(d.settings.eveningTime, "19:30");
  const user = d.users[0];
  assert.deepEqual(await repo.findUser(user.id), user);
  assert.equal(await repo.findUser("nope"), undefined);
});

test("credentials, login throttle and the dispatch lock", async () => {
  const d = await repo.loadData();
  const uid = d.users[0].id;
  await repo.setHash(uid, "scrypt$a$b");
  await repo.setHash(uid, "scrypt$c$d");
  assert.equal(await repo.getHash(uid), "scrypt$c$d");
  assert.equal(await repo.getHash("nobody"), undefined);

  for (let i = 0; i < 5; i++) assert.equal(await repo.tooManyAttempts("login:z", 5, 900), false);
  assert.equal(await repo.tooManyAttempts("login:z", 5, 900), true);
  await repo.clearAttempts("login:z");
  assert.equal(await repo.tooManyAttempts("login:z", 5, 900), false);

  const nested = await repo.tryLock("dispatch", 30, async () => (await repo.tryLock("dispatch", 30, async () => 1)).ran);
  assert.deepEqual(nested, { ran: true, value: false });
  assert.equal((await repo.tryLock("dispatch", 30, async () => 1)).ran, true);
});

test("dispatch results merge into the database without clobbering concurrent edits", async () => {
  const snapshot = await repo.loadData();
  const withLine: AppData = { ...snapshot, patients: snapshot.patients.map((p) => (p.id === "p-4" ? { ...p, lineUserId: "U1" } : p)) };
  await save(() => ok(createAppointment(withLine, { patientId: "p-4", therapistId: "t-3", date: "2026-11-10", time: "11:00", location: "คลินิก", address: "บางนา" }, { now, actor: staff })));
  const snap = await repo.loadData();
  const sent = await dispatchDueNotifications(snap, { send: async () => ({ status: "sent" }) }, now);

  await save((d) => ({ ...d, settings: { ...d.settings, contactPhone: "02-111-1111" } })); // edit while "sending"
  await repo.transact((fresh) => ({ result: { ok: true as const }, data: mergeDispatchResult(fresh, snap, sent) }));

  const d = await repo.loadData();
  assert.equal(d.settings.contactPhone, "02-111-1111");
  assert.ok(d.notifications.some((n) => n.status === "sent" && n.sentAt && n.deliveredTo?.includes("U1")));
});

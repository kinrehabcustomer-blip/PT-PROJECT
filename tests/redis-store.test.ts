import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { dispatchDueNotifications, mergeDispatchResult } from "../src/application/dispatch-notifications";
import { createAppointment } from "../src/application/appointment-use-cases";
import { seedData } from "../src/infrastructure/repositories/seed-data";
import type { AppData } from "../src/domain/models";

/** Minimal in-memory stand-in for the Upstash REST API (commands the app uses). */
const kv = new Map<string, string>();
const hashes = new Map<string, Map<string, string>>();
const counters = new Map<string, number>();
let server: Server;

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const [cmd, ...a] = JSON.parse(body) as string[];
      let result: unknown = null;
      switch (cmd) {
        case "GET": result = kv.get(a[0]) ?? null; break;
        case "SET":
          if (a.includes("NX") && kv.has(a[0])) { result = null; break; }
          kv.set(a[0], a[1]); result = "OK"; break;
        case "DEL": kv.delete(a[0]); counters.delete(a[0]); result = 1; break;
        case "EVAL": { // compare-and-set script: args = script, numkeys, key, expected, value
          const [, , key, expected, value] = a;
          const cur = kv.get(key);
          if ((cur === undefined && expected === "") || cur === expected) { kv.set(key, value); result = 1; } else result = 0;
          break;
        }
        case "HSET": { const h = hashes.get(a[0]) ?? new Map(); h.set(a[1], a[2]); hashes.set(a[0], h); result = 1; break; }
        case "HGET": result = hashes.get(a[0])?.get(a[1]) ?? null; break;
        case "INCR": counters.set(a[0], (counters.get(a[0]) ?? 0) + 1); result = counters.get(a[0]); break;
        case "EXPIRE": result = 1; break;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ result }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.UPSTASH_REDIS_REST_TOKEN = "test";
});

after(() => {
  server.close();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

test("redis store: concurrent transactions never lose an update", async () => {
  const { transact, loadData } = await import("../src/infrastructure/repositories/store");
  await Promise.all(
    Array.from({ length: 15 }, (_, i) =>
      transact((data: AppData) => ({
        result: { ok: true as const },
        data: { ...data, patients: [...data.patients, { id: `race-${i}`, name: `n${i}`, phone: "0800000000", condition: "" }] },
      })),
    ),
  );
  const patients = (await loadData()).patients.filter((p) => p.id.startsWith("race-"));
  assert.equal(patients.length, 15);
});

test("redis store: a transaction that returns no data writes nothing", async () => {
  const { transact } = await import("../src/infrastructure/repositories/store");
  const before = kv.get("pt:db");
  await transact(() => ({ result: { ok: false } }));
  assert.equal(kv.get("pt:db"), before);
});

test("redis store: credentials and locks", async () => {
  const { credentialStore, tryLock, tooManyAttempts, clearAttempts } = await import("../src/infrastructure/repositories/store");
  await credentialStore.set("u1", "scrypt$a$b");
  assert.equal(await credentialStore.get("u1"), "scrypt$a$b");
  assert.equal(await credentialStore.get("nobody"), undefined);

  const inner = await tryLock("t", 30, async () => (await tryLock("t", 30, async () => "nested")).ran);
  assert.deepEqual(inner, { ran: true, value: false }); // a second runner is refused while the first holds the lock
  assert.equal((await tryLock("t", 30, async () => 1)).ran, true); // released afterwards

  for (let i = 0; i < 5; i++) assert.equal(await tooManyAttempts("login:x", 5, 900), false);
  assert.equal(await tooManyAttempts("login:x", 5, 900), true);
  await clearAttempts("login:x");
  assert.equal(await tooManyAttempts("login:x", 5, 900), false);
});

test("a dispatch merge keeps edits made while messages were being sent", async () => {
  const staff = { name: "s", role: "staff" as const };
  const now = new Date("2026-10-29T03:00:00Z");
  const base: AppData = { ...seedData, patients: seedData.patients.map((p) => (p.id === "p-4" ? { ...p, lineUserId: "U1" } : p)) };
  const created = createAppointment(base, { patientId: "p-4", therapistId: "t-3", date: "2026-11-05", time: "10:00", location: "คลินิก", address: "บางนา" }, { now, actor: staff });
  assert.equal(created.ok, true);
  const snapshot = (created as { data: AppData }).data;
  const sent = await dispatchDueNotifications(snapshot, { send: async () => ({ status: "sent" }) }, now);

  // Meanwhile someone added a patient and another notification appeared.
  const fresh: AppData = {
    ...snapshot,
    patients: [...snapshot.patients, { id: "new", name: "ใหม่", phone: "0800000000", condition: "" }],
    notifications: [...snapshot.notifications, { id: "n-extra", dedupeKey: "extra", kind: "course-low", audience: "admin", recipientId: "admin", message: "x", scheduledAt: now.toISOString(), status: "queued" }],
  };
  const merged = mergeDispatchResult(fresh, snapshot, sent);
  assert.ok(merged.patients.some((p) => p.id === "new"), "concurrent edit survives");
  assert.ok(merged.notifications.some((n) => n.id === "n-extra" && n.status === "queued"), "unrelated notification untouched");
  const confirmation = merged.notifications.find((n) => n.kind === "appointment-confirmation" && n.audience === "patient")!;
  assert.equal(confirmation.status, "sent");

  // A notification that someone changed in the meantime is not overwritten by the stale result.
  const edited = { ...fresh, notifications: fresh.notifications.map((n) => (n.id === confirmation.id ? { ...n, status: "skipped" as const, detail: "แก้ไขโดยผู้ใช้" } : n)) };
  const merged2 = mergeDispatchResult(edited, snapshot, sent);
  assert.equal(merged2.notifications.find((n) => n.id === confirmation.id)!.detail, "แก้ไขโดยผู้ใช้");
});

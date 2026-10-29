import assert from "node:assert/strict";
import { scryptSync, randomBytes } from "node:crypto";
import { test } from "node:test";
import { createAppointment } from "../src/application/appointment-use-cases";
import { viewFor } from "../src/application/data-view";
import { createPatient } from "../src/application/directory-use-cases";
import { hashPassword, needsRehash, safeEqual, verifyPasswordAsync, verifyPassword } from "../src/infrastructure/auth/crypto";
import { seedData } from "../src/infrastructure/repositories/seed-data";
import type { AppData } from "../src/domain/models";

const staff = { name: "s", role: "staff" as const };
const now = new Date("2026-10-29T03:00:00Z");
const base = { patientId: "p-4", therapistId: "t-3", date: "2026-11-05", time: "10:00", location: "คลินิก", address: "บางนา" };

test("new password hashes use the stronger settings; old ones still work and are flagged for upgrade", async () => {
  const fresh = hashPassword("a long enough passphrase");
  assert.match(fresh, /^scrypt2\$32768\$8\$3\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(needsRehash(fresh), false);

  // A hash exactly as the first version of the app wrote it.
  const salt = randomBytes(16);
  const legacy = `scrypt$${salt.toString("hex")}$${scryptSync("old password", salt, 64).toString("hex")}`;
  assert.equal(verifyPassword("old password", legacy), true);
  assert.equal(await verifyPasswordAsync("old password", legacy), true);
  assert.equal(await verifyPasswordAsync("wrong", legacy), false);
  assert.equal(needsRehash(legacy), true);
});

test("malformed or truncated hashes never verify", async () => {
  for (const bad of ["", "x", "scrypt$", "scrypt2$1$2$3$aa$", "scrypt2$32768$8$3$zz$zz", "md5$aa$bb"]) {
    assert.equal(await verifyPasswordAsync("anything", bad), false, bad);
  }
});

test("safeEqual compares secrets without caring about length or position of the difference", () => {
  assert.equal(safeEqual("Bearer abc", "Bearer abc"), true);
  assert.equal(safeEqual("Bearer abc", "Bearer abd"), false);
  assert.equal(safeEqual("Bearer abc", "Bearer abcd"), false);
  assert.equal(safeEqual("", "x"), false);
});

const withLine: AppData = {
  ...seedData,
  patients: seedData.patients.map((p) => ({ ...p, lineUserId: "Usecret1234567890abcdef1234567890", relativeLineUserId: "Urelative" })),
  therapists: seedData.therapists.map((t) => ({ ...t, lineUserId: "Utherapist" })),
  linkRequests: [{ id: "lr-1", target: "patient", targetId: "p-1", lineUserId: "Urequester", requestedAt: now.toISOString() }],
};

test("no role is ever sent a raw LINE user id", () => {
  const admin = { id: "u1", username: "a", name: "a", role: "admin" as const, active: true };
  const front = { id: "u2", username: "f", name: "f", role: "staff" as const, active: true };
  const pt = { id: "u3", username: "t", name: "t", role: "therapist" as const, therapistId: "t-1", active: true };
  for (const user of [admin, front, pt]) {
    const json = JSON.stringify(viewFor(user, withLine, now));
    for (const id of ["Usecret1234567890abcdef1234567890", "Urelative", "Utherapist", "Urequester"]) {
      assert.equal(json.includes(id), false, `${user.role} must not receive ${id}`);
    }
  }
  // Staff still learn whether someone is linked.
  const view = viewFor(front, withLine, now);
  assert.ok(view.patients.every((p) => Boolean(p.lineUserId)));
  assert.ok(view.therapists.every((t) => Boolean(t.lineUserId)));
});

test("a therapist does not receive colleagues' LINE links, patients' links or the user list", () => {
  const pt = { id: "u3", username: "t", name: "t", role: "therapist" as const, therapistId: "t-1", active: true };
  const view = viewFor(pt, withLine, now);
  assert.ok(view.therapists.every((t) => t.lineUserId === undefined));
  assert.ok(view.patients.every((p) => p.lineUserId === undefined && p.relativeLineUserId === undefined));
  assert.equal(view.users.length + view.linkRequests.length + view.linkCodes.length, 0);
});

test("the map link must be a plain web link", () => {
  for (const bad of ["javascript:alert(1)", "data:text/html,<script>1</script>", "ftp://x.com/a", "https://a.com/ b", "//evil.com", "x".repeat(600)]) {
    assert.equal(createAppointment(seedData, { ...base, mapUrl: bad }, { now, actor: staff }).ok, false, bad.slice(0, 30));
  }
  assert.equal(createAppointment(seedData, { ...base, mapUrl: "https://maps.app.goo.gl/abc123" }, { now, actor: staff }).ok, true);
  assert.equal(createAppointment(seedData, { ...base, mapUrl: "" }, { now, actor: staff }).ok, true);
});

test("oversized text is refused instead of stored", () => {
  assert.equal(createAppointment(seedData, { ...base, address: "ก".repeat(301) }, { now, actor: staff }).ok, false);
  assert.equal(createPatient(seedData, { name: "ก".repeat(121), phone: "0812345678", condition: "" }, { actor: staff }).ok, false);
  assert.equal(createPatient(seedData, { name: "ก", phone: "0812345678", condition: "ก".repeat(501) }, { actor: staff }).ok, false);
});

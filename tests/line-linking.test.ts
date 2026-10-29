import assert from "node:assert/strict";
import { test } from "node:test";
import { viewFor } from "../src/application/data-view";
import { hashPassword, hashPasswordAsync, verifyPassword, verifyPasswordAsync } from "../src/infrastructure/auth/crypto";
import { assignPatient, unassignPatient } from "../src/application/directory-use-cases";
import { createAppointment } from "../src/application/appointment-use-cases";
import {
  approveLinkRequest,
  matchKeyword,
  normalizeName,
  rejectLinkRequest,
  replyFor,
  requestLinkByKeyword,
} from "../src/application/line-linking";
import { seedData } from "../src/infrastructure/repositories/seed-data";
import type { AppData, Patient } from "../src/domain/models";

const admin = { name: "แอดมิน", role: "admin" as const };
const staff = { name: "เจ้าหน้าที่", role: "staff" as const };
const now = new Date("2026-10-29T03:00:00Z");

function ask(data: AppData, text: string, lineUserId = "U-asker", autoApprove = false) {
  return requestLinkByKeyword(data, { lineUserId, text, displayName: "Somchai LINE", autoApprove }, now);
}

test("names compare regardless of spaces and titles", () => {
  assert.equal(normalizeName("คุณ สมชาย  ใจดี"), normalizeName("สมชายใจดี"));
  assert.equal(normalizeName("นางสาว มาลี"), normalizeName("มาลี"));
  assert.equal(normalizeName("ด.ช.ภูริ แก้วมณี"), normalizeName("ภูริแก้วมณี"));
  // "กภ." is handled by the therapist lookup (see matchKeyword), not as a general title: it would also eat names like กภัทร.
  assert.notEqual(normalizeName("กภัทร สุข"), normalizeName("ัทรสุข"));
});

test("keywords find a patient, a relative or a therapist", () => {
  assert.deepEqual(matchKeyword(seedData, "สมชาย ใจดี"), { kind: "match", target: "patient", targetId: "p-1", name: "คุณสมชาย ใจดี" });
  assert.deepEqual(matchKeyword(seedData, "คุณสมชาย ใจดี"), { kind: "match", target: "patient", targetId: "p-1", name: "คุณสมชาย ใจดี" });
  assert.equal((matchKeyword(seedData, "ญาติ สมชาย ใจดี") as { target: string }).target, "relative");
  assert.equal((matchKeyword(seedData, "ญาติของ สมชาย ใจดี") as { target: string }).target, "relative");
  assert.deepEqual(matchKeyword(seedData, "กภ. ธนกร"), { kind: "match", target: "therapist", targetId: "t-2", name: "กภ. ธนกร" });
  assert.equal(matchKeyword(seedData, "ธนกร").kind, "none", "a bare first name must not match a therapist");
});

test("a typed first and last name still finds a patient with a title in front", () => {
  assert.equal((matchKeyword(seedData, "บุญเลี้ยง ศรีสุข") as { targetId: string }).targetId, "p-6"); // stored as คุณยายบุญเลี้ยง ศรีสุข
});

test("unknown, empty or very long text matches nothing", () => {
  for (const text of ["", "   ", "สวัสดี", "x".repeat(200), "ใจดี"]) assert.equal(matchKeyword(seedData, text).kind === "match", false, text);
});

test("two patients with the same name are never guessed between", () => {
  const dup: AppData = { ...seedData, patients: [...seedData.patients, { ...(seedData.patients[0] as Patient), id: "p-dup" }] };
  assert.equal(matchKeyword(dup, "สมชาย ใจดี").kind, "ambiguous");
  assert.equal(ask(dup, "สมชาย ใจดี").status, "ambiguous");
});

test("typing a name creates a request and links nothing until staff approve", () => {
  const r = ask(seedData, "สมชาย ใจดี");
  assert.equal(r.status, "pending");
  assert.equal(r.data.patients.find((p) => p.id === "p-1")!.lineUserId, undefined);
  assert.equal(r.data.linkRequests.length, 1);
  assert.equal(r.data.linkRequests[0].displayName, "Somchai LINE");

  const approved = approveLinkRequest(r.data, r.data.linkRequests[0].id, { actor: staff });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  assert.equal(approved.data.patients.find((p) => p.id === "p-1")!.lineUserId, "U-asker");
  assert.equal(approved.data.linkRequests.length, 0);
});

test("only staff or admin can approve or reject, and a request can only be handled once", () => {
  const r = ask(seedData, "ญาติ สมชาย ใจดี").data;
  const id = r.linkRequests[0].id;
  assert.equal(approveLinkRequest(r, id, { actor: { name: "t", role: "therapist", therapistId: "t-1" } }).ok, false);
  assert.equal(approveLinkRequest(r, id, {}).ok, false);
  assert.equal(rejectLinkRequest(r, id, { actor: { name: "t", role: "therapist", therapistId: "t-1" } }).ok, false);
  const done = approveLinkRequest(r, id, { actor: admin });
  assert.equal(done.ok, true);
  assert.equal(done.data!.patients.find((p) => p.id === "p-1")!.relativeLineUserId, "U-asker");
  assert.equal(approveLinkRequest(done.data!, id, { actor: admin }).ok, false);
});

test("rejecting removes the request without linking", () => {
  const r = ask(seedData, "กภ. ธนกร").data;
  const out = rejectLinkRequest(r, r.linkRequests[0].id, { actor: staff });
  assert.equal(out.ok, true);
  assert.equal(out.data!.linkRequests.length, 0);
  assert.equal(out.data!.therapists.find((t) => t.id === "t-2")!.lineUserId, undefined);
});

test("approving one request clears competing requests for the same person", () => {
  let d = ask(seedData, "สมชาย ใจดี", "U-real").data;
  d = ask(d, "สมชาย ใจดี", "U-imposter").data;
  assert.equal(d.linkRequests.length, 2);
  const real = d.linkRequests.find((r) => r.lineUserId === "U-real")!;
  const out = approveLinkRequest(d, real.id, { actor: staff });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.data.linkRequests.length, 0);
  assert.equal(out.data.patients.find((p) => p.id === "p-1")!.lineUserId, "U-real");
});

test("repeat messages do not stack requests, and one LINE user cannot flood the queue", () => {
  const first = ask(seedData, "สมชาย ใจดี");
  assert.equal(ask(first.data, "สมชาย ใจดี").status, "already-pending");
  let d = seedData;
  for (const name of ["สมชาย ใจดี", "สุภาวดี แสงทอง", "ประเสริฐ มีสุข"]) d = ask(d, name).data;
  assert.equal(d.linkRequests.length, 3);
  assert.equal(ask(d, "อรทัย พูนผล").status, "too-many");
});

test("a LINE account that is already linked is told so", () => {
  const linked: AppData = { ...seedData, patients: seedData.patients.map((p) => (p.id === "p-1" ? { ...p, lineUserId: "U-asker" } : p)) };
  assert.equal(ask(linked, "สมชาย ใจดี").status, "already-linked");
});

test("auto-approve links at once; it is only for clinics that accept the risk", () => {
  const r = ask(seedData, "สมชาย ใจดี", "U-asker", true);
  assert.equal(r.status, "linked");
  assert.equal(r.data.patients.find((p) => p.id === "p-1")!.lineUserId, "U-asker");
  assert.equal(r.data.linkRequests.length, 0);
});

test("replies tell people what happens next", () => {
  assert.match(replyFor(ask(seedData, "สมชาย ใจดี"), "02-111-1111"), /เจ้าหน้าที่จะตรวจสอบ/);
  assert.match(replyFor(ask(seedData, "ไม่มีชื่อนี้"), "02-111-1111"), /02-111-1111/);
});

test("care assignments: staff add and remove with a dropdown, no duplicates, no open appointments", () => {
  const added = assignPatient(seedData, "t-4", "p-1", { actor: staff });
  assert.equal(added.ok, true);
  assert.ok(added.data!.assignments.some((a) => a.id === "t-4:p-1"));
  assert.equal(assignPatient(added.data!, "t-4", "p-1", { actor: staff }).ok, false, "already in care");
  assert.equal(assignPatient(seedData, "t-4", "p-1", { actor: { name: "t", role: "therapist", therapistId: "t-4" } }).ok, false);
  assert.equal(assignPatient(seedData, "nope", "p-1", { actor: staff }).ok, false);
  assert.equal(assignPatient(seedData, "t-4", "nope", { actor: staff }).ok, false);

  assert.equal(unassignPatient(added.data!, "t-4", "p-1", { actor: staff }).ok, true);
  // p-6 still has open appointments with t-4.
  assert.equal(unassignPatient(seedData, "t-4", "p-6", { actor: staff }).ok, false);
  assert.equal(unassignPatient(seedData, "t-1", "p-12", { actor: staff }).ok, false, "a-12 is still open");
  assert.equal(unassignPatient(seedData, "t-4", "p-1", { actor: staff }).ok, false, "not assigned");
});

test("a therapist sees the patients in their care, but never other people's LINE ids", () => {
  const withLine: AppData = {
    ...seedData,
    patients: seedData.patients.map((p) => ({ ...p, lineUserId: "U1", relativeLineUserId: "U2" })),
    linkRequests: ask(seedData, "สมชาย ใจดี").data.linkRequests,
  };
  const assigned = assignPatient(withLine, "t-1", "p-5", { actor: admin }); // p-5 has no appointment with t-1
  assert.equal(assigned.ok, true);
  if (!assigned.ok) return;
  const given = assigned.data;
  const view = viewFor({ id: "u", username: "u", name: "u", role: "therapist", therapistId: "t-1", active: true }, given);
  assert.ok(view.patients.some((p) => p.id === "p-5"), "assigned patient is visible");
  assert.ok(view.courses.some((c) => c.patientId === "p-5"), "and so are their courses");
  assert.ok(view.appointments.every((a) => a.therapistId === "t-1"), "appointments stay limited to their own");
  assert.ok(!view.patients.some((p) => p.id === "p-2"), "other therapists' patients stay hidden");
  assert.ok(view.patients.every((p) => p.lineUserId === undefined && p.relativeLineUserId === undefined));
  assert.equal(view.linkRequests.length, 0);
  assert.ok(view.assignments.every((a) => a.therapistId === "t-1"));
});

test("booking still works for a therapist who is not the patient's usual one (cover)", () => {
  const r = createAppointment(seedData, { patientId: "p-4", therapistId: "t-3", date: "2026-11-05", time: "10:00", location: "คลินิก", address: "บางนา" }, { now, actor: staff });
  assert.equal(r.ok, true);
});

import { recentNotifications } from "../src/application/data-view";

test("the browser gets recent notifications and anything tied to an open appointment, not years of history", () => {
  const mk = (id: string, scheduledAt: string, status: "sent" | "queued", appointmentId?: string) => ({
    id, dedupeKey: id, kind: "lead-reminder" as const, audience: "patient" as const, recipientId: "p-1", message: "x", scheduledAt, status, appointmentId,
  });
  const data: AppData = {
    ...seedData,
    notifications: [
      mk("old-closed", "2026-01-01T00:00:00.000Z", "sent", "a-h1"),      // finished appointment, long ago -> dropped
      mk("old-open", "2026-01-01T00:00:00.000Z", "sent", "a-1"),         // a-1 is still open -> kept so its status stays correct
      mk("old-queued", "2026-01-01T00:00:00.000Z", "queued"),            // still waiting -> kept
      mk("recent", "2026-10-25T00:00:00.000Z", "sent", "a-h1"),          // within 14 days -> kept
    ],
  };
  const ids = recentNotifications(data, new Date("2026-10-29T00:00:00Z")).map((n) => n.id).sort();
  assert.deepEqual(ids, ["old-open", "old-queued", "recent"]);
});

test("async password hashing is interchangeable with the sync version", async () => {
  const fromAsync = await hashPasswordAsync("correct horse battery");
  assert.equal(verifyPassword("correct horse battery", fromAsync), true);
  assert.equal(await verifyPasswordAsync("correct horse battery", hashPassword("correct horse battery")), true);
  assert.equal(await verifyPasswordAsync("wrong", fromAsync), false);
  assert.equal(await verifyPasswordAsync("x", "not-a-hash"), false);
});

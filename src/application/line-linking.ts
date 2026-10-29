import type { Actor, AppData, LinkRequest, LinkTarget } from "@/domain/models";
import type { ActionContext, AppointmentActionResult } from "@/application/appointment-use-cases";

/**
 * Linking a LINE account by typing a name.
 *
 * A name is easy to learn, so typing one never links anything by itself: it
 * creates a request that staff confirm (they see the LINE display name of
 * whoever asked). Only when auto-approve is deliberately switched on does it
 * link immediately.
 */

const MAX_PENDING_PER_LINE_USER = 3;
const HONORIFICS = /^(นางสาว|นาง|นาย|คุณ|น\.ส\.|ด\.ช\.|ด\.ญ\.|เด็กชาย|เด็กหญิง|กภ\.?)/;

const newId = () => `lr-${globalThis.crypto.randomUUID().slice(0, 8)}`;

/** Removes spaces and titles so "คุณ สมชาย  ใจดี" and "สมชายใจดี" compare equal. */
export function normalizeName(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, "").replace(HONORIFICS, "").toLowerCase();
}

export type KeywordMatch =
  | { kind: "match"; target: LinkTarget; targetId: string; name: string }
  | { kind: "ambiguous" }
  | { kind: "none" };

function findUnique<T extends { name: string }>(items: T[], typed: string): T | "ambiguous" | undefined {
  const exact = items.filter((i) => normalizeName(i.name) === typed);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return "ambiguous";
  // Typing only the first and last name of "คุณยายบุญเลี้ยง ศรีสุข" should still find her.
  const tail = typed.length >= 6 ? items.filter((i) => normalizeName(i.name).endsWith(typed)) : [];
  if (tail.length === 1) return tail[0];
  return tail.length > 1 ? "ambiguous" : undefined;
}

/**
 * "สมชาย ใจดี"          → the patient
 * "ญาติ สมชาย ใจดี"      → a relative of that patient
 * "กภ. ธนกร"            → the therapist
 */
export function matchKeyword(data: AppData, text: string): KeywordMatch {
  const raw = text.normalize("NFC").trim();
  if (!raw || raw.length > 80) return { kind: "none" };

  if (/^กภ/.test(raw)) {
    const hit = findUnique(data.therapists, normalizeName(raw));
    if (hit === "ambiguous") return { kind: "ambiguous" };
    return hit ? { kind: "match", target: "therapist", targetId: hit.id, name: hit.name } : { kind: "none" };
  }

  const relative = /^ญาติ/.test(raw);
  const typed = normalizeName(relative ? raw.replace(/^ญาติ\s*(ของ)?/, "") : raw);
  if (!typed) return { kind: "none" };
  const hit = findUnique(data.patients, typed);
  if (hit === "ambiguous") return { kind: "ambiguous" };
  return hit ? { kind: "match", target: relative ? "relative" : "patient", targetId: hit.id, name: hit.name } : { kind: "none" };
}

export type LinkOutcome =
  | { status: "linked"; label: string; data: AppData }
  | { status: "pending"; label: string; data: AppData }
  | { status: "already-pending" | "already-linked"; label: string; data: AppData }
  | { status: "ambiguous" | "none" | "too-many"; data: AppData };

function currentLine(data: AppData, target: LinkTarget, targetId: string): string | undefined {
  if (target === "therapist") return data.therapists.find((t) => t.id === targetId)?.lineUserId;
  const p = data.patients.find((x) => x.id === targetId);
  return target === "relative" ? p?.relativeLineUserId : p?.lineUserId;
}

function applyLink(data: AppData, target: LinkTarget, targetId: string, lineUserId: string): AppData {
  if (target === "therapist") {
    return { ...data, therapists: data.therapists.map((t) => (t.id === targetId ? { ...t, lineUserId } : t)) };
  }
  const field = target === "relative" ? "relativeLineUserId" : "lineUserId";
  return { ...data, patients: data.patients.map((p) => (p.id === targetId ? { ...p, [field]: lineUserId } : p)) };
}

/** Handles a name typed by a LINE user. */
export function requestLinkByKeyword(
  data: AppData,
  input: { lineUserId: string; text: string; displayName?: string; autoApprove?: boolean },
  now: Date = new Date(),
): LinkOutcome {
  const found = matchKeyword(data, input.text);
  if (found.kind !== "match") return { status: found.kind, data };
  const { target, targetId, name } = found;

  if (currentLine(data, target, targetId) === input.lineUserId) return { status: "already-linked", label: name, data };

  const mine = data.linkRequests.filter((r) => r.lineUserId === input.lineUserId);
  if (mine.some((r) => r.target === target && r.targetId === targetId)) return { status: "already-pending", label: name, data };
  if (mine.length >= MAX_PENDING_PER_LINE_USER) return { status: "too-many", data };

  if (input.autoApprove) {
    return { status: "linked", label: name, data: applyLink(data, target, targetId, input.lineUserId) };
  }
  const request: LinkRequest = {
    id: newId(), target, targetId, lineUserId: input.lineUserId,
    displayName: input.displayName, requestedAt: now.toISOString(),
  };
  return { status: "pending", label: name, data: { ...data, linkRequests: [...data.linkRequests, request] } };
}

function isFrontDesk(actor?: Actor): boolean {
  return actor?.role === "admin" || actor?.role === "staff";
}
const DENIED = "เฉพาะเจ้าหน้าที่และผู้ดูแลระบบเท่านั้นที่ยืนยันการผูก LINE ได้";

export function approveLinkRequest(
  data: AppData,
  requestId: string,
  ctx: ActionContext = {},
): AppointmentActionResult & { request?: LinkRequest } {
  if (!isFrontDesk(ctx.actor)) return { ok: false, message: DENIED };
  const request = data.linkRequests.find(({ id }) => id === requestId);
  if (!request) return { ok: false, message: "ไม่พบคำขอ (อาจถูกจัดการไปแล้ว)" };
  const exists =
    request.target === "therapist"
      ? data.therapists.some(({ id }) => id === request.targetId)
      : data.patients.some(({ id }) => id === request.targetId);
  if (!exists) return { ok: false, message: "ไม่พบผู้รับบริการหรือนักกายภาพที่ขอผูก" };

  const linked = applyLink(data, request.target, request.targetId, request.lineUserId);
  return {
    ok: true,
    request,
    // Requests for the same slot from anyone else are now moot.
    data: { ...linked, linkRequests: linked.linkRequests.filter((r) => r.id !== requestId && !(r.target === request.target && r.targetId === request.targetId)) },
  };
}

export function rejectLinkRequest(data: AppData, requestId: string, ctx: ActionContext = {}): AppointmentActionResult {
  if (!isFrontDesk(ctx.actor)) return { ok: false, message: DENIED };
  if (!data.linkRequests.some(({ id }) => id === requestId)) return { ok: false, message: "ไม่พบคำขอ (อาจถูกจัดการไปแล้ว)" };
  return { ok: true, data: { ...data, linkRequests: data.linkRequests.filter(({ id }) => id !== requestId) } };
}

/** What the clinic's LINE account says back to the person who typed a name. */
export function replyFor(outcome: LinkOutcome, contactPhone: string): string {
  const contact = contactPhone ? ` หรือโทร ${contactPhone}` : "";
  switch (outcome.status) {
    case "linked":
      return `เชื่อมต่อ LINE กับ ${outcome.label} เรียบร้อยแล้ว คุณจะได้รับแจ้งเตือนนัดหมายทางนี้`;
    case "pending":
      return `รับเรื่องแล้ว: ${outcome.label}\nเจ้าหน้าที่จะตรวจสอบและยืนยันให้ในเวลาทำการ เมื่อยืนยันแล้วเราจะแจ้งกลับทางนี้`;
    case "already-pending":
      return `คำขอของ ${outcome.label} อยู่ระหว่างรอเจ้าหน้าที่ยืนยัน ไม่ต้องส่งซ้ำ`;
    case "already-linked":
      return `บัญชี LINE นี้เชื่อมต่อกับ ${outcome.label} อยู่แล้ว`;
    case "ambiguous":
      return `พบชื่อนี้มากกว่าหนึ่งรายการ กรุณาติดต่อเจ้าหน้าที่${contact}`;
    case "too-many":
      return `ส่งคำขอหลายรายการเกินไป กรุณาติดต่อเจ้าหน้าที่${contact}`;
    default:
      return `ไม่พบชื่อนี้ในระบบ กรุณาพิมพ์ชื่อ-นามสกุลตามที่ลงทะเบียนไว้ (ญาติให้พิมพ์ "ญาติ" นำหน้าชื่อผู้ป่วย) หรือติดต่อเจ้าหน้าที่${contact}`;
  }
}

export const WELCOME_MESSAGE =
  "ยินดีต้อนรับ 🙏 เพื่อรับการแจ้งเตือนนัดหมายทาง LINE\n" +
  "• ผู้ป่วย: พิมพ์ชื่อ-นามสกุลของคุณ\n" +
  "• ญาติ: พิมพ์ \"ญาติ\" ตามด้วยชื่อ-นามสกุลผู้ป่วย\n" +
  "• นักกายภาพ: พิมพ์ \"กภ.\" ตามด้วยชื่อ";

import { NextResponse } from "next/server";
import { redeemLinkCode } from "@/application/directory-use-cases";
import { handleAppointmentPostback } from "@/application/line-responses";
import { WELCOME_MESSAGE, matchKeyword, replyFor, requestLinkByKeyword, type LinkOutcome } from "@/application/line-linking";
import { verifyLineSignature } from "@/infrastructure/auth/crypto";
import { lineGateway } from "@/infrastructure/line/line-gateway";
import { loadData, transact } from "@/infrastructure/repositories/store";

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type: string; text?: string };
  postback?: { data: string; params?: { datetime?: string } };
}

/**
 * LINE webhook (set the URL in the LINE console to /api/line/webhook).
 *
 * People link their LINE account by typing a keyword to the clinic's account:
 *   "สมชาย ใจดี"       the patient
 *   "ญาติ สมชาย ใจดี"   a relative of that patient
 *   "กภ. ธนกร"         a therapist
 * That creates a request staff confirm in the web app. Only with
 * LINE_LINK_AUTO_APPROVE=true does it link immediately (anyone who knows a
 * name could then receive that person's appointment details).
 * One-time codes (PT-XXXXXX) keep working.
 */
export async function POST(request: Request) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET?.trim();
  if (!channelSecret) return NextResponse.json({ message: "LINE_CHANNEL_SECRET not set" }, { status: 503 });
  const raw = await request.text();
  if (!verifyLineSignature(raw, request.headers.get("x-line-signature"), channelSecret)) {
    return NextResponse.json({ message: "Invalid signature" }, { status: 401 });
  }
  let events: LineEvent[] = [];
  try {
    events = JSON.parse(raw).events ?? [];
  } catch {
    return NextResponse.json({ message: "Bad request" }, { status: 400 });
  }
  // On by default; set LINE_LINK_AUTO_APPROVE=false to make staff approve each request.
  const autoApprove = process.env.LINE_LINK_AUTO_APPROVE?.trim().toLowerCase() !== "false";

  for (const event of events) {
    const userId = event.source?.userId;
    if (!userId || !event.replyToken) continue;

    if (event.type === "follow") {
      await lineGateway.reply?.(event.replyToken, WELCOME_MESSAGE);
      continue;
    }
    if (event.type === "postback" && event.postback) {
      const { data: postData, params } = event.postback;
      const result = await transact((data) => {
        const r = handleAppointmentPostback(data, { lineUserId: userId, data: postData, datetime: params?.datetime });
        return { result: { ok: Boolean(r.data), reply: r.reply }, data: r.data };
      });
      await lineGateway.reply?.(event.replyToken, result.reply);
      continue;
    }
    const text = event.message?.type === "text" ? event.message.text?.trim() : undefined;
    if (event.type !== "message" || !text) continue;

    // 1) A one-time code from the old flow.
    if (/^PT-[A-Z0-9]{6}$/i.test(text)) {
      const outcome = await transact((data) => {
        const r = redeemLinkCode(data, userId, text);
        return { result: { ok: r.linked, label: r.label }, data: r.linked ? r.data : undefined };
      });
      await lineGateway.reply?.(
        event.replyToken,
        outcome.ok
          ? `ผูกบัญชี LINE กับ ${outcome.label} เรียบร้อยแล้ว`
          : "ไม่พบรหัสนี้ หรือรหัสหมดอายุ กรุณาพิมพ์ชื่อ-นามสกุลของคุณแทน หรือติดต่อเจ้าหน้าที่",
      );
      continue;
    }

    // 2) A name. Look the LINE profile up only once the name matched someone.
    const matched = matchKeyword(await loadData(), text).kind === "match";
    const displayName = matched ? await lineGateway.displayName?.(userId) : undefined;
    const result = await transact((data) => {
      const outcome = requestLinkByKeyword(data, { lineUserId: userId, text, displayName, autoApprove });
      const changed = outcome.status === "pending" || outcome.status === "linked";
      return { result: { ok: changed, outcome: outcome as LinkOutcome }, data: changed ? outcome.data : undefined };
    });
    const contactPhone = (await loadData()).settings?.contactPhone ?? "";
    await lineGateway.reply?.(event.replyToken, replyFor(result.outcome, contactPhone));
  }
  return NextResponse.json({ ok: true });
}

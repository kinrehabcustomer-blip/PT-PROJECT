import { NextResponse } from "next/server";
import { redeemLinkCode } from "@/application/directory-use-cases";
import { verifyLineSignature } from "@/infrastructure/auth/crypto";
import { lineGateway } from "@/infrastructure/line/line-gateway";
import { transact } from "@/infrastructure/repositories/file-repository";

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type: string; text?: string };
}

/**
 * LINE webhook: when a patient, relative or therapist sends the one-time
 * code (PT-XXXXXX) to the official account, their LINE user id is linked.
 * Set the webhook URL in the LINE console to /api/line/webhook.
 */
export async function POST(request: Request) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
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

  for (const event of events) {
    const userId = event.source?.userId;
    if (event.type !== "message" || event.message?.type !== "text" || !userId || !event.message.text) continue;
    const text = event.message.text;
    const outcome = await transact((data) => {
      const r = redeemLinkCode(data, userId, text);
      return { result: { ok: r.linked, label: r.label }, data: r.linked ? r.data : undefined };
    });
    if (event.replyToken) {
      await lineGateway.reply?.(
        event.replyToken,
        outcome.ok
          ? `ผูกบัญชี LINE กับ ${outcome.label} เรียบร้อยแล้ว`
          : "ไม่พบรหัสนี้ หรือรหัสหมดอายุ กรุณาขอรหัสใหม่จากเจ้าหน้าที่",
      );
    }
  }
  return NextResponse.json({ ok: true });
}

import { ADMIN_RECIPIENT, type MessageGateway } from "@/application/dispatch-notifications";

const PUSH_URL = "https://api.line.me/v2/bot/message/push";

/**
 * LINE Messaging API push. Needs LINE_CHANNEL_ACCESS_TOKEN (and
 * LINE_ADMIN_USER_ID for admin alerts). Without them nothing is sent and every
 * attempt is reported as "skipped" so the UI never claims a delivery.
 */
const REPLY_URL = "https://api.line.me/v2/bot/message/reply";

/**
 * The message as a card with two buttons that stay in the chat. Confirm sends a
 * postback; reschedule opens LINE's date-time picker and sends the chosen time.
 * Both are handled in the webhook (application/line-responses.ts).
 */
function appointmentCard(text: string, appointmentId: string, audience?: "patient" | "therapist") {
  const id = encodeURIComponent(appointmentId);
  const label = audience === "therapist" ? "สำหรับนักกายภาพ" : "สำหรับลูกค้า";
  const color = audience === "therapist" ? "#1d4ed8" : "#15803d";
  return {
    type: "flex",
    altText: `[${label}] ${text}`.slice(0, 400),
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: color,
        paddingAll: "md",
        contents: [{ type: "text", text: label, color: "#ffffff", weight: "bold", size: "md" }],
      },
      body: { type: "box", layout: "vertical", contents: [{ type: "text", text: text.slice(0, 4000), wrap: true, size: "sm" }] },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "button", style: "primary", action: { type: "postback", label: "ยืนยันนัดหมาย", data: `act=confirm&a=${id}`, displayText: "ยืนยันนัดหมาย" } },
          { type: "button", style: "secondary", action: { type: "datetimepicker", label: "เลื่อนนัดหมาย", data: `act=reschedule&a=${id}`, mode: "datetime" } },
        ],
      },
    },
  };
}

export const lineGateway: MessageGateway = {
  async displayName(lineUserId) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) return undefined;
    try {
      const res = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(lineUserId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok ? ((await res.json()) as { displayName?: string }).displayName : undefined;
    } catch {
      return undefined;
    }
  },
  async reply(replyToken, text) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) return;
    await fetch(REPLY_URL, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
    }).catch(() => undefined);
  },
  async send(recipient, text, options) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) return { status: "skipped", reason: "ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN" };

    const to = recipient === ADMIN_RECIPIENT ? process.env.LINE_ADMIN_USER_ID : recipient;
    if (!to) return { status: "skipped", reason: "ยังไม่ได้ตั้งค่า LINE_ADMIN_USER_ID" };

    try {
      const response = await fetch(PUSH_URL, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to, messages: [options?.appointmentId ? appointmentCard(text, options.appointmentId, options.audience) : { type: "text", text: text.slice(0, 5000) }] }),
      });
      if (response.ok) return { status: "sent" };
      return { status: "failed", reason: `LINE ตอบกลับ ${response.status}` };
    } catch (error) {
      return { status: "failed", reason: error instanceof Error ? error.message : "ส่งข้อความไม่สำเร็จ" };
    }
  },
};

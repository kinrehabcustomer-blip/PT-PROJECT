import { ADMIN_RECIPIENT, type MessageGateway } from "@/application/dispatch-notifications";

const PUSH_URL = "https://api.line.me/v2/bot/message/push";

/**
 * LINE Messaging API push. Needs LINE_CHANNEL_ACCESS_TOKEN (and
 * LINE_ADMIN_USER_ID for admin alerts). Without them nothing is sent and every
 * attempt is reported as "skipped" so the UI never claims a delivery.
 */
const REPLY_URL = "https://api.line.me/v2/bot/message/reply";

export const lineGateway: MessageGateway = {
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
  async send(recipient, text) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) return { status: "skipped", reason: "ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN" };

    const to = recipient === ADMIN_RECIPIENT ? process.env.LINE_ADMIN_USER_ID : recipient;
    if (!to) return { status: "skipped", reason: "ยังไม่ได้ตั้งค่า LINE_ADMIN_USER_ID" };

    try {
      const response = await fetch(PUSH_URL, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, 5000) }] }),
      });
      if (response.ok) return { status: "sent" };
      return { status: "failed", reason: `LINE ตอบกลับ ${response.status}` };
    } catch (error) {
      return { status: "failed", reason: error instanceof Error ? error.message : "ส่งข้อความไม่สำเร็จ" };
    }
  },
};

/**
 * Checks the LINE settings in .env.local against LINE's own API.
 *
 *   npm run line:check                      verify token and secrets
 *   npm run line:check -- https://host      also set + test the webhook URL (host/api/line/webhook)
 */
import { readFileSync } from "node:fs";
import path from "node:path";

function loadEnv(): Record<string, string> {
  try {
    const env: Record<string, string> = {};
    for (const line of readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].split(/\s+#/)[0].trim();
    }
    return env;
  } catch {
    return {};
  }
}

const env = { ...loadEnv(), ...process.env } as Record<string, string | undefined>;
const token = env.LINE_CHANNEL_ACCESS_TOKEN;
let failed = false;
const ok = (m: string) => console.log(`  ✔ ${m}`);
const bad = (m: string) => { failed = true; console.log(`  ✖ ${m}`); };

async function line(pathAndQuery: string, init?: RequestInit) {
  const res = await fetch(`https://api.line.me${pathAndQuery}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
}

async function main() {
  console.log("\nตรวจการตั้งค่า LINE\n");
  for (const key of ["LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET", "LINE_ADMIN_USER_ID", "CRON_SECRET", "AUTH_SECRET"]) {
    env[key] ? ok(`${key} ตั้งค่าแล้ว`) : bad(`${key} ยังไม่ได้ตั้งค่า`);
  }
  if (env.AUTH_SECRET && env.AUTH_SECRET.length < 16) bad("AUTH_SECRET สั้นเกินไป (ต้อง 16 ตัวอักษรขึ้นไป)");
  if (env.LINE_ADMIN_USER_ID && !/^U[0-9a-f]{32}$/.test(env.LINE_ADMIN_USER_ID)) bad("LINE_ADMIN_USER_ID ควรขึ้นต้นด้วย U ตามด้วยตัวอักษร 32 ตัว");
  if (!token) return finish();

  const info = await line("/v2/bot/info");
  if (info.status === 200) ok(`Access token ใช้ได้ — บัญชี "${info.body.displayName}" (${info.body.basicId ?? "ไม่มี Basic ID"})`);
  else bad(`Access token ใช้ไม่ได้ (HTTP ${info.status}) — ตรวจว่าคัดลอกครบและเป็น Channel access token แบบ long-lived`);

  const base = process.argv[2]?.replace(/\/+$/, "");
  if (info.status === 200 && base) {
    if (!base.startsWith("https://")) bad("Webhook ต้องเป็น https:// เท่านั้น");
    else {
      const endpoint = `${base}/api/line/webhook`;
      const set = await line("/v2/bot/channel/webhook/endpoint", { method: "PUT", body: JSON.stringify({ endpoint }) });
      set.status === 200 ? ok(`ตั้ง Webhook URL เป็น ${endpoint}`) : bad(`ตั้ง Webhook URL ไม่สำเร็จ (HTTP ${set.status})`);
      const test = await line("/v2/bot/channel/webhook/test", { method: "POST", body: JSON.stringify({ endpoint }) });
      if (test.status === 200 && test.body.success) ok("LINE ยิงทดสอบมาที่เซิร์ฟเวอร์ของคุณสำเร็จ (ลายเซ็นถูกต้อง)");
      else bad(`LINE ยิงทดสอบไม่สำเร็จ: ${test.body.reason ?? test.status} ${test.body.detail ?? ""} — ตรวจว่าเซิร์ฟเวอร์เปิดอยู่, URL เข้าถึงจากอินเทอร์เน็ตได้ และ LINE_CHANNEL_SECRET ถูกต้อง`);
    }
  }
  finish();
}

function finish() {
  console.log(failed ? "\nยังมีรายการที่ต้องแก้ ดูเครื่องหมาย ✖ ด้านบน\n" : "\nพร้อมใช้งาน\n");
  process.exit(failed ? 1 : 0);
}

void main();

import { NextResponse } from "next/server";
import type { User } from "@/domain/models";
import { burnPasswordCheck, hashPasswordAsync, needsRehash, safeEqual, verifyPasswordAsync } from "@/infrastructure/auth/crypto";
import { audit, clientIp } from "@/infrastructure/audit-log";
import { credentialStore } from "@/infrastructure/repositories/store";
import { startSession } from "@/infrastructure/auth/session";
import { clearAttempts, listUsers, tooManyAttempts, transact } from "@/infrastructure/repositories/store";
import { readBody } from "@/app/api/_lib/respond";

export async function POST(request: Request) {
  try {
    return await handleLogin(request);
  } catch (error) {
    // Surface configuration problems (e.g. missing AUTH_SECRET) instead of an empty 500.
    console.error("Login failed", error);
    const message = error instanceof Error && error.message.includes("AUTH_SECRET")
      ? "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า AUTH_SECRET (ต้องยาวอย่างน้อย 16 ตัวอักษร)"
      : "ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง หรือแจ้งผู้ดูแล";
    return NextResponse.json({ message }, { status: 500 });
  }
}

async function handleLogin(request: Request) {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return NextResponse.json({ message: "ต้องส่งข้อมูลเป็น JSON" }, { status: 415 });
  }
  const body = await readBody(request);
  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const ip = clientIp(request);
  const fail = (reason: string) => {
    audit("login_failed", { username: username.slice(0, 64), reason, ip });
    return NextResponse.json({ message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }, { status: 401 });
  };
  if (!username || !password) return fail("empty");
  // Optional brute-force guard, off unless LOGIN_MAX_ATTEMPTS is set (attempts per username per 15 minutes).
  const maxAttempts = Number(process.env.LOGIN_MAX_ATTEMPTS);
  const limited = Number.isInteger(maxAttempts) && maxAttempts > 0;
  if (limited && (await tooManyAttempts(`login:${username}`, maxAttempts, 15 * 60))) {
    return NextResponse.json({ message: "ลองเข้าสู่ระบบผิดหลายครั้ง กรุณารอ 15 นาที" }, { status: 429 });
  }

  const users = await listUsers(); // a plain read: no write lock, no transaction

  // First run: no accounts exist, so ADMIN_PASSWORD bootstraps the "admin" account.
  if (users.length === 0) {
    const bootstrap = process.env.ADMIN_PASSWORD;
    if (!bootstrap || username !== "admin" || !safeEqual(password, bootstrap.trim())) return fail("bootstrap");
    const admin: User = { id: "u-admin", username: "admin", name: "ผู้ดูแลระบบ", role: "admin", active: true };
    await transact((data) => ({
      result: { ok: true as const },
      data: data.users.length ? undefined : { ...data, users: [admin] },
    }));
    await credentialStore.set(admin.id, await hashPasswordAsync(bootstrap.trim()));
    if (limited) await clearAttempts(`login:${username}`);
    await startSession(admin.id);
    audit("login_ok", { username: "admin", role: "admin", ip, bootstrap: true });
    return NextResponse.json({ user: admin });
  }

  const user = users.find((u) => u.username === username && u.active);
  const hash = user ? await credentialStore.get(user.id) : undefined;
  if (!user || !hash) {
    await burnPasswordCheck(password); // same time as a real check, so usernames cannot be probed by timing
    return fail(user ? "no_credentials" : "unknown_user");
  }
  if (!(await verifyPasswordAsync(password, hash))) return fail("bad_password");
  // Hashes made with older, weaker settings are replaced now that we hold the password.
  if (needsRehash(hash)) await credentialStore.set(user.id, await hashPasswordAsync(password));
  if (limited) await clearAttempts(`login:${username}`);
  await startSession(user.id);
  audit("login_ok", { username, role: user.role, ip });
  return NextResponse.json({ user });
}

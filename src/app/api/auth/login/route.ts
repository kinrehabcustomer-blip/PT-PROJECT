import { NextResponse } from "next/server";
import type { User } from "@/domain/models";
import { hashPassword, verifyPassword } from "@/infrastructure/auth/crypto";
import { credentialStore } from "@/infrastructure/repositories/store";
import { startSession } from "@/infrastructure/auth/session";
import { clearAttempts, tooManyAttempts, transact } from "@/infrastructure/repositories/store";
import { readBody } from "@/app/api/_lib/respond";

export async function POST(request: Request) {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return NextResponse.json({ message: "ต้องส่งข้อมูลเป็น JSON" }, { status: 415 });
  }
  const body = await readBody(request);
  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const fail = () => NextResponse.json({ message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }, { status: 401 });
  if (!username || !password) return fail();
  // Counts every attempt (5 per 15 minutes per username), shared across server instances.
  if (await tooManyAttempts(`login:${username}`, 5, 15 * 60)) {
    return NextResponse.json({ message: "ลองเข้าสู่ระบบผิดหลายครั้ง กรุณารอ 15 นาที" }, { status: 429 });
  }

  const { users } = await transact((data) => ({ result: { ok: true as const, users: data.users } }));

  // First run: no accounts exist, so ADMIN_PASSWORD bootstraps the "admin" account.
  if (users.length === 0) {
    const bootstrap = process.env.ADMIN_PASSWORD;
    if (!bootstrap || username !== "admin" || password !== bootstrap) return fail();
    const admin: User = { id: "u-admin", username: "admin", name: "ผู้ดูแลระบบ", role: "admin", active: true };
    await transact((data) => ({
      result: { ok: true as const },
      data: data.users.length ? undefined : { ...data, users: [admin] },
    }));
    await credentialStore.set(admin.id, hashPassword(bootstrap));
    await clearAttempts(`login:${username}`);
    await startSession(admin.id);
    return NextResponse.json({ user: admin });
  }

  const user = users.find((u) => u.username === username && u.active);
  const hash = user ? await credentialStore.get(user.id) : undefined;
  if (!user || !hash || !verifyPassword(password, hash)) return fail();
  await clearAttempts(`login:${username}`);
  await startSession(user.id);
  return NextResponse.json({ user });
}

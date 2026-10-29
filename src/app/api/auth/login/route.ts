import { NextResponse } from "next/server";
import type { User } from "@/domain/models";
import { hashPassword, verifyPassword } from "@/infrastructure/auth/crypto";
import { getPasswordHash, setPasswordHash } from "@/infrastructure/auth/credentials";
import { startSession } from "@/infrastructure/auth/session";
import { transact } from "@/infrastructure/repositories/file-repository";
import { readBody } from "@/app/api/_lib/respond";

// Per-process throttle: 5 failures per username per 15 minutes.
const failures = new Map<string, { count: number; first: number }>();
const WINDOW = 15 * 60_000;

function throttled(key: string): boolean {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW) return false;
  return f.count >= 5;
}
function recordFailure(key: string) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW) failures.set(key, { count: 1, first: Date.now() });
  else f.count += 1;
}

export async function POST(request: Request) {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return NextResponse.json({ message: "ต้องส่งข้อมูลเป็น JSON" }, { status: 415 });
  }
  const body = await readBody(request);
  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const fail = () => {
    recordFailure(username);
    return NextResponse.json({ message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }, { status: 401 });
  };
  if (!username || !password) return fail();
  if (throttled(username)) {
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
    await setPasswordHash(admin.id, hashPassword(bootstrap));
    await startSession(admin.id);
    return NextResponse.json({ user: admin });
  }

  const user = users.find((u) => u.username === username && u.active);
  const hash = user ? await getPasswordHash(user.id) : undefined;
  if (!user || !hash || !verifyPassword(password, hash)) return fail();
  failures.delete(username);
  await startSession(user.id);
  return NextResponse.json({ user });
}

import { NextResponse } from "next/server";
import { setUserActive } from "@/application/directory-use-cases";
import { viewFor } from "@/application/data-view";
import { hashPassword } from "@/infrastructure/auth/crypto";
import { setPasswordHash } from "@/infrastructure/auth/credentials";
import { loadData } from "@/infrastructure/repositories/file-repository";
import { guard, readBody, runAction } from "@/app/api/_lib/respond";

type Params = { params: Promise<{ id: string; action: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, action } = await params;
  if (action === "password") {
    const admin = await guard(request, ["admin"]);
    if (admin instanceof Response) return admin;
    const { password } = await readBody(request);
    if (typeof password !== "string" || password.length < 10) {
      return NextResponse.json({ message: "รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร" }, { status: 422 });
    }
    const data = await loadData();
    if (!data.users.some((u) => u.id === id)) return NextResponse.json({ message: "ไม่พบผู้ใช้งาน" }, { status: 404 });
    await setPasswordHash(id, hashPassword(password));
    return NextResponse.json(viewFor(admin, data));
  }
  if (action === "enable" || action === "disable") {
    return runAction(request, (data, _body, ctx) => setUserActive(data, id, action === "enable", ctx), ["admin"]);
  }
  return NextResponse.json({ message: "ไม่รู้จักการดำเนินการนี้" }, { status: 404 });
}

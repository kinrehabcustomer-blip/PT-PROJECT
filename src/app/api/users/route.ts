import { NextResponse } from "next/server";
import type { Role } from "@/domain/models";
import { createUser } from "@/application/directory-use-cases";
import { viewFor } from "@/application/data-view";
import { hashPasswordAsync } from "@/infrastructure/auth/crypto";
import { credentialStore } from "@/infrastructure/repositories/store";
import { toActor } from "@/infrastructure/auth/session";
import { transact } from "@/infrastructure/repositories/store";
import { guard, readBody } from "@/app/api/_lib/respond";

export async function POST(request: Request) {
  const admin = await guard(request, ["admin"]);
  if (admin instanceof Response) return admin;
  const body = await readBody(request);
  const password = String(body.password ?? "");
  if (password.length < 10) {
    return NextResponse.json({ message: "รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร" }, { status: 422 });
  }
  const outcome = await transact((data) => {
    const result = createUser(
      data,
      {
        username: String(body.username ?? ""),
        name: String(body.name ?? ""),
        role: String(body.role ?? "") as Role,
        therapistId: typeof body.therapistId === "string" ? body.therapistId : undefined,
      },
      { actor: toActor(admin) },
    );
    return { result, data: result.ok ? result.data : undefined };
  });
  if (!outcome.ok) return NextResponse.json({ message: outcome.message }, { status: 422 });
  if (!outcome.user) return NextResponse.json({ message: "สร้างผู้ใช้ไม่สำเร็จ" }, { status: 500 });
  await credentialStore.set(outcome.user.id, await hashPasswordAsync(password));
  return NextResponse.json(viewFor(admin, outcome.data));
}

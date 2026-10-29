import { NextResponse } from "next/server";
import type { Actor, AppData, Role, User } from "@/domain/models";
import type { AppointmentActionResult } from "@/application/appointment-use-cases";
import { viewFor } from "@/application/data-view";
import { currentUser, toActor } from "@/infrastructure/auth/session";
import { transact } from "@/infrastructure/repositories/file-repository";

export interface RequestContext {
  actor: Actor;
  now: Date;
}

export const unauthorized = () => NextResponse.json({ message: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

/** Mutations must be JSON: a cross-site form post cannot send that without a CORS preflight. */
function isJson(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").includes("application/json");
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Resolves the session user and enforces JSON; returns a Response to short-circuit on failure. */
export async function guard(request: Request, roles?: Role[]): Promise<User | Response> {
  if (!isJson(request)) return NextResponse.json({ message: "ต้องส่งข้อมูลเป็น JSON" }, { status: 415 });
  const user = await currentUser();
  if (!user) return unauthorized();
  if (roles && !roles.includes(user.role)) {
    return NextResponse.json({ message: "ไม่มีสิทธิ์ดำเนินการนี้" }, { status: 403 });
  }
  return user;
}

export async function runAction(
  request: Request,
  action: (data: AppData, body: Record<string, unknown>, ctx: RequestContext) => AppointmentActionResult | Promise<AppointmentActionResult>,
  roles?: Role[],
) {
  const user = await guard(request, roles);
  if (user instanceof Response) return user;
  const body = await readBody(request);
  const ctx = { actor: toActor(user), now: new Date() };
  const outcome = await transact(async (data) => {
    const result = await action(data, body, ctx);
    return { result, data: result.ok ? result.data : undefined };
  });
  return outcome.ok
    ? NextResponse.json(viewFor(user, outcome.data))
    : NextResponse.json({ message: outcome.message }, { status: 422 });
}

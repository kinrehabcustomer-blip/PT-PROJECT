import { cookies } from "next/headers";
import type { Actor, User } from "@/domain/models";
import { loadData } from "@/infrastructure/repositories/file-repository";
import { signToken, verifyToken } from "@/infrastructure/auth/crypto";

export const SESSION_COOKIE = "pt_session";
const SESSION_MS = 12 * 3_600_000;

export async function startSession(userId: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, signToken({ uid: userId, exp: Date.now() + SESSION_MS }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The signed-in, still-active user, or null. Re-read on every request so disabling takes effect at once. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const payload = token ? verifyToken(token) : null;
  if (!payload) return null;
  const user = (await loadData()).users.find((u) => u.id === payload.uid);
  return user?.active ? user : null;
}

export function toActor(user: User): Actor {
  return { name: user.name, role: user.role, therapistId: user.therapistId };
}

import { cookies } from "next/headers";
import type { Actor, User } from "@/domain/models";
import { findUser } from "@/infrastructure/repositories/store";
import { signToken, verifyToken } from "@/infrastructure/auth/crypto";

// The __Host- prefix makes browsers insist on Secure + path=/ + no Domain, so the cookie cannot be planted from a subdomain.
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-pt_session" : "pt_session";
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

/** The user id in a valid session cookie (no database access), or null. */
export async function sessionUserId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return (token ? verifyToken(token) : null)?.uid ?? null;
}

/** The signed-in, still-active user, or null. Re-read on every request so disabling takes effect at once. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const payload = token ? verifyToken(token) : null;
  if (!payload) return null;
  const user = await findUser(payload.uid);
  return user?.active ? user : null;
}

export function toActor(user: User): Actor {
  return { name: user.name, role: user.role, therapistId: user.therapistId };
}

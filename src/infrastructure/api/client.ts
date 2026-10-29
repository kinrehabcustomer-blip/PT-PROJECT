import type { AppData, User } from "@/domain/models";

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError((payload as { message?: string }).message ?? "การเชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ", response.status);
  }
  return payload as T;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export const api = {
  /**
   * Fetches the app state. Pass the ETag of what you already have: if nothing
   * changed the server answers 304 with no body and this resolves to null.
   */
  async load(etag?: string): Promise<{ user: User; data: AppData; etag: string | null } | null> {
    const response = await fetch("/api/data", { cache: "no-store", headers: etag ? { "If-None-Match": etag } : {} });
    if (response.status === 304) return null;
    const payload = await parse<{ user: User; data: AppData }>(response);
    return { ...payload, etag: response.headers.get("ETag") };
  },
  async send(method: "POST" | "PUT", path: string, body: Record<string, unknown>): Promise<AppData> {
    return parse(await fetch(path, { method, headers: JSON_HEADERS, body: JSON.stringify(body) }));
  },
  async login(username: string, password: string): Promise<User> {
    const result = await parse<{ user: User }>(
      await fetch("/api/auth/login", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ username, password }) }),
    );
    return result.user;
  },
  async logout(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST", headers: JSON_HEADERS, body: "{}" });
  },
  async dispatch(): Promise<{ sent: number; skipped: number; failed: number; queued: number }> {
    return parse(await fetch("/api/notifications/dispatch", { method: "POST", headers: JSON_HEADERS, body: "{}" }));
  },
};

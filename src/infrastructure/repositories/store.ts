import type { AppData, User } from "@/domain/models";
import { pruneOldNotifications } from "@/application/retention";
import * as file from "@/infrastructure/repositories/file-repository";
import { createPostgresRepository } from "@/infrastructure/repositories/postgres-repository";
import { createPgDb, databaseUrl } from "@/infrastructure/repositories/pg-client";

type Lock = <T>(name: string, ttlSeconds: number, fn: () => Promise<T>) => Promise<{ ran: true; value: T } | { ran: false }>;
type Tx = <T extends { ok: boolean }>(
  fn: (data: AppData) => Promise<{ result: T; data?: AppData }> | { result: T; data?: AppData },
) => Promise<T>;

interface Backend {
  loadData(): Promise<AppData>;
  transact: Tx;
  findUser(id: string): Promise<User | undefined>;
  listUsers(): Promise<User[]>;
  getHash(userId: string): Promise<string | undefined>;
  setHash(userId: string, hash: string): Promise<void>;
  tryLock: Lock;
  tooManyAttempts(key: string, max: number, windowSeconds: number): Promise<boolean>;
  clearAttempts(key: string): Promise<void>;
}

// --- Local development / single always-on server -------------------------------------------
const localHits = new Map<string, { count: number; resetAt: number }>();
const localHit = async (key: string, max: number, windowSeconds: number) => {
  const hit = localHits.get(key);
  if (!hit || hit.resetAt < Date.now()) {
    localHits.set(key, { count: 1, resetAt: Date.now() + windowSeconds * 1000 });
    return 1 > max;
  }
  hit.count += 1;
  return hit.count > max;
};

const fileBackend: Backend = {
  loadData: file.loadData,
  transact: file.transact,
  findUser: async (id) => (await file.loadData()).users.find((u) => u.id === id),
  listUsers: async () => (await file.loadData()).users,
  getHash: file.getHash,
  setHash: file.setHash,
  tryLock: file.tryLock,
  tooManyAttempts: localHit,
  clearAttempts: async (key) => void localHits.delete(key),
};

/** Documents saved before a collection existed (local file) simply lack it. */
function withDefaults(data: AppData): AppData {
  return { ...data, linkRequests: data.linkRequests ?? [], assignments: data.assignments ?? [] };
}

let postgres: Backend | undefined;

/** Postgres (Neon) when DATABASE_URL is set; otherwise local JSON files (development or one always-on server). */
function backend(): Backend {
  const url = databaseUrl();
  if (url) return (postgres ??= createPostgresRepository(createPgDb(url)));
  if (process.env.VERCEL) {
    throw new Error("ยังไม่ได้ตั้งค่าที่เก็บข้อมูล: Vercel เขียนไฟล์ไม่ได้ กรุณาตั้งค่า DATABASE_URL (Neon Postgres)");
  }
  return fileBackend;
}

export const loadData = async (): Promise<AppData> => withDefaults(await backend().loadData());
export const findUser = (id: string) => backend().findUser(id);
export const listUsers = () => backend().listUsers();

export const transact: Tx = (fn) =>
  backend().transact(async (current) => {
    const out = await fn(withDefaults(current));
    return out.data ? { ...out, data: pruneOldNotifications(out.data) } : out;
  });

export const tryLock: Lock = (name, ttl, fn) => backend().tryLock(name, ttl, fn);

export const credentialStore = {
  get: (userId: string) => backend().getHash(userId),
  set: (userId: string, hash: string) => backend().setHash(userId, hash),
};

/** Counts an attempt; true when `key` has exceeded `max` within the window. */
export const tooManyAttempts = (key: string, max: number, windowSeconds: number) =>
  backend().tooManyAttempts(key, max, windowSeconds);
export const clearAttempts = (key: string) => backend().clearAttempts(key);

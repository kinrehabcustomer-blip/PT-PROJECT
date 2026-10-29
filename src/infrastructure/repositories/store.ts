import type { AppData } from "@/domain/models";
import { pruneOldNotifications } from "@/application/retention";
import * as file from "@/infrastructure/repositories/file-repository";
import * as redis from "@/infrastructure/repositories/redis-repository";

/**
 * The one place the app talks to storage. Redis when configured (required on
 * serverless hosts), otherwise a local JSON file for development or a single
 * always-on server.
 */
function backend() {
  if (redis.redisConfigured()) return redis;
  if (process.env.VERCEL) {
    throw new Error(
      "ยังไม่ได้ตั้งค่าที่เก็บข้อมูล: Vercel เขียนไฟล์ไม่ได้ กรุณาเพิ่ม Upstash Redis (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)",
    );
  }
  return file;
}

export const loadData = (): Promise<AppData> => backend().loadData();

export function transact<T extends { ok: boolean }>(
  fn: (data: AppData) => Promise<{ result: T; data?: AppData }> | { result: T; data?: AppData },
): Promise<T> {
  return backend().transact(async (current) => {
    const out = await fn(current);
    return out.data ? { ...out, data: pruneOldNotifications(out.data) } : out;
  });
}

export const tryLock = <T>(name: string, ttlSeconds: number, fn: () => Promise<T>) =>
  backend().tryLock(name, ttlSeconds, fn);

export const credentialStore = {
  get: (userId: string) => (redis.redisConfigured() ? redis.getHash(userId) : file.getHash(userId)),
  set: (userId: string, hash: string) => (redis.redisConfigured() ? redis.setHash(userId, hash) : file.setHash(userId, hash)),
};

const localHits = new Map<string, { count: number; resetAt: number }>();

/** Counts an attempt; true when `key` has exceeded `max` within the window. Shared across instances on Redis. */
export async function tooManyAttempts(key: string, max: number, windowSeconds: number): Promise<boolean> {
  if (redis.redisConfigured()) {
    const k = `pt:rl:${key}`;
    const count = await redis.redis<number>("INCR", k);
    if (count === 1) await redis.redis("EXPIRE", k, windowSeconds);
    return count > max;
  }
  const hit = localHits.get(key);
  if (!hit || hit.resetAt < Date.now()) {
    localHits.set(key, { count: 1, resetAt: Date.now() + windowSeconds * 1000 });
    return 1 > max;
  }
  hit.count += 1;
  return hit.count > max;
}

export async function clearAttempts(key: string): Promise<void> {
  localHits.delete(key);
  if (redis.redisConfigured()) await redis.redis("DEL", `pt:rl:${key}`);
}

import type { AppData } from "@/domain/models";
import { seedData } from "@/infrastructure/repositories/seed-data";

/**
 * Upstash Redis (REST) storage, for serverless hosts such as Vercel where the
 * filesystem is read-only. The whole app state lives under one key and is
 * written with compare-and-set, so concurrent requests on different server
 * instances can never overwrite each other: the loser re-reads and retries.
 */
const DB_KEY = "pt:db";
const MAX_RETRIES = 20;

function config() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

export const redisConfigured = () => config() !== null;

export async function redis<T = unknown>(...command: Array<string | number>): Promise<T> {
  const cfg = config();
  if (!cfg) throw new Error("Redis is not configured");
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok || payload.error) throw new Error(`Redis error: ${payload.error ?? res.status}`);
  return payload.result as T;
}

const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if (cur == false and ARGV[1] == '') or cur == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2])
  return 1
end
return 0`;

async function readRaw(): Promise<string | null> {
  return redis<string | null>("GET", DB_KEY);
}

function parse(raw: string | null): AppData {
  return raw ? (JSON.parse(raw) as AppData) : seedData;
}

export async function loadData(): Promise<AppData> {
  return parse(await readRaw());
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn` against the latest data and stores the result if it returns data.
 * `fn` may run more than once when another request wins the race, so it must
 * not have side effects beyond returning its result.
 */
export async function transact<T extends { ok: boolean }>(
  fn: (data: AppData) => Promise<{ result: T; data?: AppData }> | { result: T; data?: AppData },
): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const raw = await readRaw();
    const { result, data } = await fn(parse(raw));
    if (!data) return result;
    const stored = await redis<number>("EVAL", CAS_SCRIPT, 1, DB_KEY, raw ?? "", JSON.stringify(data));
    if (stored === 1) return result;
    await sleep(10 + Math.random() * Math.min(40 * (attempt + 1), 400));
  }
  throw new Error("ระบบกำลังมีผู้ใช้งานพร้อมกันมาก กรุณาลองใหม่อีกครั้ง");
}

/** Cross-instance lock, so two dispatch runs cannot message the same person twice. */
export async function tryLock<T>(name: string, ttlSeconds: number, fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  const key = `pt:lock:${name}`;
  const acquired = await redis<string | null>("SET", key, "1", "NX", "EX", ttlSeconds);
  if (acquired !== "OK") return { ran: false };
  try {
    return { ran: true, value: await fn() };
  } finally {
    await redis("DEL", key).catch(() => undefined);
  }
}

export async function getHash(userId: string): Promise<string | undefined> {
  return (await redis<string | null>("HGET", "pt:credentials", userId)) ?? undefined;
}

export async function setHash(userId: string, hash: string): Promise<void> {
  await redis("HSET", "pt:credentials", userId, hash);
}

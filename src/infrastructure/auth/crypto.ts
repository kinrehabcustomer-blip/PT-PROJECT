import { createHash, createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing: scrypt with N=2^15, r=8, p=3 (one of the combinations
 * OWASP's Password Storage Cheat Sheet lists as equivalent), stored as
 *   scrypt2$N$r$p$salt$hash
 * Hashes made by the first version of this app (Node's defaults, "scrypt$salt$hash")
 * still verify, and are upgraded the next time that person signs in.
 */
const N = 32_768;
const R = 8;
const P = 3;
const KEYLEN = 64;
const MAXMEM = 128 * N * R * P > 64 * 1024 * 1024 ? 256 * 1024 * 1024 : 64 * 1024 * 1024;

interface Params { N: number; r: number; p: number; salt: Buffer; hash: Buffer }

function parse(stored: string): Params | null {
  const part = stored.split("$");
  try {
    if (part[0] === "scrypt2" && part.length === 6) {
      return { N: Number(part[1]), r: Number(part[2]), p: Number(part[3]), salt: Buffer.from(part[4], "hex"), hash: Buffer.from(part[5], "hex") };
    }
    if (part[0] === "scrypt" && part.length === 3) {
      return { N: 16_384, r: 8, p: 1, salt: Buffer.from(part[1], "hex"), hash: Buffer.from(part[2], "hex") };
    }
  } catch {
    return null;
  }
  return null;
}

const scryptAsync = promisify(scrypt) as (
  password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const options = (p: Pick<Params, "N" | "r" | "p">) => ({ N: p.N, r: p.r, p: p.p, maxmem: MAXMEM });
const encode = (salt: Buffer, hash: Buffer) => `scrypt2$${N}$${R}$${P}$${salt.toString("hex")}$${hash.toString("hex")}`;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return encode(salt, scryptSync(password, salt, KEYLEN, options({ N, r: R, p: P })));
}

/** Same as hashPassword, but does not freeze the server while it runs. Use this in request handlers. */
export async function hashPasswordAsync(password: string): Promise<string> {
  const salt = randomBytes(16);
  return encode(salt, await scryptAsync(password, salt, KEYLEN, options({ N, r: R, p: P })));
}

export async function verifyPasswordAsync(password: string, stored: string): Promise<boolean> {
  const params = parse(stored);
  if (!params || !params.hash.length) return false;
  const actual = await scryptAsync(password, params.salt, params.hash.length, options(params));
  return timingSafeEqual(actual, params.hash);
}

export function verifyPassword(password: string, stored: string): boolean {
  const params = parse(stored);
  if (!params || !params.hash.length) return false;
  return timingSafeEqual(scryptSync(password, params.salt, params.hash.length, options(params)), params.hash);
}

/** True when a stored hash was made with weaker settings than today's and should be replaced after a successful sign-in. */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith(`scrypt2$${N}$${R}$${P}$`);
}

let dummyHash: Promise<string> | undefined;
/**
 * Spend the same time as a real check when the user does not exist, so the
 * response time does not reveal which usernames are real.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPasswordAsync("not-a-real-password");
  await verifyPasswordAsync(password, await dummyHash);
}

/** Constant-time string comparison (hashes first, so length is not revealed either). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (value && value.length >= 16) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET (อย่างน้อย 16 ตัวอักษร) ต้องถูกตั้งค่าก่อนใช้งานจริง");
  }
  return "dev-only-insecure-secret";
}

const b64 = (buf: Buffer) => buf.toString("base64url");

export function signToken(payload: { uid: string; exp: number }): string {
  const body = b64(Buffer.from(JSON.stringify(payload)));
  return `${body}.${b64(createHmac("sha256", secret()).update(body).digest())}`;
}

export function verifyToken(token: string): { uid: string; exp: number } | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return typeof payload.uid === "string" && typeof payload.exp === "number" && payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export function verifyLineSignature(rawBody: string, signature: string | null, channelSecret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", channelSecret).update(rawBody).digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

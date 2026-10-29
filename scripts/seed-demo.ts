/**
 * Creates demo login accounts (admin, front-desk staff, one per therapist) on
 * top of the demo data. Passwords are random and printed once.
 *
 *   npm run seed:demo            first time (refuses if data/ already exists)
 *   npm run seed:demo -- --reset wipes data/ and starts over
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import type { User } from "../src/domain/models";
import { hashPassword } from "../src/infrastructure/auth/crypto";
import { setPasswordHash } from "../src/infrastructure/auth/credentials";
import { transact } from "../src/infrastructure/repositories/file-repository";

const dataDir = path.join(process.cwd(), "data");

function envAdminPassword(): string | undefined {
  try {
    const line = readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("ADMIN_PASSWORD="));
    return line?.slice("ADMIN_PASSWORD=".length).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  if (existsSync(dataDir)) {
    if (!process.argv.includes("--reset")) {
      console.error("data/ already exists. Re-run with `-- --reset` to wipe it and recreate the demo data.");
      process.exit(1);
    }
    rmSync(dataDir, { recursive: true, force: true });
  }

  const accounts: Array<{ user: User; password: string }> = [];
  const pw = () => randomBytes(9).toString("base64url");
  accounts.push({ user: { id: "u-admin", username: "admin", name: "ผู้ดูแลระบบ", role: "admin", active: true }, password: envAdminPassword() ?? pw() });
  accounts.push({ user: { id: "u-front", username: "front", name: "เจ้าหน้าที่ต้อนรับ", role: "staff", active: true }, password: pw() });
  const therapistLogins: Record<string, string> = { "t-1": "pim", "t-2": "thanakorn", "t-3": "natcha", "t-4": "worathep", "t-5": "chonticha" };

  await transact((data) => {
    for (const t of data.therapists) {
      const username = therapistLogins[t.id];
      if (username) accounts.push({ user: { id: `u-${t.id}`, username, name: t.name, role: "therapist", therapistId: t.id, active: true }, password: pw() });
    }
    return { result: { ok: true as const }, data: { ...data, users: accounts.map((a) => a.user) } };
  });
  for (const { user, password } of accounts) await setPasswordHash(user.id, hashPassword(password));

  console.log("\nDemo accounts (shown once):\n");
  for (const { user, password } of accounts) console.log(`  ${user.role.padEnd(10)} ${user.username.padEnd(11)} ${password}   ${user.name}`);
  console.log("");
}

void main();

import { promises as fs } from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "data", "credentials.json");
let queue: Promise<unknown> = Promise.resolve();

async function read(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function getPasswordHash(userId: string): Promise<string | undefined> {
  return (await read())[userId];
}

export function setPasswordHash(userId: string, hash: string): Promise<void> {
  const run = queue.then(async () => {
    const all = await read();
    all[userId] = hash;
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(all), { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmp, FILE);
  });
  queue = run.catch(() => undefined);
  return run;
}

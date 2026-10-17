import { randomUUID } from "node:crypto";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

export const dataDirectory = path.resolve(process.env.DATA_DIR ?? "./data");

export async function ensureDataDirectory(): Promise<void> {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  await access(dataDirectory, constants.R_OK | constants.W_OK);
}

export async function verifyWritableStorage(): Promise<void> {
  await access(dataDirectory, constants.R_OK | constants.W_OK);
  const probe = path.join(dataDirectory, `.health-${randomUUID()}`);
  try {
    await writeFile(probe, "ok", { flag: "wx", mode: 0o600 });
  } finally {
    await unlink(probe).catch(() => undefined);
  }
}

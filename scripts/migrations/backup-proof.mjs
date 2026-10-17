import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

// Validates the encrypted archive, never reads encryption keys. A receipt is
// evidence of an operator-supplied backup, not proof of a tested restoration.
export async function verifyBackup(directory) {
  if (!directory) throw new Error("Para --baseline se requiere --backup-dir con copia cifrada y SHA256SUMS.");
  const expected = new Map();
  const sums = await readFile(path.join(directory, "SHA256SUMS"), "utf8");
  for (const line of sums.trim().split("\n")) {
    const match = /^([a-f0-9]{64})  (database\.dump\.enc|documents\.tar\.gz\.enc)$/.exec(line);
    if (!match || expected.has(match[2])) throw new Error("Manifest de copia inválido.");
    expected.set(match[2], match[1]);
  }
  if (expected.size !== 2) throw new Error("Copia incompleta.");
  for (const [name, checksum] of expected) {
    const file = path.join(directory, name);
    const info = await stat(file);
    if (!info.isFile() || info.size < 32) throw new Error("Archivo de copia vacío o inválido.");
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(file)) digest.update(chunk);
    if (digest.digest("hex") !== checksum) throw new Error("La suma de la copia no coincide.");
  }
}

import { createHash } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { buildSchoolYearExport } from "./school-year-export";
import { dataDirectory } from "./storage";

type Exported = ReturnType<typeof buildSchoolYearExport>;
type Source = { source: string; id: string; data: Record<string, unknown> };
type LiveVersion = {
  documentId: string; version: number; storageKey: string; sha256: string;
  scanStatus: string; sizeBytes: number;
};
type Status = "included" | "missing" | "checksum_mismatch" | "security_blocked";
type Entry = {
  versionId: string; documentId: string; version: unknown;
  status: Status; file?: string; sha256?: string; sizeBytes?: number;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxFile = 8 * 1024 * 1024;
export class OriginalsLimit extends Error {}

// Read once from an opened regular file; never follow symlinks or return storage
// locators. ZIP bytes are staged privately after verification, avoiding TOCTOU.
async function readOriginal(key: string): Promise<Buffer | "missing" | "security_blocked"> {
  if (!key || key !== path.basename(key) || /[\\/\x00]/.test(key) || key === "." || key === "..")
    return "security_blocked";
  let handle;
  try {
    const directory = path.join(dataDirectory, "documents");
    if (await realpath(directory) !== directory) return "security_blocked";
    handle = await open(path.join(directory, key), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxFile) return "security_blocked";
    // Bound the read even if the file grows after stat.
    const buffer = Buffer.alloc(maxFile + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    return size > maxFile ? "security_blocked" : buffer.subarray(0, size);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "security_blocked";
  } finally { await handle?.close(); }
}

/** Caller must authorize current and historical C2/admin access before invoking. */
export async function buildOriginalsPackage(
  exported: Exported,
  sources: Source[],
  liveVersions: Map<string, LiveVersion>,
) {
  const versions = sources.filter(s => s.source === "document_versions");
  if (versions.length > 2000) throw new OriginalsLimit("El paquete supera el límite de 2000 versiones.");
  const directory = await mkdtemp(path.join(tmpdir(), "innova-originals-"));
  const dispose = () => rm(directory, { recursive: true, force: true });
  try {
    const stagedFiles: { staged: string; file: string }[] = [];
    const documents = new Map(sources.filter(s => s.source === "documents").map(s => [s.id, s.data]));
    const entries: Entry[] = [];
    let total = 0;
    for (const source of versions) {
      const v = source.data;
      const documentId = String(v.document_id ?? "");
      const entry: Entry = { versionId: source.id, documentId, version: v.version, status: "security_blocked" };
      entries.push(entry);
      const document = documents.get(documentId);
      // Only immutable references from this course; never resolve currentVersion.
      if (!uuid.test(source.id) || !uuid.test(documentId) || !document ||
          document.school_year_id !== exported.schoolYear.id ||
          !Number.isInteger(v.version) || Number(v.version) < 1 ||
          v.scan_status !== "limpio" || typeof v.storage_key !== "string" ||
          typeof v.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(v.sha256)) continue;
      const live = liveVersions.get(source.id);
      if (!live) { entry.status = "missing"; continue; }
      // Honor a subsequent security block too, even for an archived clean file.
      if (live.scanStatus !== "limpio" || live.documentId !== documentId ||
          live.version !== v.version || live.storageKey !== v.storage_key ||
          live.sha256 !== v.sha256 || live.sizeBytes !== v.size_bytes) continue;
      const bytes = await readOriginal(v.storage_key);
      if (typeof bytes === "string") { entry.status = bytes; continue; }
      const checksum = createHash("sha256").update(bytes).digest("hex");
      if (checksum !== v.sha256 || bytes.length !== v.size_bytes) {
        entry.status = "checksum_mismatch"; continue;
      }
      total += bytes.length;
      if (total > 128 * 1024 * 1024) throw new OriginalsLimit("El paquete supera el límite de 128 MiB.");
      // Generated names prevent ZIP traversal and disclose no storage filenames.
      const extension = typeof v.original_name === "string"
        ? path.extname(v.original_name).toLowerCase() : "";
      const file = `originales/${documentId}/v${v.version}-${source.id}${/^\.[a-z0-9]{1,10}$/.test(extension) ? extension : ""}`;
      const staged = path.join(directory, source.id);
      await writeFile(staged, bytes, { flag: "wx", mode: 0o600 });
      stagedFiles.push({ staged, file });
      Object.assign(entry, { status: "included", file, sha256: checksum, sizeBytes: bytes.length });
    }
    const report = {
      format: "innova-c2.closed-school-year.originals", version: 1,
      schoolYear: exported.schoolYear, sourceHash: exported.archive.sourceHash,
      notice: "Paquete parcial de originales autorizados y disponibles. No sustituye una copia de seguridad, no restaura datos ni certifica aprobación o entrega del PIC.",
      statuses: {
        included: "Original incluido; análisis limpio y SHA-256 y tamaño coincidentes con la referencia archivada.",
        missing: "Versión o archivo ausente.",
        checksum_mismatch: "El contenido o tamaño no coincide con la referencia archivada; no incluido.",
        security_blocked: "Bloqueo de seguridad: cuarentena, análisis no limpio, referencia no válida o almacenamiento no seguro; no incluido.",
      },
      entries,
    };
    const zip = new ZipFile();
    zip.on("error", error => (zip.outputStream as Readable).destroy(error));
    const filename = path.join(directory, "originales.zip");
    const completed = pipeline(zip.outputStream, createWriteStream(filename, { mode: 0o600 }));
    for (const { staged, file } of stagedFiles) zip.addFile(staged, file);
    zip.addBuffer(Buffer.from(JSON.stringify(exported, null, 2) + "\n"), "expediente.json");
    zip.addBuffer(Buffer.from(JSON.stringify(report, null, 2) + "\n"), "informe-originales.json");
    zip.end();
    await completed;
    return { filename, dispose, entries };
  } catch (error) { await dispose(); throw error; }
}

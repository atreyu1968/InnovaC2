import { createHash } from "node:crypto";
import { CycleConflict } from "./school-cycle";

type Source = { source: string; id: string; data: Record<string, unknown> };

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

// JSONB reorders object keys. Restore the insertion order used by the original
// closure serializer, not a new hash algorithm that would invalidate old archives.
function ordered(value: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries([...keys, ...Object.keys(value).filter(k => !keys.includes(k))]
    .filter(k => Object.hasOwn(value, k)).map(k => [k, value[k]]));
}

export function verifyArchivedSnapshot(content: Record<string, unknown>, expectedHash: string) {
  const validation = content.validation as Record<string, unknown> | undefined;
  const sources = content.sources as Source[] | undefined;
  if (!validation || !Array.isArray(sources) || sources.some(s =>
    !s || typeof s.source !== "string" || typeof s.id !== "string" ||
    !s.data || typeof s.data !== "object" || Array.isArray(s.data)))
    throw new CycleConflict("La instantánea archivada no es válida.");
  const restored = ordered({
    ...content,
    validation: ordered(validation, ["canClose", "revision", "blockers", "warnings"]),
    sources: sources.map(s => ordered(s, ["source", "id", "data"])),
  }, ["schemaVersion", "schoolYearId", "label", "validation", "sources"]);
  if (sha256(JSON.stringify(restored)) !== expectedHash)
    throw new CycleConflict("La huella del expediente no coincide con la archivada. No se ha generado la descarga.");
}

// Remove storage locators at every depth, including version/submission payloads.
export function publicArchiveValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicArchiveValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !/(?:storage[_-]?key|storage[_-]?path|private[_-]?path|file[_-]?path|object[_-]?path)/i.test(key))
    .map(([key, item]) => [key, publicArchiveValue(item)]));
}

export function buildSchoolYearExport(
  year: { id: string; label: string; closedAt: Date | null },
  snapshot: { content: Record<string, unknown>; sourceHash: string; createdAt: Date },
) {
  verifyArchivedSnapshot(snapshot.content, snapshot.sourceHash);
  if (snapshot.content.schoolYearId !== year.id || snapshot.content.label !== year.label || !year.closedAt)
    throw new CycleConflict("La identificación de la instantánea no coincide con el curso cerrado.");
  const content = publicArchiveValue(snapshot.content) as Record<string, unknown> & { sources: Source[] };
  return {
    format: "innova-c2.closed-school-year",
    version: 1,
    schoolYear: { id: year.id, label: year.label, closedAt: year.closedAt.toISOString() },
    archive: {
      sourceHash: snapshot.sourceHash, capturedAt: snapshot.createdAt.toISOString(),
      verified: true,
      verification: "El servidor ha cotejado la instantánea íntegra con sourceHash antes de retirar las rutas privadas. sourceHash no es el checksum del contenido público ni una firma digital.",
    },
    manifest: {
      algorithm: "SHA-256",
      serialization: "JSON UTF-8 sin espacios; claves de objetos ordenadas recursivamente por orden UTF-16; orden de arrays conservado.",
      scope: "Instantánea de datos y metadatos del curso cerrado. No incluye archivos binarios ni ubicaciones de almacenamiento. No acredita aprobación o entrega del PIC.",
      contentSha256: sha256(canonicalJson(content)),
      sources: content.sources.map((source, index) => ({
        index, source: source.source, id: source.id, sha256: sha256(canonicalJson(source)),
      })),
    },
    content,
  };
}

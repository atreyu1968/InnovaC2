// Offline verification: no network, database, credentials or application setup.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const canonical = value => value === null || typeof value !== "object" ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const hash = value => createHash("sha256").update(canonical(value), "utf8").digest("hex");

try {
  assert.ok(process.argv[2], "Uso: node scripts/verify-school-year-export.mjs expediente.json");
  const exported = JSON.parse(await readFile(process.argv[2], "utf8"));
  assert.equal(exported.format, "innova-c2.closed-school-year");
  assert.equal(exported.version, 1);
  assert.equal(exported.manifest.algorithm, "SHA-256");
  assert.equal(exported.schoolYear.id, exported.content.schoolYearId);
  assert.equal(exported.schoolYear.label, exported.content.label);
  assert.equal(hash(exported.content), exported.manifest.contentSha256, "El contenido ha cambiado.");
  assert.equal(exported.manifest.sources.length, exported.content.sources.length);
  exported.manifest.sources.forEach((entry, index) => {
    const source = exported.content.sources[index];
    assert.equal(entry.index, index);
    assert.equal(entry.source, source.source);
    assert.equal(entry.id, source.id);
    assert.equal(entry.sha256, hash(source), `La fuente ${index} ha cambiado.`);
  });
  console.log(`Checksums correctos: curso ${exported.schoolYear.label}, ${exported.content.sources.length} fuentes.`);
  console.log("Esto comprueba la integridad interna, no la autenticidad ni una firma digital. La huella privada archivada solo se coteja en el servidor al exportar.");
} catch (error) {
  console.error(`Expediente no verificable: ${error.message}`);
  process.exitCode = 1;
}

// Called only from the disposable school-cycle cluster, never a supplied DB.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
export async function prepareOriginals(pool, dataDir, center, yearId, userId) {
  const documentId = (await pool.query(`INSERT INTO documents
    (center_id,school_year_id,title,created_by,status,current_version,access_scope)
    VALUES ($1,$2,'Originals export cases',$3,'aprobado',2,'restricted') RETURNING id`,
    [center, yearId, userId])).rows[0].id;
  const cases = [
    ["included", "limpio"], ["included", "limpio"],
    ["missing", "limpio"], ["checksum_mismatch", "limpio"],
    ["security_blocked", "infectado"], ["security_blocked", "no_disponible"],
    ["security_blocked", "no_configurado"], ["security_blocked", "limpio", "../outside"],
    ["security_blocked", "limpio", "symlink"],
  ];
  await mkdir(path.join(dataDir, "documents"), { recursive: true });
  const fixtures = [];
  for (const [i, [status, scan, special]] of cases.entries()) {
    const bytes = Buffer.from(`Original immutable version ${i + 1}`);
    const key = special === "../outside" ? special : randomUUID();
    const row = (await pool.query(`INSERT INTO document_versions
      (document_id,version,original_name,media_type,size_bytes,sha256,storage_key,scan_status)
      VALUES ($1,$2,'evidence.txt','text/plain',$3,$4,$5,$6) RETURNING id`,
      [documentId, i + 1, bytes.length, sha(bytes), key, scan])).rows[0];
    const file = path.join(dataDir, "documents", key);
    if (special === "symlink") {
      const outside = path.join(dataDir, "outside");
      await writeFile(outside, bytes);
      await symlink(outside, file);
    } else if (status !== "missing") {
      await writeFile(file, status === "checksum_mismatch" ? Buffer.alloc(bytes.length, 120) : bytes);
    }
    fixtures.push({ id: row.id, status, bytes, file });
  }
  return fixtures;
}

export async function verifyOriginals(request, year, session, directory, exported, fixtures) {
  const response = await request(`/school-years/${year.id}/originals`, { session, binary: true });
  assert.equal(response.status, 200, String(response.data));
  assert.equal(response.headers.get("content-type"), "application/zip");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(response.headers.get("content-disposition"), /attachment; filename="originales-/);
  const zip = path.join(directory, "originals-test.zip");
  await writeFile(zip, response.data);
  const extract = name => {
    const result = spawnSync("unzip", ["-p", zip, name]);
    assert.equal(result.status, 0, result.stderr.toString());
    return result.stdout;
  };
  assert.deepEqual(JSON.parse(extract("expediente.json")), exported);
  const report = JSON.parse(extract("informe-originales.json"));
  assert.equal(report.sourceHash, exported.archive.sourceHash);
  assert.equal(report.schoolYear.id, year.id);
  assert.equal(report.entries.length, exported.content.sources.filter(s => s.source === "document_versions").length);
  assert.ok(!/storage_key|storageKey|immutable\/|\.\.\/outside/.test(JSON.stringify(report)));
  for (const fixture of fixtures) {
    const entry = report.entries.find(e => e.versionId === fixture.id);
    assert.equal(entry?.status, fixture.status);
    if (entry.status === "included") {
      const bytes = extract(entry.file);
      assert.deepEqual(bytes, fixture.bytes);
      assert.equal(sha(bytes), entry.sha256);
      assert.equal(bytes.length, entry.sizeBytes);
    } else {
      assert.equal(entry.file, undefined);
      assert.equal(entry.sha256, undefined);
    }
  }
  const list = spawnSync("unzip", ["-Z1", zip], { encoding: "utf8" });
  assert.equal(list.status, 0);
  assert.equal(list.stdout.trim().split("\n").length, 2 + report.entries.filter(e => e.status === "included").length);
  if (!fixtures.length) return;
  // A formerly available original can disappear without modifying the archive.
  const included = fixtures[0];
  const original = await readFile(included.file);
  await rm(included.file);
  try {
    const partial = await request(`/school-years/${year.id}/originals`, { session, binary: true });
    assert.equal(partial.status, 200);
    await writeFile(zip, partial.data);
    assert.equal(JSON.parse(extract("informe-originales.json")).entries.find(e => e.versionId === included.id).status, "missing");
  } finally { await writeFile(included.file, original); }
}

// A security block applied after closure overrides the archived clean result.
// Deliberate mutation is confined to the disposable cluster.
export async function verifyLiveBlock(pool, request, year, session, directory, fixture) {
  await pool.query("ALTER TABLE document_versions DISABLE TRIGGER USER");
  try {
    await pool.query("UPDATE document_versions SET scan_status='infectado' WHERE id=$1", [fixture.id]);
    const response = await request(`/school-years/${year.id}/originals`, { session, binary: true });
    assert.equal(response.status, 200);
    const zip = path.join(directory, "originals-blocked.zip");
    await writeFile(zip, response.data);
    const result = spawnSync("unzip", ["-p", zip, "informe-originales.json"]);
    assert.equal(result.status, 0);
    const entry = JSON.parse(result.stdout).entries.find(e => e.versionId === fixture.id);
    assert.equal(entry.status, "security_blocked");
    assert.equal(entry.file, undefined);
  } finally {
    await pool.query("UPDATE document_versions SET scan_status='limpio' WHERE id=$1", [fixture.id]);
    await pool.query("ALTER TABLE document_versions ENABLE TRIGGER USER");
  }
}

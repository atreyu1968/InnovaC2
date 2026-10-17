import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function verifyRealClamAv({
  request, expectStatus, pool, testDataDirectory, clamPort,
  teacherASession: owner, teacherBSession: reader, headASession: head,
  c2Session: c2, admin, documentId, uploaded, newVersion, uploadParams,
  numericIndicator, activity,
}) {
  // EICAR is a harmless standard antivirus test string, never a real malware sample.
  const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
  const clamDirectory = path.join(testDataDirectory, "clamav");
  await mkdir(clamDirectory);
  // Deterministic test-only signature database. Production must use freshclam feeds.
  await writeFile(path.join(clamDirectory, "test.hdb"),
    `${createHash("md5").update(eicar).digest("hex")}:${eicar.length}:Eicar-Test-Signature\n`);
  const config = path.join(clamDirectory, "clamd.conf");
  await writeFile(config, [
    "Foreground yes", `DatabaseDirectory ${clamDirectory}`,
    "TCPSocket " + clamPort, "TCPAddr 127.0.0.1", "StreamMaxLength 10M",
    "LogTime yes", "SelfCheck 0",
  ].join("\n") + "\n");
  let daemon;
  let output = "";
  async function stop() {
    if (!daemon || daemon.exitCode !== null) return;
    const exited = once(daemon, "exit");
    daemon.kill("SIGTERM");
    await exited;
  }
  async function start() {
    daemon = spawn(process.env.CLAMD_BIN || "clamd", ["--config-file", config], { stdio: ["ignore", "pipe", "pipe"] });
    daemon.stdout.on("data", c => { output += c; });
    daemon.stderr.on("data", c => { output += c; });
    daemon.on("error", e => { output += e.message; });
    for (let i = 0; i < 100; i++) {
      if (daemon.exitCode !== null) throw new Error(`Real clamd exited: ${output}`);
      const pong = await new Promise(resolve => {
        const socket = createConnection({ host: "127.0.0.1", port: clamPort });
        socket.setTimeout(100);
        socket.on("connect", () => socket.write("zPING\0"));
        socket.on("data", c => { socket.destroy(); resolve(c.toString().startsWith("PONG")); });
        socket.on("error", () => resolve(false));
        socket.on("timeout", () => { socket.destroy(); resolve(false); });
      });
      if (pong) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Real clamd did not become ready: ${output}`);
  }
  const post = (url, session, body) => request(url, { method: "POST", ...session, body });
  const rescan = (id, version, revision, session = owner) =>
    post(`/documents/${id}/versions/${version}/rescan`, session, { expectedRevision: revision });
  const snapshot = async id => (await pool.query(
    "SELECT id, version, storage_key, sha256, size_bytes FROM document_versions WHERE document_id=$1 ORDER BY version", [id])).rows;
  const versionsBefore = await snapshot(documentId);
  const bytesBefore = await Promise.all(versionsBefore.map(v =>
    readFile(path.join(testDataDirectory, "documents", v.storage_key))));
  const current = async id => (await request(`/documents/${id}`, { cookie: c2.cookie })).data.document;
  const count = async () => {
    const summary = await request("/indicators/current", { cookie: c2.cookie });
    expectStatus(summary, 200, "indicator summary");
    return summary.data.find(i => i.code === numericIndicator.code).activityCount;
  };
  try {
    expectStatus(await rescan(documentId, 2, newVersion.data.revision, reader), 403, "explicit read grant is not scan authority");
    expectStatus(await rescan(documentId, 2, newVersion.data.revision, head), 403, "same-family head is not owner");
    expectStatus(await post(`/documents/${documentId}/versions/2/rescan`, { cookie: owner.cookie },
      { expectedRevision: newVersion.data.revision }), 403, "rescan requires CSRF");
    expectStatus(await post(`/documents/${documentId}/versions/2/rescan`, {}, { expectedRevision: 1 }), 401, "rescan requires session");
    expectStatus(await rescan(documentId, 0, newVersion.data.revision), 400, "invalid version");
    expectStatus(await rescan(documentId, 999, newVersion.data.revision), 404, "missing version");
    const unavailable = await rescan(documentId, 2, newVersion.data.revision);
    expectStatus(unavailable, 200, "unavailable ClamAV recorded");
    assert.equal(unavailable.data.scanStatus, "no_disponible");
    assert.equal(await count(), 0);
    expectStatus(await request(`/documents/${documentId}/versions/2/content`, { cookie: owner.cookie }), 409, "unavailable blocks download");
    expectStatus(await post(`/documents/${documentId}/approve`, c2, { expectedRevision: unavailable.data.revision }), 409, "unavailable blocks approval");

    const infectedParams = new URLSearchParams(uploadParams);
    infectedParams.set("fileName", "antivirus-test.txt");
    infectedParams.set("title", "EICAR in isolated quarantine");
    const quarantined = await post(`/documents?${infectedParams}`, owner, eicar);
    expectStatus(quarantined, 201, "EICAR retained only while scanner offline");
    assert.equal(quarantined.data.scanStatus, "no_disponible");
    const infectedSnapshot = await snapshot(quarantined.data.id);
    await start();
    // Same bytes under a different access scope bypass deduplication.
    infectedParams.set("accessScope", "restricted");
    expectStatus(await post(`/documents?${infectedParams}`, owner, eicar), 422, "real EICAR rejection");
    let infected = await rescan(quarantined.data.id, 1, quarantined.data.revision, c2);
    expectStatus(infected, 200, "C2 rescan detects EICAR");
    assert.equal(infected.data.scanStatus, "infectado");
    assert.deepEqual(await snapshot(quarantined.data.id), infectedSnapshot);
    assert.deepEqual(await readFile(path.join(testDataDirectory, "documents", infectedSnapshot[0].storage_key)), eicar);
    infected = await rescan(quarantined.data.id, 1, infected.data.revision, admin);
    expectStatus(infected, 200, "technical admin inherits C2 scan authority within the center");
    assert.equal(infected.data.scanStatus, "infectado", "admin authority cannot bypass quarantine");
    expectStatus(await request(`/documents/${quarantined.data.id}/versions/1/content`, { cookie: owner.cookie }), 409, "infected blocks download");
    expectStatus(await post(`/documents/${quarantined.data.id}/approve`, c2, { expectedRevision: infected.data.revision }), 409, "infected blocks approval");

    // Hold a real PostgreSQL row lock to exercise cross-process concurrent admission.
    const lock = await pool.connect();
    try {
      await lock.query("BEGIN");
      await lock.query("SELECT id FROM documents WHERE id=$1 FOR UPDATE", [documentId]);
      expectStatus(await rescan(documentId, 1, unavailable.data.revision), 409, "simultaneous scan rejected, not queued");
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
    }
    expectStatus(await rescan(documentId, 1, uploaded.data.revision), 409, "stale revision rejected");
    const historical = await rescan(documentId, 1, unavailable.data.revision);
    expectStatus(historical, 200, "owner clears historical version");
    assert.equal(historical.data.scanStatus, "no_disponible", "current version still quarantined");
    const historicalDownload = await request(`/documents/${documentId}/versions/1/content`, { cookie: owner.cookie });
    expectStatus(historicalDownload, 200, "cleared historical version downloadable");
    assert.equal(historicalDownload.data, bytesBefore[0].toString());
    assert.equal(await count(), 0, "old clean evidence is not approval");
    const recovered = await rescan(documentId, 2, historical.data.revision, c2);
    expectStatus(recovered, 200, "C2 clears current version after recovery");
    assert.equal(recovered.data.scanStatus, "limpio");
    assert.equal(recovered.data.status, "pendiente_revision");
    expectStatus(await rescan(documentId, 2, recovered.data.revision), 409, "clean version cannot be rescanned");
    assert.equal(await count(), 0, "clean scan does not approve evidence");
    expectStatus(await post(`/documents/${documentId}/links`, owner, {
      activityId: activity.id, indicatorCode: numericIndicator.code,
    }), 201, "link recovered current evidence");
    const approved = await post(`/documents/${documentId}/approve`, c2, { expectedRevision: recovered.data.revision });
    expectStatus(approved, 200, "approve recovered clean version");
    assert.equal(await count(), 1, "approved recovered evidence increments indicator");
    const download = await request(`/documents/${documentId}/versions/2/content`, { cookie: reader.cookie });
    expectStatus(download, 200, "granted reader downloads recovered version");
    assert.equal(download.data, bytesBefore[1].toString());
    assert.deepEqual(await snapshot(documentId), versionsBefore, "rescan does not change bytes/hash/version/storage metadata");
    for (let i = 0; i < versionsBefore.length; i++) {
      assert.deepEqual(await readFile(path.join(testDataDirectory, "documents", versionsBefore[i].storage_key)), bytesBefore[i]);
    }
    const audit = (await pool.query(
      "SELECT user_id, details, created_at FROM audit_logs WHERE entity_id=$1 AND action='document.version.rescanned' ORDER BY created_at", [documentId])).rows;
    assert.deepEqual(audit.map(a => a.details.scanStatus), ["no_disponible", "limpio", "limpio"]);
    for (const row of audit) {
      assert.ok(row.user_id && row.created_at && row.details.startedAt && row.details.finishedAt);
      assert.equal(row.details.revision, row.details.expectedRevision + 1);
      assert.equal(row.details.integrityOk, true);
    }
    assert.notEqual(audit[0].user_id, audit[2].user_id, "owner and C2 identities recorded");
    const conflicts = (await pool.query(
      "SELECT details FROM audit_logs WHERE entity_id=$1 AND action='document.version.rescan_conflict'", [documentId])).rows;
    assert.ok(conflicts.length >= 2, "busy and stale requests are audited");
    // Repeat service loss after successful recovery; failed retries never clear EICAR.
    await stop();
    const lost = await rescan(quarantined.data.id, 1, infected.data.revision);
    expectStatus(lost, 200, "scanner loss after recovery recorded");
    assert.equal(lost.data.scanStatus, "no_disponible");
    await start();
    const detectedAgain = await rescan(quarantined.data.id, 1, lost.data.revision);
    assert.equal(detectedAgain.data.scanStatus, "infectado");
    const healthyParams = new URLSearchParams(uploadParams);
    healthyParams.set("fileName", "healthy.txt");
    const healthy = await post(`/documents?${healthyParams}`, owner, Buffer.from("Innocuous real ClamAV test"));
    expectStatus(healthy, 201, "live scanner accepts innocuous upload");
    assert.equal(healthy.data.scanStatus, "limpio");
    // Missing bytes and integrity failures must be audited without silently clearing.
    const [stored] = await snapshot(quarantined.data.id);
    await writeFile(path.join(testDataDirectory, "documents", stored.storage_key), "tampered isolated fixture");
    expectStatus(await rescan(quarantined.data.id, 1, detectedAgain.data.revision), 409, "hash mismatch cannot clear quarantine");
    assert.equal((await current(quarantined.data.id)).scanStatus, "no_disponible");
    console.log("Real ClamAV passed: clean/EICAR, outage/recovery, RBAC/CSRF, concurrency, immutable historical/current versions, approval and indicator counts.");
  } finally {
    await stop();
  }
}

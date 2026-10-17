// No application database is ever used: a new private PostgreSQL cluster owns all test data.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
const root = new URL("../", import.meta.url).pathname;
const require = createRequire(import.meta.url);
const { Pool } = require(require.resolve("pg", { paths: [path.join(root, "lib/db")] }));
const directory = await mkdtemp(path.join(tmpdir(), "innova-spaces-"));
const pgdata = path.join(directory, "postgres");
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith("PG") && !["DATABASE_URL", "TEST_DATABASE_URL", "SESSION_SECRET", "DATA_DIR"].includes(key)));
let api, pool, postgres = false, cleaned = false, checks = 0, output = "";
function command(name, args, env = cleanEnv) {
  const result = spawnSync(name, args, { cwd: root, env, encoding: "utf8", timeout: 90000 });
  assert.equal(result.status, 0, `${name}: ${result.stderr || result.stdout}`);
}
async function port() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening"); const number = server.address().port;
  await new Promise((resolve) => server.close(resolve)); return number;
}
async function cleanup() {
  if (cleaned) return; cleaned = true;
  if (api && api.exitCode === null && api.signalCode === null) {
    api.kill("SIGTERM");
    await Promise.race([once(api, "exit"), new Promise((resolve) => setTimeout(resolve, 2000))]);
    if (api.exitCode === null && api.signalCode === null) { api.kill("SIGKILL"); await once(api, "exit"); }
  }
  if (pool) await pool.end();
  if (postgres) command("pg_ctl", ["-D", pgdata, "-m", "immediate", "-w", "stop"]);
  await rm(directory, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await cleanup(); process.exit(130); });
try {
  const pgPort = await port(), apiPort = await port();
  command("initdb", ["-D", pgdata, "-U", "spaces_test", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
  command("pg_ctl", ["-D", pgdata, "-l", path.join(directory, "postgres.log"), "-o", `-h 127.0.0.1 -p ${pgPort} -k ${directory}`, "-w", "start"]);
  postgres = true;
  const databaseUrl = `postgresql://spaces_test@127.0.0.1:${pgPort}/postgres`;
  const env = {
    ...cleanEnv, DATABASE_URL: databaseUrl, SESSION_SECRET: randomBytes(48).toString("hex"),
    PORT: String(apiPort), NODE_ENV: "test", COOKIE_SECURE: "false", DATA_DIR: path.join(directory, "files"),
    EMAIL_ENABLED: "false", RESEND_API_KEY: "", RESEND_WEBHOOK_SECRET: "", PASSWORD_RESET_EMAIL_ENABLED: "false",
  };
  if (process.argv.includes("--serve-browser")) env.WEB_DIST_DIR = path.join(root, "artifacts/innova-c2/dist/public");
  command("pnpm", ["--filter", "@workspace/db", "run", "migrate"], env);
  // Development setup replays guards after schema push; verify that replay is safe on a migrated installation too.
  command("node", ["scripts/apply-course-guards.mjs"], env);
  pool = new Pool({ connectionString: databaseUrl });
  api = spawn(process.execPath, ["artifacts/api-server/dist/index.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  api.stdout.on("data", (chunk) => { output += chunk; }); api.stderr.on("data", (chunk) => { output += chunk; });
  const base = `http://127.0.0.1:${apiPort}/api/v1`;
  async function request(url, session, method = "GET", body, csrf = true) {
    const headers = { "content-type": "application/json" };
    if (session) { headers.cookie = session.cookie; if (csrf) headers["x-csrf-token"] = session.csrf; }
    const response = await fetch(base + url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    const bytes = Buffer.from(await response.arrayBuffer());
    let data; try { data = JSON.parse(bytes.toString()); } catch {}
    return { status: response.status, data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  function status(response, expected) { assert.equal(response.status, expected, JSON.stringify(response.data)); checks++; return response.data; }
  for (let attempt = 0; ; attempt++) {
    try { if ((await request("/health")).status === 200) break; } catch {}
    if (api.exitCode !== null || attempt > 150) throw Error(output.slice(-3000) || "API startup timeout");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const password = `Test-${randomUUID()}-Secure`;
  const setup = await request("/setup/initialize", null, "POST", {
    email: "admin@spaces.example.invalid", password, name: "Administración aislada",
    centerName: "Centro aislado de espacios", schoolYear: "2026-2027",
  });
  const initial = status(setup, 201), admin = { cookie: setup.cookie, csrf: initial.csrfToken };
  const catalog = status(await request("/catalogs/current", admin), 200);
  const [family, otherFamily] = catalog.familias_profesionales;
  assert.ok(family && otherFamily);
  async function account(email, professionalFamily, role = "profesorado") {
    const user = status(await request("/users", admin, "POST", {
      email, role, name: professionalFamily ?? role, temporaryPassword: password, professionalFamily,
    }), 201);
    const response = await request("/auth/login", null, "POST", { email, password });
    const login = status(response, 200);
    return { user, cookie: response.cookie, csrf: login.csrfToken };
  }
  const teacher = await account("teacher@spaces.example.invalid", family);
  const other = await account("other@spaces.example.invalid", otherFamily);
  const reader = await account("reader@spaces.example.invalid", null, "consulta_auditora");
  if (process.argv.includes("--products-only")) {
    const { testSoftwareProducts } = await import("./test-software-products.mjs");
    const fixture = await testSoftwareProducts({ request, status, pool, admin, teacher, reader, adminId: initial.user.id,
      browser: process.argv.includes("--serve-browser") });
    if (fixture) {
      const fixturePath = path.join(directory, "browser-fixture.json");
      await writeFile(fixturePath, JSON.stringify({ ...fixture, url: base.replace("/api/v1", ""), password,
        admin: initial.user.email, teacher: "teacher@spaces.example.invalid", reader: "reader@spaces.example.invalid" }), { mode: 0o600 });
      console.log(`Products browser fixture ready: ${fixturePath}`);
      await new Promise(() => {});
    }
    console.log(`Catálogo: ${checks} respuestas HTTP verificadas.`);
  } else {
  status(await request("/spaces"), 401);
  const overview = () => request("/spaces", admin).then((response) => status(response, 200));
  assert.equal((await overview()).spaces.length, 0); checks++;
  status(await request("/spaces", teacher, "POST"), 403);
  status(await request("/spaces", admin, "POST", {}, false), 403);
  const configured = status(await request("/spaces", admin, "POST", {}), 201);
  assert.deepEqual(configured.spaces.map((space) => space.kind).sort(), ["ateca", "fablab"]); checks++;
  status(await request("/spaces", admin, "POST", {}), 409);
  let space = configured.spaces[0];
  const spaceInput = { expectedRevision: space.revision, name: space.name, purpose: "Fabricación y experimentación didáctica",
    referenceSchedule: "Disponible durante el curso, consultar reservas", responsibles: "Coordinación", resources: "Impresora 3D",
    services: "Modelos y prototipos" };
  status(await request(`/spaces/${space.id}`, teacher, "PUT", spaceInput), 403);
  space = status(await request(`/spaces/${space.id}`, admin, "PUT", spaceInput), 200);
  status(await request(`/spaces/${space.id}`, admin, "PUT", spaceInput), 409);
  const history = status(await request(`/space-records/${space.id}/versions`, admin), 200);
  assert.equal(history.length, 2); checks++;
  await assert.rejects(pool.query("UPDATE space_versions SET revision=99 WHERE id=$1", [history[0].id]), /SPACE_HISTORY_IMMUTABLE/); checks++;
  const yearId = configured.schoolYearId;
  const centerId = (await pool.query("SELECT center_id FROM school_years WHERE id=$1", [yearId])).rows[0].center_id;
  async function activity(statusValue = "validada", date = "2026-10-01", selectedFamily = family) {
    return (await pool.query(`INSERT INTO activities
      (center_id,school_year_id,title,description,activity_date,professional_family,responsible_user_id,created_by,
       fingerprint,status,information_status,confirmed_by,confirmed_at,validated_by,validated_at)
      VALUES($1,$2,'Taller 3D','Prototipos didácticos',$3,$4,$5,$5,$6,$7,'confirmada',$5,now(),$5,now()) RETURNING id`,
    [centerId, yearId, date, selectedFamily, adminId(), randomUUID(), statusValue])).rows[0].id;
  }
  function adminId() { return initial.user.id; }
  const activityId = await activity();
  const pendingId = await activity("pendiente_responsable");
  const foreignFamilyActivity = await activity("validada", "2026-10-01", otherFamily);
  const input = {
    expectedRevision: 0, title: "Taller privado de prototipado", spaceKinds: ["ateca", "fablab"],
    startsAt: "2026-10-01T09:00:00Z", endsAt: "2026-10-01T10:00:00Z",
    professionalFamily: family, groupLabel: "Grupo agregado 1", status: "reservada", activityId: null,
    notes: "Notas internas de planificación.",
  };
  status(await request("/space-reservations", reader, "POST", input), 403);
  status(await request("/space-reservations", teacher, "POST", input, false), 403);
  status(await request("/space-reservations", other, "POST", input), 403);
  status(await request("/space-reservations", teacher, "POST", { ...input, endsAt: input.startsAt }), 400);
  status(await request("/space-reservations", teacher, "POST", { ...input, startsAt: "2025-10-01T09:00:00Z" }), 400);
  let reservation = status(await request("/space-reservations", teacher, "POST", input), 201);
  const hidden = status(await request("/spaces", other), 200).reservations.find((row) => row.id === reservation.id);
  assert.equal(hidden.detailsVisible, false);
  assert.equal(hidden.notes, ""); assert.equal(hidden.groupLabel, ""); assert.equal(hidden.title, "Espacio reservado"); checks += 4;
  status(await request(`/space-records/${reservation.id}/versions`, other), 404);
  status(await request("/space-reservations", other, "POST", { ...input, professionalFamily: otherFamily }), 409);
  const edit = () => ({ ...input, expectedRevision: reservation.revision });
  status(await request(`/space-reservations/${reservation.id}`, other, "PUT", edit()), 403);
  status(await request(`/space-reservations/${reservation.id}`, teacher, "PUT", { ...edit(), expectedRevision: 99 }), 409);
  status(await request(`/space-reservations/${reservation.id}`, teacher, "PUT", { ...edit(), status: "realizado" }), 400);
  status(await request(`/space-reservations/${reservation.id}`, admin, "PUT", { ...edit(), status: "realizado", activityId: pendingId }), 409);
  status(await request(`/space-reservations/${reservation.id}`, admin, "PUT", { ...edit(), status: "realizado", activityId: foreignFamilyActivity }), 400);
  reservation = status(await request(`/space-reservations/${reservation.id}`, admin, "PUT", { ...edit(), status: "realizado", activityId }), 200);
  const adjacent = { ...input, startsAt: input.endsAt, endsAt: "2026-10-01T11:00:00Z" };
  let second = status(await request("/space-reservations", admin, "POST", adjacent), 201);
  second = status(await request(`/space-reservations/${second.id}`, admin, "PUT", { ...adjacent, expectedRevision: second.revision, status: "realizado", activityId }), 200);
  const completed = (await overview()).reservations.filter((row) => row.status === "realizado");
  assert.equal(completed.length, 2);
  assert.equal(new Set(completed.map((row) => row.activityId)).size, 1, "Two space uses never create duplicate activities."); checks += 2;
  const concurrentInput = { ...input, startsAt: "2026-10-02T09:00:00Z", endsAt: "2026-10-02T10:00:00Z" };
  const concurrent = await Promise.all([1, 2].map(() => request("/space-reservations", teacher, "POST", concurrentInput)));
  assert.deepEqual(concurrent.map((response) => response.status).sort(), [201, 409]); checks++;
  const planned = concurrent.find((response) => response.status === 201).data;
  status(await request(`/space-reservations/${planned.id}`, teacher, "PUT", { ...concurrentInput, expectedRevision: planned.revision, status: "cancelada", notes: "" }), 400);
  status(await request(`/space-reservations/${planned.id}`, teacher, "PUT", { ...concurrentInput, expectedRevision: planned.revision, status: "cancelada", notes: "Cambio de fecha" }), 200);
  status(await request("/space-reservations", other, "POST", { ...concurrentInput, professionalFamily: otherFamily }), 201);
  if (process.argv.includes("--serve-browser")) {
    const fixture = path.join(directory, "browser-fixture.json");
    await writeFile(fixture, JSON.stringify({
      url: `http://127.0.0.1:${apiPort}`, password, admin: "admin@spaces.example.invalid",
      teacher: "teacher@spaces.example.invalid", other: "other@spaces.example.invalid", family, otherFamily,
      activityId, reservationId: reservation.id,
    }), { mode: 0o600, flag: "wx" });
    console.log(`Spaces browser fixture ready: ${fixture}`);
    await new Promise(() => {});
  }
  // Closure retains actual states, and the database refuses later mutations.
  await pool.query("UPDATE activities SET status='descartada' WHERE id=$1", [pendingId]);
  const validation = status(await request(`/school-years/${yearId}/validation`, admin), 200);
  status(await request(`/school-years/${yearId}/close`, admin, "POST", {
    expectedRevision: validation.revision, confirmation: "2026-2027", reason: "Archivo de pruebas de espacios",
  }), 200);
  await assert.rejects(pool.query("UPDATE space_reservations SET notes='late' WHERE id=$1", [reservation.id]), /COURSE_CLOSED/); checks++;
  await assert.rejects(pool.query("UPDATE learning_spaces SET name='late' WHERE id=$1", [space.id]), /COURSE_CLOSED/); checks++;
  const snapshot = (await pool.query("SELECT content FROM school_year_snapshots WHERE school_year_id=$1", [yearId])).rows[0];
  assert.ok(snapshot && JSON.stringify(snapshot.content).includes("space_reservations")); checks++;
  const nextYear = (await pool.query(
    "INSERT INTO school_years(center_id,label,active) VALUES($1,'2027-2028',true) RETURNING id", [centerId],
  )).rows[0];
  const emptyNext = await overview();
  assert.equal(emptyNext.schoolYearId, nextYear.id);
  assert.equal(emptyNext.spaces.length, 0);
  assert.equal(emptyNext.reservations.length, 0); checks += 3;
  status(await request(`/spaces/${space.id}`, admin, "PUT", { ...spaceInput, expectedRevision: space.revision }), 404);
  status(await request(`/space-reservations/${reservation.id}`, admin, "PUT", {
    ...input, startsAt: "2027-10-01T09:00:00Z", endsAt: "2027-10-01T10:00:00Z", expectedRevision: reservation.revision,
  }), 404);
  status(await request(`/space-records/${reservation.id}/versions`, admin), 404);
  console.log(`ATECA y FABLab: ${checks} comprobaciones correctas; PostgreSQL aislado, permisos, solapes, versiones, privacidad, reutilización y cierre.`);
  }
} catch (error) { console.error(error); process.exitCode = 1; }
finally { await cleanup(); }

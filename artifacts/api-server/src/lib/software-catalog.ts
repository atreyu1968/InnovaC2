import { and, eq, desc, inArray } from "drizzle-orm";
import {
  db, softwareProductsTable, softwareVersionsTable, softwareRecordsTable,
  documentsTable, documentVersionsTable, usersTable,
} from "@workspace/db";
import { canReadDocument, loadCaptureActor, type CaptureActor } from "./capture-scope";
import manifest from "../../../../config/innova-deliveries.json";
import { createHash } from "node:crypto";

export type SoftwareTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type SoftwareScope = { actor: CaptureActor; year: { id: string; label: string }; manager: boolean };
export class SoftwareFailure extends Error { constructor(readonly status: number, message: string) { super(message); } }
export function fail(status: number, message: string): never { throw new SoftwareFailure(status, message); }
export const installedManifest = manifest;
type JsonDates<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] };
export function normalizedDates<T extends Record<string, unknown>>(input: T): JsonDates<T> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) =>
    [key, value instanceof Date ? value.toISOString().slice(0, 10) : value])) as JsonDates<T>;
}
export function validateDateInputs(body: unknown, fields: string[], nullable = true) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "El formulario no es válido.");
  for (const key of fields) {
    const value = (body as Record<string, unknown>)[key];
    if (nullable && value === null) continue;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
      fail(400, "Introduce fechas reales con formato AAAA-MM-DD; deja las opcionales sin fecha.");
  }
}
export const blankSoftwareData = (name: string) => ({
  name, purpose: "", audience: "", modules: "", responsibleUserId: null, startedOn: null, currentVersion: "",
  status: "idea", repositoryUrl: null, implementationCenter: "", implementationDate: null, results: "",
  resultsConfirmedOn: null, approvalConfirmed: false, approvalDate: null, securityReviewed: false, securityDate: null,
  evidenceVersionIds: [] as string[],
});
export function today() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Atlantic/Canary", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export async function evidenceOptions(s: SoftwareScope, connection: SoftwareTx | typeof db = db) {
  const rows = await connection.select({ document: documentsTable, version: documentVersionsTable }).from(documentVersionsTable)
    .innerJoin(documentsTable, eq(documentsTable.id, documentVersionsTable.documentId))
    .where(and(eq(documentsTable.centerId, s.actor.centerId), eq(documentsTable.schoolYearId, s.year.id),
      eq(documentsTable.status, "aprobado"), eq(documentsTable.accessScope, "center"), eq(documentVersionsTable.scanStatus, "limpio")));
  const options: Record<string, unknown>[] = [];
  for (const { document, version } of rows) {
    if (!await canReadDocument(s.actor, document)) continue;
    options.push({ versionId: version.id, documentId: document.id, title: document.title, sha256: version.sha256,
      versionNumber: version.version, available: true, issue: null });
  }
  return options;
}
export async function pinEvidence(s: SoftwareScope, ids: string[], tx: SoftwareTx) {
  if (!ids.length) return [];
  // Serialize with document withdrawal/scan changes while taking the immutable snapshot.
  await tx.select({ id: documentVersionsTable.id }).from(documentVersionsTable)
    .innerJoin(documentsTable, eq(documentsTable.id, documentVersionsTable.documentId)).where(and(
      eq(documentsTable.centerId, s.actor.centerId), eq(documentsTable.schoolYearId, s.year.id),
      inArray(documentVersionsTable.id, ids),
    )).for("share");
  const options = await evidenceOptions(s, tx);
  const pins = ids.map(id => options.find(e => e.versionId === id));
  if (pins.some(p => !p) || new Set(ids).size !== ids.length) fail(400, "Selecciona versiones de documentos aprobados, limpios, compartidos con el centro y accesibles en este curso.");
  return pins as Record<string, unknown>[];
}
function publicPins(pins: Record<string, unknown>[], available: Record<string, unknown>[]) {
  return pins.map(p => available.some(e => e.versionId === p.versionId) ? { ...p, available: true, issue: null }
    : { ...p, title: "Evidencia no disponible", available: false, issue: "La aprobación, accesibilidad o limpieza de esta versión ya no puede confirmarse." });
}
export async function productDto(row: typeof softwareProductsTable.$inferSelect, s: SoftwareScope, options?: Record<string, unknown>[]) {
  const evidence = publicPins(row.evidence, options ?? await evidenceOptions(s));
  const [responsible] = typeof row.data.responsibleUserId === "string" ? await db.select({ name: usersTable.name }).from(usersTable).where(
    and(eq(usersTable.id, row.data.responsibleUserId), eq(usersTable.centerId, s.actor.centerId)),
  ) : [];
  return { ...row.data, id: row.id, name: row.name, productKey: row.productKey, revision: row.revision,
    expectedRevision: row.revision, responsibleName: responsible?.name ?? null, evidence,
    evidenceIssues: evidence.filter(e => !e.available).map(e => String(e.issue)) };
}
export async function saveSoftwareVersion(tx: SoftwareTx, s: SoftwareScope, entityId: string, revision: number, content: Record<string, unknown>) {
  await tx.insert(softwareVersionsTable).values({ centerId: s.actor.centerId, schoolYearId: s.year.id,
    entityId, revision, content, createdBy: s.actor.id });
}
export async function detail(row: typeof softwareProductsTable.$inferSelect, s: SoftwareScope) {
  const options = await evidenceOptions(s);
  const records = await db.select().from(softwareRecordsTable).where(eq(softwareRecordsTable.productId, row.id)).orderBy(desc(softwareRecordsTable.revision));
  const history = await db.select().from(softwareVersionsTable).where(and(
    eq(softwareVersionsTable.entityId, row.id), eq(softwareVersionsTable.schoolYearId, s.year.id),
  )).orderBy(desc(softwareVersionsTable.revision));
  return { product: await productDto(row, s, options), records: records.map(r => ({
    ...r.data, id: r.id, productId: r.productId, expectedRevision: r.revision, revision: r.revision, source: r.source,
    supersedesId: r.supersedesId, createdAt: r.createdAt.toISOString(), evidence: publicPins(r.evidence, options),
  })), history: history.map(h => ({ id: h.id, revision: h.revision, createdAt: h.createdAt.toISOString(),
    // History never reveals document titles from references that have since been restricted.
    summary: JSON.stringify({ ...h.content, evidence: publicPins((h.content.evidence ?? []) as Record<string, unknown>[], options) }),
  })) };
}
export async function validateProduct(data: Record<string, unknown>, s: SoftwareScope, pins: Record<string, unknown>[]) {
  for (const key of ["startedOn", "implementationDate", "resultsConfirmedOn", "approvalDate", "securityDate"]) {
    if (typeof data[key] === "string" && data[key] > today()) fail(400, "Las fechas confirmadas no pueden ser futuras.");
  }
  if (typeof data.repositoryUrl === "string") {
    let url: URL; try { url = new URL(data.repositoryUrl); } catch { fail(400, "El repositorio debe ser una URL HTTPS válida."); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) fail(400, "Usa una URL HTTPS de repositorio sin credenciales, consultas ni fragmentos.");
  }
  if (data.responsibleUserId) {
    const actor = await loadCaptureActor(String(data.responsibleUserId));
    if (!actor || actor.centerId !== s.actor.centerId) fail(400, "El responsable debe tener una asignación activa en el centro y curso.");
  }
  if (data.status !== "idea" && (!data.responsibleUserId || !String(data.purpose ?? "").trim())) fail(400, "Indica finalidad y responsable antes de avanzar desde idea.");
  const requireEvidence = (condition: unknown, dateKey: string, label: string) => {
    if (condition && (!pins.length || !data[dateKey])) fail(400, `${label} requiere evidencias documentales y una fecha confirmada.`);
  };
  if (["piloto", "implantado", "mantenimiento"].includes(String(data.status))) {
    requireEvidence(true, "implementationDate", "Un piloto o una implantación");
    if (!String(data.implementationCenter ?? "").trim()) fail(400, "Indica el centro de piloto o implantación.");
  }
  requireEvidence(String(data.results ?? "").trim(), "resultsConfirmedOn", "Un resultado de uso");
  requireEvidence(data.approvalConfirmed, "approvalDate", "Una aprobación oficial declarada");
  requireEvidence(data.securityReviewed, "securityDate", "Una verificación de seguridad declarada");
  if (data.startedOn && data.implementationDate && data.implementationDate < data.startedOn) fail(400, "La implantación no puede preceder al inicio.");
}
export async function syncDeliveries(tx: SoftwareTx, s: SoftwareScope) {
  let [product] = await tx.select().from(softwareProductsTable).where(and(
    eq(softwareProductsTable.schoolYearId, s.year.id), eq(softwareProductsTable.productKey, "innova-c2"),
  )).for("update");
  if (!product) fail(409, "Inicializa primero el catálogo y la ficha de INNOVA-C2.");
  let inserted = 0;
  for (const entry of manifest.deliveries) {
    const hash = createHash("sha256").update(JSON.stringify(entry)).digest("hex");
    const previous = await tx.select().from(softwareRecordsTable).where(and(eq(softwareRecordsTable.productId, product.id), eq(softwareRecordsTable.sourceKey, entry.key)));
    if (previous.length) {
      if (previous[0].data.manifestHash !== hash) fail(409, "La entrega instalada cambió sin una nueva identificación. No se sustituye el registro anterior.");
      continue;
    }
    const revision = product.revision + 1;
    await tx.insert(softwareRecordsTable).values({ centerId: s.actor.centerId, schoolYearId: s.year.id, productId: product.id,
      kind: "entrega", source: "installed_manifest", sourceKey: entry.key, revision, createdBy: s.actor.id,
      data: { kind: "entrega", title: entry.title, version: entry.version, occurredOn: entry.date, details: entry.details,
        outcome: "superada", evidenceVersionIds: [], manifestHash: hash } });
    [product] = await tx.update(softwareProductsTable).set({ revision, updatedAt: new Date(), updatedBy: s.actor.id })
      .where(eq(softwareProductsTable.id, product.id)).returning();
    await saveSoftwareVersion(tx, s, product.id, revision, { ...product.data, evidence: product.evidence, technicalDelivery: entry.key });
    inserted++;
  }
  return inserted;
}

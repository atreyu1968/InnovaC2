import { Router, type Request, type Response } from "express";
import { and, eq, asc } from "drizzle-orm";
import {
  db, softwareCatalogsTable, softwareProductsTable, softwareRecordsTable,
  schoolYearsTable, auditLogsTable, usersTable, picProjectsTable, picPlansTable,
} from "@workspace/db";
import { CreateSoftwareProductBody, UpdateSoftwareProductBody, CreateSoftwareRecordBody, UpdateSoftwareCatalogBody } from "@workspace/api-zod";
import { requireAuth, requireCsrf, type AuthContext } from "../lib/auth";
import { loadCaptureActor, loadActiveSchoolYear } from "../lib/capture-scope";
import { hasCoordinationAccess } from "../lib/role-access";
import { logger } from "../lib/logger";
import {
  type SoftwareScope, type SoftwareTx, SoftwareFailure, fail, installedManifest, blankSoftwareData,
  evidenceOptions, pinEvidence, productDto, saveSoftwareVersion, detail, validateProduct, syncDeliveries, today, normalizedDates, validateDateInputs,
} from "../lib/software-catalog";

const router = Router();
const id = (req: Request) => {
  const value = String(req.params.productId);
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) fail(400, "Identificador de producto no válido.");
  return value;
};
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try { await fn(req, res); } catch (error) {
      if (error instanceof SoftwareFailure) { res.status(error.status).json({ error: error.message }); return; }
      const code = ((error as { cause?: unknown })?.cause ?? error) as { code?: string };
      if (code.code === "23505") { res.status(409).json({ error: "El catálogo, nombre o registro ya existe. Actualiza la vista." }); return; }
      if (["23514", "23503"].includes(code.code ?? "")) { res.status(409).json({ error: "El curso está cerrado o una referencia no pertenece al expediente." }); return; }
      logger.error({ code: code.code }, "Software catalog request failed");
      res.status(500).json({ error: "No se pudo completar la operación del catálogo." });
    }
  };
}
async function scope(res: Response, write = false): Promise<SoftwareScope> {
  const auth = (res.locals as { auth: AuthContext }).auth;
  const actor = await loadCaptureActor(auth.user.id);
  if (!actor) fail(403, "No tienes una asignación activa en este centro y curso.");
  const year = await loadActiveSchoolYear(actor.centerId);
  if (!year) fail(404, "No hay un curso activo. El catálogo anterior permanece archivado, no se copia.");
  const manager = hasCoordinationAccess(actor.role);
  if (write && !manager) fail(403, "Solo C2 y administración técnica gestionan el catálogo.");
  return { actor, year, manager };
}
async function lockCourse(tx: SoftwareTx, s: SoftwareScope) {
  const [year] = await tx.select().from(schoolYearsTable).where(and(eq(schoolYearsTable.id, s.year.id),
    eq(schoolYearsTable.centerId, s.actor.centerId))).for("update");
  if (!year?.active || year.closedAt) fail(409, "El curso se ha cerrado. No se han guardado cambios.");
}
async function audit(tx: SoftwareTx, s: SoftwareScope, action: string, entityId: string) {
  await tx.insert(auditLogsTable).values({ userId: s.actor.id, action, entityType: "software_product", entityId,
    details: { schoolYearId: s.year.id } });
}
async function product(s: SoftwareScope, productId: string, tx: SoftwareTx | typeof db = db) {
  const [row] = await tx.select().from(softwareProductsTable).where(and(eq(softwareProductsTable.id, productId),
    eq(softwareProductsTable.centerId, s.actor.centerId), eq(softwareProductsTable.schoolYearId, s.year.id)));
  if (!row) fail(404, "El producto no pertenece al curso activo.");
  return row;
}
async function overview(s: SoftwareScope) {
  const [catalog] = await db.select().from(softwareCatalogsTable).where(eq(softwareCatalogsTable.schoolYearId, s.year.id));
  const products = await db.select().from(softwareProductsTable).where(eq(softwareProductsTable.schoolYearId, s.year.id)).orderBy(asc(softwareProductsTable.name));
  const options = await evidenceOptions(s);
  const staff = [];
  if (s.manager) for (const u of await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(and(eq(usersTable.centerId, s.actor.centerId), eq(usersTable.active, true)))) {
    if (await loadCaptureActor(u.id)) staff.push(u);
  }
  const picProjects = await db.select({ id: picProjectsTable.id, name: picProjectsTable.name }).from(picProjectsTable)
    .innerJoin(picPlansTable, eq(picPlansTable.id, picProjectsTable.planId)).where(and(eq(picPlansTable.centerId, s.actor.centerId), eq(picPlansTable.schoolYearId, s.year.id)));
  return { schoolYearId: s.year.id, schoolYear: s.year.label, canManage: s.manager,
    catalog: catalog ? { ...catalog, expectedRevision: catalog.revision } : null,
    products: await Promise.all(products.map(p => productDto(p, s, options))), staff, picProjects,
    evidenceOptions: options, installedVersion: installedManifest.installedVersion };
}
router.get("/software-products", requireAuth, handle(async (_req, res) => { res.json(await overview(await scope(res))); }));
router.post("/software-products/initialize", requireAuth, requireCsrf, handle(async (_req, res) => {
  const s = await scope(res, true);
  await db.transaction(async tx => {
    await lockCourse(tx, s);
    const [catalog] = await tx.insert(softwareCatalogsTable).values({ centerId: s.actor.centerId, schoolYearId: s.year.id }).returning();
    await saveSoftwareVersion(tx, s, catalog.id, 1, { name: catalog.name, description: "", picProjectId: null });
    for (const [name, key] of [["INNOVA-C2", "innova-c2"], ["CoordinacionFP", "coordinacionfp"], ["SafeExit", "safeexit"]]) {
      const data = blankSoftwareData(name);
      const [row] = await tx.insert(softwareProductsTable).values({ centerId: s.actor.centerId, schoolYearId: s.year.id,
        catalogId: catalog.id, productKey: key, name, data, updatedBy: s.actor.id }).returning();
      await saveSoftwareVersion(tx, s, row.id, 1, { ...data, evidence: [] });
    }
    await syncDeliveries(tx, s);
    await audit(tx, s, "software_catalog.initialized", catalog.id);
  });
  res.status(201).json(await overview(s));
}));
router.put("/software-products/catalog", requireAuth, requireCsrf, handle(async (req, res) => {
  const s = await scope(res, true), parsed = UpdateSoftwareCatalogBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Descripción, referencia PIC o revisión no válidas.");
  const data = parsed.data;
  await db.transaction(async tx => {
    await lockCourse(tx, s);
    const [catalog] = await tx.select().from(softwareCatalogsTable).where(eq(softwareCatalogsTable.schoolYearId, s.year.id));
    if (!catalog) fail(409, "Inicializa primero el catálogo.");
    if (catalog.revision !== data.expectedRevision) fail(409, "El proyecto padre cambió en otra sesión. Conserva tus datos y revisa la versión actual.");
    if (data.picProjectId) {
      const projects = await tx.select({ id: picProjectsTable.id }).from(picProjectsTable).innerJoin(picPlansTable, eq(picPlansTable.id, picProjectsTable.planId))
        .where(and(eq(picProjectsTable.id, data.picProjectId), eq(picPlansTable.schoolYearId, s.year.id), eq(picPlansTable.centerId, s.actor.centerId)));
      if (!projects.length) fail(400, "El proyecto PIC debe pertenecer a este curso y centro.");
    }
    const revision = catalog.revision + 1;
    await tx.update(softwareCatalogsTable).set({ description: data.description, picProjectId: data.picProjectId, revision }).where(eq(softwareCatalogsTable.id, catalog.id));
    await saveSoftwareVersion(tx, s, catalog.id, revision, { name: catalog.name, description: data.description, picProjectId: data.picProjectId });
    await audit(tx, s, "software_catalog.updated", catalog.id);
  });
  res.json(await overview(s));
}));
router.post("/software-products/sync-deliveries", requireAuth, requireCsrf, handle(async (_req, res) => {
  const s = await scope(res, true);
  const inserted = await db.transaction(async tx => {
    await lockCourse(tx, s);
    const count = await syncDeliveries(tx, s);
    await audit(tx, s, "software_deliveries.synchronized", s.year.id);
    return count;
  });
  res.json({ inserted, message: inserted ? "Entregas técnicas registradas sin modificar estado, resultados ni certificaciones." : "Las entregas de esta instalación ya estaban registradas. No se han duplicado." });
}));
router.post("/software-products", requireAuth, requireCsrf, handle(async (req, res) => {
  const s = await scope(res, true);
  validateDateInputs(req.body, ["startedOn", "implementationDate", "resultsConfirmedOn", "approvalDate", "securityDate"]);
  const parsed = CreateSoftwareProductBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa los campos, fechas y referencias del producto.");
  const { expectedRevision, ...data } = normalizedDates(parsed.data);
  data.name = data.name.trim();
  if (!data.name || expectedRevision !== 0) fail(400, "Un producto nuevo necesita nombre y revisión cero.");
  const row = await db.transaction(async tx => {
    await lockCourse(tx, s);
    const [catalog] = await tx.select().from(softwareCatalogsTable).where(eq(softwareCatalogsTable.schoolYearId, s.year.id));
    if (!catalog) fail(409, "Inicializa primero el catálogo.");
    const evidence = await pinEvidence(s, data.evidenceVersionIds, tx);
    await validateProduct(data, s, evidence);
    const [saved] = await tx.insert(softwareProductsTable).values({ centerId: s.actor.centerId, schoolYearId: s.year.id,
      catalogId: catalog.id, name: data.name, data, evidence, updatedBy: s.actor.id }).returning();
    await saveSoftwareVersion(tx, s, saved.id, saved.revision, { ...data, evidence });
    await audit(tx, s, "software_product.created", saved.id);
    return saved;
  });
  res.status(201).json(await productDto(row, s));
}));
router.get("/software-products/:productId", requireAuth, handle(async (req, res) => {
  const s = await scope(res);
  res.json(await detail(await product(s, id(req)), s));
}));
router.put("/software-products/:productId", requireAuth, requireCsrf, handle(async (req, res) => {
  const s = await scope(res, true), productId = id(req);
  validateDateInputs(req.body, ["startedOn", "implementationDate", "resultsConfirmedOn", "approvalDate", "securityDate"]);
  const parsed = UpdateSoftwareProductBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa los campos, fechas y referencias del producto.");
  const { expectedRevision, ...data } = normalizedDates(parsed.data);
  data.name = data.name.trim(); if (!data.name) fail(400, "Indica el nombre del producto.");
  const saved = await db.transaction(async tx => {
    await lockCourse(tx, s);
    const row = await product(s, productId, tx);
    if (row.revision !== expectedRevision) fail(409, "La ficha cambió en otra sesión. Conserva tus datos y revisa la versión actual.");
    const evidence = await pinEvidence(s, data.evidenceVersionIds, tx);
    await validateProduct(data, s, evidence);
    const revision = row.revision + 1;
    const [updated] = await tx.update(softwareProductsTable).set({ name: data.name, data, evidence, revision, updatedBy: s.actor.id, updatedAt: new Date() }).where(eq(softwareProductsTable.id, productId)).returning();
    await saveSoftwareVersion(tx, s, productId, revision, { ...data, evidence });
    await audit(tx, s, "software_product.updated", productId);
    return updated;
  });
  res.json(await productDto(saved, s));
}));
router.post("/software-products/:productId/records", requireAuth, requireCsrf, handle(async (req, res) => {
  const s = await scope(res, true), productId = id(req);
  validateDateInputs(req.body, ["occurredOn"], false);
  const parsed = CreateSoftwareRecordBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa tipo, título, fecha, detalle y revisión del registro.");
  const { expectedRevision, supersedesId, ...data } = normalizedDates(parsed.data);
  if (!data.title.trim() || !data.details.trim()) fail(400, "Indica título y detalles del registro.");
  if (data.occurredOn > today() && data.outcome !== "pendiente") fail(400, "Una prueba o entrega completada no puede tener fecha futura.");
  if (data.kind === "entrega" && !data.version.trim()) fail(400, "Indica la versión de la entrega.");
  const saved = await db.transaction(async tx => {
    await lockCourse(tx, s);
    const row = await product(s, productId, tx);
    if (row.revision !== expectedRevision) fail(409, "La ficha cambió en otra sesión. Conserva tus datos y revisa la versión actual.");
    const evidence = await pinEvidence(s, data.evidenceVersionIds, tx);
    if (["captura", "manual"].includes(data.kind) && !evidence.length) fail(400, "Vincula la captura o manual a una versión documental aprobada y limpia.");
    if (supersedesId) {
      const [prior] = await tx.select().from(softwareRecordsTable).where(and(eq(softwareRecordsTable.id, supersedesId), eq(softwareRecordsTable.productId, productId)));
      if (!prior || prior.source !== "manual" || prior.kind !== data.kind) fail(400, "Solo puedes rectificar un registro manual del mismo producto y tipo.");
      const corrections = await tx.select({ id: softwareRecordsTable.id }).from(softwareRecordsTable).where(eq(softwareRecordsTable.supersedesId, supersedesId));
      if (corrections.length) fail(409, "El registro ya tiene una rectificación. Revisa el historial antes de añadir otra.");
    }
    const revision = row.revision + 1;
    await tx.insert(softwareRecordsTable).values({ centerId: s.actor.centerId, schoolYearId: s.year.id, productId,
      kind: data.kind, data, evidence, supersedesId, revision, createdBy: s.actor.id });
    const [updated] = await tx.update(softwareProductsTable).set({ revision, updatedAt: new Date(), updatedBy: s.actor.id }).where(eq(softwareProductsTable.id, productId)).returning();
    await saveSoftwareVersion(tx, s, productId, revision, { ...row.data, evidence: row.evidence, recordAdded: { kind: data.kind, title: data.title } });
    await audit(tx, s, "software_record.created", productId);
    return updated;
  });
  res.status(201).json(await detail(saved, s));
}));
export default router;

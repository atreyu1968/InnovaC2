import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import {
  CreatePicFollowupSnapshotBody,
  CreatePicFollowupSnapshotParams,
  CreatePicFollowupSnapshotResponse,
  ExportPicFollowupDocumentParams,
  ExportPicFollowupDocumentResponse,
  ExportPicFollowupLaycosParams,
  ExportPicFollowupLaycosResponse,
  GetPicFollowupParams,
  GetPicFollowupResponse,
  ListPicFollowupDeliveriesParams,
  ListPicFollowupDeliveriesResponse,
  ListPicFollowupsParams,
  ListPicFollowupsResponse,
  RecordPicFollowupDeliveryBody,
  RecordPicFollowupDeliveryParams,
  RecordPicFollowupDeliveryResponse,
  SavePicFollowupBody,
  SavePicFollowupParams,
  SavePicFollowupResponse,
  type PicFollowupContent,
  type PicFollowupDocument,
  type PicFollowupReport,
  type PicFollowupSnapshot,
  type PicFollowupType,
  type PicFollowupWorkspace,
} from "@workspace/api-zod";
import {
  activitiesTable,
  ciclopeMeetingsTable,
  ciclopeTasksTable,
  centersTable,
  db,
  documentVersionsTable,
  documentsTable,
  evidencesTable,
  indicatorObservationsTable,
  picFollowupDeliveriesTable,
  picFollowupReportsTable,
  picFollowupSnapshotsTable,
  picPlansTable,
  schoolYearsTable,
  usersTable,
} from "@workspace/db";
import {
  canReadActivity,
  canReadDocument,
  loadActiveSchoolYear,
  loadCaptureActor,
  loadCatalogPayload,
  recordCaptureAudit,
  type CaptureActor,
} from "../lib/capture-scope";
import { requireAuth, requireCsrf, requirePermission, type AuthContext } from "../lib/auth";
import { hasCoordinationAccess } from "../lib/role-access";
import { catalogDigest } from "../lib/reference-data";
import {
  createPicFollowupDocx,
  createPicFollowupJson,
  createPicFollowupLaycosFields,
  createPicFollowupPdf,
} from "../lib/pic-followup-exports";

const router = Router();

type Scope = {
  actor: CaptureActor;
  centerId: string;
  centerName: string;
  schoolYearId: string;
  schoolYear: string;
  plan: typeof picPlansTable.$inferSelect;
  selectedActions: PicFollowupWorkspace["selectedActions"];
};

type SourceCandidate = PicFollowupWorkspace["sources"][number];
type AnnexCandidate = PicFollowupDocument & { versionId: string };

function authContext(res: Response): AuthContext {
  return res.locals.auth as AuthContext;
}

function requireFollowupCoordination(_req: Request, res: Response, next: NextFunction) {
  if (!hasCoordinationAccess(authContext(res).user.role)) {
    res.status(403).json({ error: "Los seguimientos del PIC están reservados a coordinación C2 autorizada." });
    return;
  }
  next();
}

function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === "string" ? value : value?.[0] ?? "";
}

function sendContractError(res: Response, message: string, status = 500) {
  res.status(status).json({ error: message });
}

function safeFilename(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "informe";
}

async function loadScope(userId: string, planId: string): Promise<Scope | null> {
  const actor = await loadCaptureActor(userId);
  if (!actor) return null;
  const year = await loadActiveSchoolYear(actor.centerId);
  if (!year) return null;
  const [plan] = await db.select().from(picPlansTable).where(and(
    eq(picPlansTable.id, planId),
    eq(picPlansTable.centerId, actor.centerId),
    eq(picPlansTable.schoolYearId, year.id),
  )).limit(1);
  if (!plan) return null;
  const [center] = await db.select({ name: centersTable.name })
    .from(centersTable).where(eq(centersTable.id, actor.centerId)).limit(1);
  const catalogPayload = await loadCatalogPayload(plan.catalogRowId);
  const catalog = catalogPayload && typeof catalogPayload === "object" && !Array.isArray(catalogPayload)
    ? catalogPayload as Record<string, unknown>
    : {};
  const planContent = plan.content as {
    selectedActions?: { actionCode: string; objectiveCode: string }[];
    customActions?: { title: string; objectiveCode: string }[];
  };
  const actionLookup = new Map<string, { title: string; objectiveCode: string }>();
  for (const objectiveValue of Array.isArray(catalog.objetivos) ? catalog.objetivos : []) {
    if (!objectiveValue || typeof objectiveValue !== "object" || Array.isArray(objectiveValue)) continue;
    const objective = objectiveValue as Record<string, unknown>;
    if (typeof objective.codigo !== "string") continue;
    for (const actionValue of Array.isArray(objective.acciones) ? objective.acciones : []) {
      if (!actionValue || typeof actionValue !== "object" || Array.isArray(actionValue)) continue;
      const action = actionValue as Record<string, unknown>;
      if (typeof action.codigo !== "string" || typeof action.titulo !== "string") continue;
      actionLookup.set(action.codigo, { title: action.titulo, objectiveCode: objective.codigo });
    }
  }
  const selectedActions = (planContent.selectedActions ?? []).map((selection) => ({
    code: selection.actionCode,
    title: actionLookup.get(selection.actionCode)?.title ?? selection.actionCode,
    objectiveCode: selection.objectiveCode,
  }));
  (planContent.customActions ?? []).forEach((action, index) => selectedActions.push({
    code: `custom-${index + 1}`,
    title: action.title,
    objectiveCode: action.objectiveCode,
  }));
  return {
    actor,
    centerId: actor.centerId,
    centerName: center?.name ?? "Centro educativo",
    schoolYearId: year.id,
    schoolYear: year.label,
    plan,
    selectedActions,
  };
}

async function sourceCandidates(scope: Scope): Promise<SourceCandidate[]> {
  const result: SourceCandidate[] = [];
  const activities = await db.select().from(activitiesTable).where(and(
    eq(activitiesTable.centerId, scope.centerId),
    eq(activitiesTable.schoolYearId, scope.schoolYearId),
    eq(activitiesTable.status, "validada"),
    eq(activitiesTable.informationStatus, "confirmada"),
  ));
  for (const activity of activities) {
    if (!canReadActivity(scope.actor, activity)) continue;
    result.push({
      id: activity.id,
      type: "actuacion",
      label: `${activity.title}${activity.activityDate ? ` · ${activity.activityDate}` : ""}`,
      status: "Actuación validada y confirmada",
      sourceDate: activity.validatedAt ?? activity.createdAt,
      notice: "Actuación registrada y validada; no acredita por sí sola un objetivo logrado.",
    });
  }

  const evidenceRows = await db.select({
    evidence: evidencesTable,
    version: documentVersionsTable,
    document: documentsTable,
  }).from(evidencesTable)
    .innerJoin(documentVersionsTable, eq(evidencesTable.documentVersionId, documentVersionsTable.id))
    .innerJoin(documentsTable, eq(documentVersionsTable.documentId, documentsTable.id))
    .where(and(
      eq(evidencesTable.status, "validada"),
      eq(documentsTable.centerId, scope.centerId),
      eq(documentsTable.schoolYearId, scope.schoolYearId),
      eq(documentsTable.status, "aprobado"),
      eq(documentsTable.accessScope, "center"),
      eq(documentVersionsTable.scanStatus, "limpio"),
    ));
  for (const { evidence, version, document } of evidenceRows) {
    if (!await canReadDocument(scope.actor, document)) continue;
    result.push({
      id: evidence.id,
      type: "evidencia",
      label: evidence.description || document.title,
      status: "Evidencia validada · versión limpia",
      sourceDate: version.createdAt,
      notice: "Evidencia vinculada a un documento aprobado, limpio y accesible en este curso.",
    });
  }

  const meetings = await db.select().from(ciclopeMeetingsTable).where(and(
    eq(ciclopeMeetingsTable.centerId, scope.centerId),
    eq(ciclopeMeetingsTable.schoolYearId, scope.schoolYearId),
  ));
  const validActaIds = new Set<string>();
  for (const meeting of meetings) {
    const scheduled = meeting.kind === "red_c1";
    if (scheduled && meeting.state !== "cancelada") {
      result.push({
        id: meeting.id,
        type: "agenda_c1",
        label: `${meeting.title} · ${meeting.startsAt.toISOString().slice(0, 10)}`,
        status: `Agenda C1 registrada · ${meeting.state}`,
        sourceDate: meeting.startsAt,
        notice: "Agenda recibida o planificación. No acredita asistencia, participación ni cumplimiento.",
      });
    }
    if (meeting.kind === "ciclope" && meeting.state === "acta_validada") {
      validActaIds.add(meeting.id);
      result.push({
        id: meeting.id,
        type: "acta_ciclope",
        label: `${meeting.title} · ${meeting.startsAt.toISOString().slice(0, 10)}`,
        status: "Acta CICLOPE validada",
        sourceDate: meeting.startsAt,
        notice: "Acuerdos extraídos únicamente de un acta CICLOPE validada.",
      });
    }
  }
  const tasks = await db.select({ task: ciclopeTasksTable, meeting: ciclopeMeetingsTable })
    .from(ciclopeTasksTable)
    .innerJoin(ciclopeMeetingsTable, eq(ciclopeTasksTable.meetingId, ciclopeMeetingsTable.id))
    .where(and(
      eq(ciclopeTasksTable.schoolYearId, scope.schoolYearId),
      eq(ciclopeMeetingsTable.centerId, scope.centerId),
      eq(ciclopeMeetingsTable.kind, "ciclope"),
      eq(ciclopeMeetingsTable.state, "acta_validada"),
    ));
  for (const { task, meeting } of tasks) {
    if (!validActaIds.has(meeting.id)) continue;
    result.push({
      id: task.id,
      type: "acuerdo",
      label: task.title,
      status: task.completedAt
        ? `Tarea marcada como completada en CICLOPE · ${task.completedAt.toISOString().slice(0, 10)}`
        : "Tarea abierta en CICLOPE; no consta como completada",
      sourceDate: task.completedAt ?? meeting.startsAt,
      notice: "Estado literal de la tarea en CICLOPE; no se convierte en logro PIC automáticamente.",
    });
  }

  const observations = await db.select().from(indicatorObservationsTable).where(and(
    eq(indicatorObservationsTable.planId, scope.plan.id),
  ));
  for (const observation of observations) {
    if (!observation.validatedBy) continue;
    result.push({
      id: observation.id,
      type: "indicador",
      label: `${observation.indicatorCode} · ${observation.period} · ${String(observation.value)}`,
      status: `Observación registrada · ${observation.assessment}`,
      sourceDate: observation.createdAt,
      notice: "Observación de indicador validada del PIC vigente; el informe no recalcula el grado de logro.",
    });
  }
  return result;
}

async function annexCandidates(scope: Scope): Promise<AnnexCandidate[]> {
  const docs = await db.select().from(documentsTable).where(and(
    eq(documentsTable.centerId, scope.centerId),
    eq(documentsTable.schoolYearId, scope.schoolYearId),
    eq(documentsTable.status, "aprobado"),
    eq(documentsTable.accessScope, "center"),
    isNull(documentsTable.archivedAt),
  ));
  const result: AnnexCandidate[] = [];
  for (const document of docs) {
    if (!await canReadDocument(scope.actor, document)) continue;
    const [version] = await db.select().from(documentVersionsTable).where(and(
      eq(documentVersionsTable.documentId, document.id),
      eq(documentVersionsTable.version, document.currentVersion),
      eq(documentVersionsTable.scanStatus, "limpio"),
    )).limit(1);
    if (!version) continue;
    result.push({
      id: document.id,
      title: document.title,
      fileName: version.originalName,
      sha256: version.sha256,
      versionId: version.id,
    });
  }
  return result;
}

async function loadReport(scope: Scope, type: PicFollowupType) {
  const [report] = await db.select().from(picFollowupReportsTable).where(and(
    eq(picFollowupReportsTable.planId, scope.plan.id),
    eq(picFollowupReportsTable.reportType, type),
    eq(picFollowupReportsTable.centerId, scope.centerId),
    eq(picFollowupReportsTable.schoolYearId, scope.schoolYearId),
  )).limit(1);
  return report;
}

async function loadSnapshots(reportId: string, type: PicFollowupType): Promise<PicFollowupSnapshot[]> {
  const rows = await db.select().from(picFollowupSnapshotsTable)
    .where(eq(picFollowupSnapshotsTable.reportId, reportId))
    .orderBy(desc(picFollowupSnapshotsTable.version));
  return rows.map((row) => ({
    id: row.id,
    reportId: row.reportId,
    reportType: type,
    version: row.version,
    reportRevision: row.reportRevision,
    reason: row.reason,
    sourceHash: row.sourceHash,
    content: row.content as unknown as PicFollowupContent,
    validation: row.validation as PicFollowupSnapshot["validation"],
    createdAt: row.createdAt,
  }));
}

async function loadDeliveries(reportId: string, type: PicFollowupType) {
  const rows = await db.select({
    delivery: picFollowupDeliveriesTable,
    document: documentsTable,
    version: documentVersionsTable,
    user: usersTable,
  }).from(picFollowupDeliveriesTable)
    .innerJoin(documentsTable, eq(picFollowupDeliveriesTable.proofDocumentId, documentsTable.id))
    .innerJoin(documentVersionsTable, eq(picFollowupDeliveriesTable.proofVersionId, documentVersionsTable.id))
    .leftJoin(usersTable, eq(picFollowupDeliveriesTable.recordedBy, usersTable.id))
    .where(eq(picFollowupDeliveriesTable.reportId, reportId))
    .orderBy(desc(picFollowupDeliveriesTable.createdAt));
  return rows.map(({ delivery, document, version, user }) => ({
    id: delivery.id,
    snapshotId: delivery.snapshotId,
    reportType: type,
    deliveryDate: delivery.deliveryDate,
    externalIdentifier: delivery.externalIdentifier,
    proofDocumentTitle: document.title,
    proofVersionId: delivery.proofVersionId,
    proofFileName: delivery.proofFileName || version.originalName,
    proofSha256: delivery.proofSha256 || version.sha256,
    personConfirmed: delivery.personConfirmed,
    confirmation: delivery.confirmation,
    recordedByName: user?.name ?? "Cuenta desactivada",
    createdAt: delivery.createdAt,
  }));
}

function safeParsed<T>(
  res: Response,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  value: unknown,
  message: string,
  failureStatus = 500,
): T | null {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    sendContractError(res, message, failureStatus);
    return null;
  }
  return parsed.data ?? null;
}

function enrichContent(
  input: PicFollowupContent,
  selectedActions: Scope["selectedActions"],
  sources: SourceCandidate[],
  documents: AnnexCandidate[],
): PicFollowupContent | null {
  const actionLookup = new Map(selectedActions.map((action) => [action.code, action]));
  const actionCodes = new Set<string>();
  const actions = input.actions.map((action) => {
    const matched = actionLookup.get(action.actionCode);
    if (!matched || actionCodes.has(action.actionCode)) return null;
    actionCodes.add(action.actionCode);
    return { ...action, actionTitle: matched.title, objectiveCode: matched.objectiveCode };
  });
  if (actions.some((action) => action === null)) return null;

  const sourceLookup = new Map(sources.map((source) => [`${source.type}:${source.id}`, source]));
  const sourceKeys = new Set<string>();
  const references = [...input.sources];
  for (const [checkName, check] of Object.entries(input.certification)) {
    if (typeof check !== "object" || !check || !("sourceIds" in check)) continue;
    for (const id of check.sourceIds) {
      const candidate = sources.find((source) => source.id === id);
      if (!candidate) return null;
      const key = `${candidate.type}:${candidate.id}`;
      if (!references.some((reference) => `${reference.type}:${reference.id}` === key)) {
        references.push({
          type: candidate.type,
          id: candidate.id,
          note: `Vinculada por la persona a ${checkName}; no acredita automáticamente ese criterio.`,
        });
      }
    }
  }
  const normalizedSources = references.map((reference) => {
    const key = `${reference.type}:${reference.id}`;
    const matched = sourceLookup.get(key);
    if (!matched || sourceKeys.has(key)) return null;
    sourceKeys.add(key);
    return {
      ...reference,
      label: matched.label,
      status: matched.status,
      sourceDate: matched.sourceDate,
    };
  });
  if (normalizedSources.some((source) => source === null)) return null;
  const documentLookup = new Map(documents.map((document) => [document.id, document]));
  const annexIds = new Set<string>();
  const annexes = input.annexes.map((annex) => {
    const document = documentLookup.get(annex.documentId);
    if (!document || annexIds.has(annex.documentId)) return null;
    annexIds.add(annex.documentId);
    return {
      ...annex,
      title: annex.title.trim() || document.title,
      versionId: document.versionId,
      fileName: document.fileName,
      sha256: document.sha256,
    };
  });
  if (annexes.some((annex) => annex === null)) return null;
  return {
    ...input,
    actions: actions as NonNullable<(typeof actions)[number]>[],
    sources: normalizedSources as NonNullable<(typeof normalizedSources)[number]>[],
    annexes: annexes as NonNullable<(typeof annexes)[number]>[],
  };
}

function validationFor(type: PicFollowupType, content: PicFollowupContent, selectedActions: Scope["selectedActions"]) {
  const warnings: string[] = [];
  const byCode = new Map(content.actions.map((action) => [action.actionCode, action]));
  if (content.actions.length !== selectedActions.length || selectedActions.some((action) => !byCode.has(action.code))) {
    warnings.push("El estado de todas las acciones seleccionadas en el PIC debe revisarse.");
  }
  if (content.actions.some((action) => action.status === "descartada" && action.note.trim().length < 8)) {
    warnings.push("Añade el motivo de cada acción descartada.");
  }
  if (type !== "memoria_final" && type !== "justificacion") {
    if (!content.activitiesNarrative.trim()) warnings.push("Falta el relato de actuaciones del trimestre.");
    if (content.actions.some((action) => action.status === "no_iniciada" && !action.note.trim())) {
      warnings.push("Aclara las acciones que continúan sin iniciar.");
    }
    if (type === "tercer_trimestre" && !content.transferredDate) {
      warnings.push("No consta la fecha de traslado del resumen al CCP o ETA.");
    }
  } else {
    if (!content.positiveAspects.trim()) warnings.push("Faltan los aspectos positivos de la memoria final.");
    if (!content.difficulties.trim()) warnings.push("Faltan las dificultades o aspectos negativos.");
    if (!content.unmetObjectivesExplanation.trim()) warnings.push("Falta la explicación de objetivos no alcanzados.");
    if (!content.improvements.trim()) warnings.push("Faltan las propuestas de mejora para el curso siguiente.");
    if (!content.centerMemoryDate) warnings.push("No consta la fecha de incorporación a la memoria final del centro.");
  }
  if (type === "justificacion") {
    const checklist = content.certification;
    if (!checklist.personConfirmedAttendanceSummary.trim()) {
      warnings.push("La asistencia se debe revisar y consignar manualmente; agenda y planificación no la acreditan.");
    }
    const checks = [
      checklist.c1Attendance85, checklist.planPresented, checklist.quarterlyReportsOnTime,
      checklist.finalMemoryOnTime, checklist.certificationRequested,
    ];
    if (checks.some((check) => check.status === "sin_verificar")) {
      warnings.push("Hay criterios de certificación sin verificar por una persona.");
    }
    warnings.push("Este expediente no concede ni certifica horas, pagos, asistencia, aprobación o presentación oficial.");
  }
  if (!content.sources.length) warnings.push("No hay fuentes del curso vinculadas.");
  return { complete: warnings.length === 0, warnings };
}

function currentDraft(row: typeof picFollowupReportsTable.$inferSelect): PicFollowupReport {
  return {
    id: row.id,
    reportType: row.reportType as PicFollowupType,
    revision: row.revision,
    status: "borrador",
    content: row.content as unknown as PicFollowupContent,
    updatedAt: row.updatedAt,
  };
}

function responseSnapshot(
  row: typeof picFollowupSnapshotsTable.$inferSelect,
  type: PicFollowupType,
): PicFollowupSnapshot {
  return {
    id: row.id,
    reportId: row.reportId,
    reportType: type,
    version: row.version,
    reportRevision: row.reportRevision,
    reason: row.reason,
    sourceHash: row.sourceHash,
    content: row.content as unknown as PicFollowupContent,
    validation: row.validation as PicFollowupSnapshot["validation"],
    createdAt: row.createdAt,
  };
}

router.get(
  "/plans/:planId/followups",
  requireAuth,
  requireFollowupCoordination,
  requirePermission("pic.plan.read"),
  async (req, res) => {
    const params = safeParsed(res, ListPicFollowupsParams, { planId: pathParam(req, "planId") }, "Identificador de plan no válido.", 400);
    if (!params) return;
    const scope = await loadScope(authContext(res).user.id, params.planId);
    if (!scope) return void res.status(404).json({ error: "No existe un PIC vigente para ese curso." });
    const reports = await db.select().from(picFollowupReportsTable).where(and(
      eq(picFollowupReportsTable.planId, scope.plan.id),
      eq(picFollowupReportsTable.centerId, scope.centerId),
      eq(picFollowupReportsTable.schoolYearId, scope.schoolYearId),
    ));
    const [sources, annexDocuments] = await Promise.all([sourceCandidates(scope), annexCandidates(scope)]);
    const parsed = safeParsed<PicFollowupWorkspace>(res, ListPicFollowupsResponse, {
      planId: scope.plan.id,
      centerName: scope.centerName,
      schoolYear: scope.schoolYear,
      selectedActions: scope.selectedActions,
      reports: reports.map(currentDraft),
      sources,
      annexDocuments,
    }, "Los datos disponibles del seguimiento no coinciden con el contrato API.");
    if (parsed) res.set("Cache-Control", "private, no-store").json(parsed);
  },
);

router.get(
  "/plans/:planId/followups/:reportType",
  requireAuth,
  requireFollowupCoordination,
  requirePermission("pic.plan.read"),
  async (req, res) => {
    const params = safeParsed(res, GetPicFollowupParams, {
      planId: pathParam(req, "planId"), reportType: pathParam(req, "reportType"),
    }, "Parámetros del seguimiento no válidos.", 400);
    if (!params) return;
    const scope = await loadScope(authContext(res).user.id, params.planId);
    if (!scope) return void res.status(404).json({ error: "No existe un PIC vigente para ese curso." });
    const report = await loadReport(scope, params.reportType);
    if (!report) return void res.status(404).json({ error: "Este informe aún no tiene borrador guardado." });
    const [snapshots, deliveries] = await Promise.all([
      loadSnapshots(report.id, params.reportType),
      loadDeliveries(report.id, params.reportType),
    ]);
    const parsed = safeParsed(res, GetPicFollowupResponse, {
      report: currentDraft(report), snapshots, deliveries,
    }, "El borrador o su historial no coinciden con el contrato API.");
    if (parsed) res.set("Cache-Control", "private, no-store").json(parsed);
  },
);

router.put(
  "/plans/:planId/followups/:reportType",
  requireAuth,
  requireFollowupCoordination,
  requirePermission("pic.plan.write"),
  requireCsrf,
  async (req, res) => {
    const params = safeParsed(res, SavePicFollowupParams, {
      planId: pathParam(req, "planId"), reportType: pathParam(req, "reportType"),
    }, "Parámetros del seguimiento no válidos.", 400);
    const body = safeParsed(res, SavePicFollowupBody, req.body, "El contenido del borrador no es válido.", 400);
    if (!params || !body) return;
    const scope = await loadScope(authContext(res).user.id, params.planId);
    if (!scope) return void res.status(404).json({ error: "No existe un PIC vigente para ese curso." });
    const [sources, annexDocuments] = await Promise.all([sourceCandidates(scope), annexCandidates(scope)]);
    const content = enrichContent(body.content, scope.selectedActions, sources, annexDocuments);
    if (!content) return void res.status(422).json({
      error: "El borrador incluye acciones ajenas al PIC o fuentes/anexos fuera del centro y curso actual, no validados o duplicados.",
    });
    const actorId = authContext(res).user.id;
    let saved: typeof picFollowupReportsTable.$inferSelect | undefined;
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM school_years WHERE id=${scope.schoolYearId}::uuid FOR UPDATE`);
      const [year] = await tx.select().from(schoolYearsTable).where(eq(schoolYearsTable.id, scope.schoolYearId)).limit(1);
      if (!year?.active || year.closedAt) return;
      const [existing] = await tx.select().from(picFollowupReportsTable).where(and(
        eq(picFollowupReportsTable.planId, scope.plan.id),
        eq(picFollowupReportsTable.reportType, params.reportType),
      )).limit(1).for("update");
      if ((existing?.revision ?? 0) !== body.expectedRevision) return;
      if (existing) {
        [saved] = await tx.update(picFollowupReportsTable).set({
          content: content as unknown as Record<string, unknown>,
          revision: existing.revision + 1,
          updatedBy: actorId,
          updatedAt: new Date(),
        }).where(eq(picFollowupReportsTable.id, existing.id)).returning();
      } else {
        [saved] = await tx.insert(picFollowupReportsTable).values({
          centerId: scope.centerId,
          schoolYearId: scope.schoolYearId,
          planId: scope.plan.id,
          reportType: params.reportType,
          content: content as unknown as Record<string, unknown>,
          updatedBy: actorId,
        }).returning();
      }
    });
    if (!saved) return void res.status(409).json({ error: "El curso está cerrado o cambió la revisión del borrador. Recarga antes de volver a guardar." });
    await recordCaptureAudit(req, actorId, "pic.followup.draft.saved", "pic_followup_report", saved.id, {
      reportType: params.reportType, revision: saved.revision,
      sourceCount: content.sources.length, annexCount: content.annexes.length,
    });
    const parsed = safeParsed(res, SavePicFollowupResponse, currentDraft(saved), "El borrador guardado no coincide con el contrato API.");
    if (parsed) res.set("Cache-Control", "private, no-store").json(parsed);
  },
);

router.post(
  "/plans/:planId/followups/:reportType/snapshots",
  requireAuth,
  requireFollowupCoordination,
  requirePermission("pic.plan.write"),
  requireCsrf,
  async (req, res) => {
    const params = safeParsed(res, CreatePicFollowupSnapshotParams, {
      planId: pathParam(req, "planId"), reportType: pathParam(req, "reportType"),
    }, "Parámetros del seguimiento no válidos.", 400);
    const body = safeParsed(res, CreatePicFollowupSnapshotBody, req.body, "Motivo o revisión de instantánea no válidos.", 400);
    if (!params || !body) return;
    const scope = await loadScope(authContext(res).user.id, params.planId);
    if (!scope) return void res.status(404).json({ error: "No existe un PIC vigente para ese curso." });
    const actorId = authContext(res).user.id;
    let created: typeof picFollowupSnapshotsTable.$inferSelect | undefined;
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM school_years WHERE id=${scope.schoolYearId}::uuid FOR UPDATE`);
      const [year] = await tx.select().from(schoolYearsTable).where(eq(schoolYearsTable.id, scope.schoolYearId)).limit(1);
      if (!year?.active || year.closedAt) return;
      const [report] = await tx.select().from(picFollowupReportsTable).where(and(
        eq(picFollowupReportsTable.planId, scope.plan.id),
        eq(picFollowupReportsTable.reportType, params.reportType),
        eq(picFollowupReportsTable.centerId, scope.centerId),
        eq(picFollowupReportsTable.schoolYearId, scope.schoolYearId),
      )).limit(1).for("update");
      if (!report || report.revision !== body.expectedRevision) return;
      const content = report.content as unknown as PicFollowupContent;
      const validation = validationFor(params.reportType, content, scope.selectedActions);
      const [last] = await tx.select({ version: picFollowupSnapshotsTable.version })
        .from(picFollowupSnapshotsTable)
        .where(eq(picFollowupSnapshotsTable.reportId, report.id))
        .orderBy(desc(picFollowupSnapshotsTable.version))
        .limit(1);
      const version = (last?.version ?? 0) + 1;
      const sourceHash = catalogDigest({
        centerId: scope.centerId,
        schoolYearId: scope.schoolYearId,
        planId: scope.plan.id,
        reportType: params.reportType,
        reportRevision: report.revision,
        reason: body.reason,
        content,
        validation,
      });
      [created] = await tx.insert(picFollowupSnapshotsTable).values({
        reportId: report.id,
        centerId: scope.centerId,
        schoolYearId: scope.schoolYearId,
        planId: scope.plan.id,
        version,
        reportRevision: report.revision,
        reason: body.reason,
        sourceHash,
        content: content as unknown as Record<string, unknown>,
        validation,
        createdBy: actorId,
      }).returning();
    });
    if (!created) return void res.status(409).json({ error: "El curso está cerrado o cambió la revisión del borrador. Recarga antes de congelarlo." });
    await recordCaptureAudit(req, actorId, "pic.followup.snapshot.created", "pic_followup_snapshot", created.id, {
      reportType: params.reportType, version: created.version, reportRevision: created.reportRevision,
      sourceHash: created.sourceHash,
    });
    const parsed = safeParsed(res, CreatePicFollowupSnapshotResponse, responseSnapshot(created, params.reportType), "La instantánea guardada no coincide con el contrato API.");
    if (parsed) res.status(201).set("Cache-Control", "private, no-store").json(parsed);
  },
);

router.get(
  "/plans/:planId/followups/:reportType/deliveries",
  requireAuth,
  requireFollowupCoordination,
  requirePermission("pic.plan.read"),
  async (req, res) => {
    const params = safeParsed(res, ListPicFollowupDeliveriesParams, {
      planId: pathParam(req, "planId"), reportType: pathParam(req, "reportType"),
    }, "Parámetros de entrega no válidos.", 400);
    if (!params) return;
    const scope = await loadScope(authContext(res).user.id, params.planId);
    if (!scope) return void res.status(404).json({ error: "No existe un PIC vigente para ese curso." });
    const report = await loadReport(scope, params.reportType);
    const deliveries = report ? await loadDeliveries(report.id, params.reportType) : [];
    const parsed = safeParsed(res, ListPicFollowupDeliveriesResponse, deliveries, "El historial de entregas no coincide con el contrato API.");
    if (parsed) res.set("Cache-Control", "private, no-store").json(parsed);
  },
);

router.post(
  "/plans/:planId/followups/:reportType/deliveries",
  requireAuth,
  requireFollowupCoordination,
  requirePermission("pic.plan.submit"),
  requireCsrf,
  async (req, res) => {
    const params = safeParsed(res, RecordPicFollowupDeliveryParams, {
      planId: pathParam(req, "planId"), reportType: pathParam(req, "reportType"),
    }, "Parámetros de entrega no válidos.", 400);
    const body = safeParsed(res, RecordPicFollowupDeliveryBody, req.body, "Confirma los datos y aporta el justificante.", 400);
    if (!params || !body) return;
    const scope = await loadScope(authContext(res).user.id, params.planId);
    if (!scope) return void res.status(404).json({ error: "No existe un PIC vigente para ese curso." });
    const [snapshot] = await db.select().from(picFollowupSnapshotsTable).where(and(
      eq(picFollowupSnapshotsTable.id, body.snapshotId),
      eq(picFollowupSnapshotsTable.planId, scope.plan.id),
      eq(picFollowupSnapshotsTable.centerId, scope.centerId),
      eq(picFollowupSnapshotsTable.schoolYearId, scope.schoolYearId),
    )).limit(1);
    if (!snapshot) return void res.status(422).json({ error: "La entrega debe referirse a una instantánea inmutable del curso actual." });
    const [proofDocument] = await db.select().from(documentsTable).where(and(
      eq(documentsTable.id, body.proofDocumentId),
      eq(documentsTable.centerId, scope.centerId),
      eq(documentsTable.schoolYearId, scope.schoolYearId),
      eq(documentsTable.status, "aprobado"),
      eq(documentsTable.accessScope, "center"),
      isNull(documentsTable.archivedAt),
    )).limit(1);
    if (!proofDocument || !await canReadDocument(scope.actor, proofDocument)) {
      return void res.status(422).json({ error: "El justificante debe ser un documento aprobado y compartido con el centro en este curso." });
    }
    const [proofVersion] = await db.select().from(documentVersionsTable).where(and(
      eq(documentVersionsTable.documentId, proofDocument.id),
      eq(documentVersionsTable.version, proofDocument.currentVersion),
      eq(documentVersionsTable.scanStatus, "limpio"),
    )).limit(1);
    if (!proofVersion) return void res.status(422).json({ error: "El justificante no tiene una versión vigente, íntegra y limpia." });
    const actorId = authContext(res).user.id;
    let created: typeof picFollowupDeliveriesTable.$inferSelect | undefined;
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM school_years WHERE id=${scope.schoolYearId}::uuid FOR UPDATE`);
      const [year] = await tx.select().from(schoolYearsTable).where(eq(schoolYearsTable.id, scope.schoolYearId)).limit(1);
      if (!year?.active || year.closedAt) return;
      const [existingDelivery] = await tx.select({ id: picFollowupDeliveriesTable.id })
        .from(picFollowupDeliveriesTable)
        .where(eq(picFollowupDeliveriesTable.snapshotId, snapshot.id))
        .limit(1).for("update");
      if (existingDelivery) return;
      const [report] = await tx.select().from(picFollowupReportsTable).where(and(
        eq(picFollowupReportsTable.id, snapshot.reportId),
        eq(picFollowupReportsTable.planId, scope.plan.id),
        eq(picFollowupReportsTable.reportType, params.reportType),
      )).limit(1);
      if (!report) return;
      [created] = await tx.insert(picFollowupDeliveriesTable).values({
        reportId: report.id,
        snapshotId: snapshot.id,
        centerId: scope.centerId,
        schoolYearId: scope.schoolYearId,
        planId: scope.plan.id,
        deliveryDate: body.deliveryDate,
        externalIdentifier: body.externalIdentifier ?? null,
        proofDocumentId: proofDocument.id,
        proofVersionId: proofVersion.id,
        proofFileName: proofVersion.originalName,
        proofSha256: proofVersion.sha256,
        personConfirmed: body.personConfirmed,
        confirmation: body.confirmation,
        recordedBy: actorId,
      }).returning();
    });
    if (!created) return void res.status(409).json({ error: "El curso está cerrado o no se ha podido asociar la entrega al informe." });
    await recordCaptureAudit(req, actorId, "pic.followup.delivery.recorded", "pic_followup_delivery", created.id, {
      reportType: params.reportType,
      snapshotId: snapshot.id,
      proofVersionId: proofVersion.id,
      proofSha256: proofVersion.sha256,
    });
    const deliveries = await loadDeliveries(snapshot.reportId, params.reportType);
    const saved = deliveries.find((delivery) => delivery.id === created!.id);
    const parsed = safeParsed(res, RecordPicFollowupDeliveryResponse, saved, "La confirmación de entrega no coincide con el contrato API.");
    if (parsed) res.status(201).set("Cache-Control", "private, no-store").json(parsed);
  },
);

async function snapshotForExport(
  userId: string,
  planId: string,
  reportType: PicFollowupType,
  snapshotId: string,
) {
  const scope = await loadScope(userId, planId);
  if (!scope) return null;
  const [snapshot] = await db.select().from(picFollowupSnapshotsTable).where(and(
    eq(picFollowupSnapshotsTable.id, snapshotId),
    eq(picFollowupSnapshotsTable.planId, scope.plan.id),
    eq(picFollowupSnapshotsTable.centerId, scope.centerId),
    eq(picFollowupSnapshotsTable.schoolYearId, scope.schoolYearId),
  )).limit(1);
  if (!snapshot) return null;
  const [report] = await db.select().from(picFollowupReportsTable).where(and(
    eq(picFollowupReportsTable.id, snapshot.reportId),
    eq(picFollowupReportsTable.planId, scope.plan.id),
    eq(picFollowupReportsTable.reportType, reportType),
  )).limit(1);
  if (!report) return null;
  return { scope, snapshot, report };
}

router.get(
  "/plans/:planId/followups/:reportType/snapshots/:snapshotId/exports/laycos",
  requireAuth,
  requireFollowupCoordination,
  requirePermission("pic.plan.read"),
  async (req, res) => {
    const params = safeParsed(res, ExportPicFollowupLaycosParams, {
      planId: pathParam(req, "planId"),
      reportType: pathParam(req, "reportType"),
      snapshotId: pathParam(req, "snapshotId"),
    }, "Parámetros de exportación no válidos.", 400);
    if (!params) return;
    const result = await snapshotForExport(authContext(res).user.id, params.planId, params.reportType, params.snapshotId);
    if (!result) return void res.status(404).json({ error: "No existe esa instantánea inmutable del curso actual." });
    const snapshot = responseSnapshot(result.snapshot, params.reportType);
    const content = snapshot.content;
    const fields = createPicFollowupLaycosFields(params.reportType, content, result.scope.schoolYear, snapshot.version);
    const parsed = safeParsed(res, ExportPicFollowupLaycosResponse, {
      reportType: params.reportType,
      snapshotId: snapshot.id,
      snapshotVersion: snapshot.version,
      schoolYear: result.scope.schoolYear,
      generatedAt: new Date(),
      fields,
      notice: params.reportType === "justificacion"
        ? "El expediente de justificación es interno; no se transmite a Laycos. No se ha enviado ni presentado nada."
        : "Campos preparados para transcripción manual en Laycos. No se ha enviado ni presentado nada.",
    }, "Los campos de transcripción no coinciden con el contrato API.");
    if (parsed) res.set("Cache-Control", "private, no-store").json(parsed);
  },
);

router.get(
  "/plans/:planId/followups/:reportType/snapshots/:snapshotId/exports/:format",
  requireAuth,
  requireFollowupCoordination,
  requirePermission("pic.plan.read"),
  async (req, res) => {
    const params = safeParsed(res, ExportPicFollowupDocumentParams, {
      planId: pathParam(req, "planId"),
      reportType: pathParam(req, "reportType"),
      snapshotId: pathParam(req, "snapshotId"),
      format: pathParam(req, "format"),
    }, "Parámetros de exportación no válidos.", 400);
    if (!params) return;
    const result = await snapshotForExport(authContext(res).user.id, params.planId, params.reportType, params.snapshotId);
    if (!result) return void res.status(404).json({ error: "No existe esa instantánea inmutable del curso actual." });
    const snapshot = responseSnapshot(result.snapshot, params.reportType);
    const content = snapshot.content;
    const meta = {
      reportType: params.reportType,
      centerName: result.scope.centerName,
      schoolYear: result.scope.schoolYear,
      version: snapshot.version,
      revision: snapshot.reportRevision,
      reason: snapshot.reason,
      sourceHash: snapshot.sourceHash,
      validation: snapshot.validation,
    };
    const stamp = safeFilename(`${params.reportType}-${result.scope.schoolYear}-v${snapshot.version}`);
    let filename: string;
    let mediaType: string;
    let bytes: Buffer;
    if (params.format === "docx") {
      filename = `${stamp}.docx`;
      mediaType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      bytes = await createPicFollowupDocx(meta, content);
    } else if (params.format === "pdf") {
      filename = `${stamp}.pdf`;
      mediaType = "application/pdf";
      bytes = await createPicFollowupPdf(meta, content);
    } else {
      filename = `${stamp}.json`;
      mediaType = "application/json";
      bytes = createPicFollowupJson(meta, content);
    }
    const parsed = safeParsed(res, ExportPicFollowupDocumentResponse, {
      filename,
      mediaType,
      contentBase64: bytes.toString("base64"),
      generatedAt: new Date(),
    }, "El archivo no coincide con el contrato API.");
    if (parsed) res.set("Cache-Control", "private, no-store").json(parsed);
  },
);

export default router;

import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import {
  activitiesTable,
  activityIndicatorLinksTable,
  activitySourcesTable,
  activityVersionsTable,
  auditLogsTable,
  db,
  evidenceLinksTable,
  picIndicatorTargetsTable,
  picProjectsTable,
  usersTable,
} from "@workspace/db";
import {
  ConfirmActivityBody,
  CreateActivityResponse,
  CreateActivityBody,
  DiscardActivityBody,
  GetActivityResponse,
  UpdateActivityBody,
  ValidateActivityBody,
  type Activity as ApiActivity,
} from "@workspace/api-zod";
import {
  requireAuth,
  requireCsrf,
  requirePermission,
  type AuthContext,
} from "../lib/auth";
import {
  canReadActivity,
  canWriteActivity,
  indicatorByCode,
  listOfficialIndicators,
  loadActiveSchoolYear,
  loadCaptureActor,
  loadCatalogPayload,
  loadCurrentPlan,
  recordCaptureAudit,
  sameFamily,
} from "../lib/capture-scope";

const router = Router();
const MAX_ACTIVITY_ROWS = 200;

function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === "string" ? value : value?.[0] ?? "";
}

function fingerprint(
  title: string,
  activityDate: string | null,
  professionalFamily: string,
  responsibleUserId: string,
): string {
  const normalized = [
    title.normalize("NFKC").trim().toLocaleLowerCase("es"),
    activityDate ?? "fecha-pendiente",
    professionalFamily.trim().toLocaleLowerCase("es"),
    responsibleUserId,
  ].join("\u001f");
  return createHash("sha256").update(normalized).digest("hex");
}

function activitySnapshot(row: typeof activitiesTable.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    activityDate: row.activityDate,
    professionalFamily: row.professionalFamily,
    projectId: row.projectId,
    responsibleUserId: row.responsibleUserId,
    status: row.status,
    informationStatus: row.informationStatus,
    revision: row.revision,
    confirmedBy: row.confirmedBy,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    validatedBy: row.validatedBy,
    validatedAt: row.validatedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function saveActivityVersion(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  row: typeof activitiesTable.$inferSelect,
  userId: string,
) {
  await tx.insert(activityVersionsTable).values({
    activityId: row.id,
    revision: row.revision,
    content: activitySnapshot(row),
    createdBy: userId,
  });
}

async function activityView(
  row: typeof activitiesTable.$inferSelect,
): Promise<ApiActivity> {
  const [links, sources, evidenceRows] = await Promise.all([
    db
      .select({ indicatorCode: activityIndicatorLinksTable.indicatorCode })
      .from(activityIndicatorLinksTable)
      .where(eq(activityIndicatorLinksTable.activityId, row.id)),
    db
      .select({ sourceLabel: activitySourcesTable.sourceLabel })
      .from(activitySourcesTable)
      .where(eq(activitySourcesTable.activityId, row.id)),
    db
      .select({ evidenceId: evidenceLinksTable.evidenceId })
      .from(evidenceLinksTable)
      .where(eq(evidenceLinksTable.activityId, row.id)),
  ]);
  const view: ApiActivity = {
    id: row.id,
    title: row.title,
    description: row.description,
    activityDate: row.activityDate,
    professionalFamily: row.professionalFamily,
    projectId: row.projectId,
    responsibleUserId: row.responsibleUserId,
    status: row.status as ApiActivity["status"],
    informationStatus: row.informationStatus as ApiActivity["informationStatus"],
    revision: row.revision,
    evidenceCount: new Set(evidenceRows.map((item) => item.evidenceId)).size,
    indicatorCodes: [...new Set(links.map((item) => item.indicatorCode))],
    sourceLabels: [...new Set(sources.map((item) => item.sourceLabel))],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return view;
}

async function loadVisibleActivity(
  actorId: string,
  activityId: string,
) {
  const actor = await loadCaptureActor(actorId);
  if (!actor) return { actor: null, activity: null };
  const [activity] = await db
    .select()
    .from(activitiesTable)
    .where(
      and(
        eq(activitiesTable.id, activityId),
        eq(activitiesTable.centerId, actor.centerId),
      ),
    )
    .limit(1);
  if (!activity || !canReadActivity(actor, activity)) {
    return { actor, activity: null };
  }
  return { actor, activity };
}

async function validateIndicatorLinks(
  planId: string | null,
  codes: string[],
): Promise<Map<string, string> | null> {
  if (codes.length === 0) return new Map();
  if (!planId) return null;
  const targets = await db
    .select({
      indicatorId: picIndicatorTargetsTable.indicatorId,
      actionCode: picIndicatorTargetsTable.actionCode,
    })
    .from(picIndicatorTargetsTable)
    .where(
      and(
        eq(picIndicatorTargetsTable.planId, planId),
        inArray(picIndicatorTargetsTable.indicatorId, codes),
      ),
    );
  if (targets.length !== new Set(codes).size) return null;
  return new Map(targets.map((target) => [target.indicatorId, target.actionCode]));
}

async function validateProjectForPlan(
  projectId: string | null | undefined,
  planId: string | null,
): Promise<boolean> {
  if (!projectId) return true;
  if (!planId) return false;
  const [project] = await db
    .select({ id: picProjectsTable.id })
    .from(picProjectsTable)
    .where(
      and(
        eq(picProjectsTable.id, projectId),
        eq(picProjectsTable.planId, planId),
      ),
    )
    .limit(1);
  return Boolean(project);
}

function userContext(res: Response): AuthContext {
  return res.locals.auth as AuthContext;
}

router.get(
  "/activities",
  requireAuth,
  requirePermission("activities.read"),
  async (_req, res) => {
    const context = userContext(res);
    const actor = await loadCaptureActor(context.user.id);
    if (!actor) {
      res.status(401).json({ error: "La cuenta actual ya no está disponible." });
      return;
    }
    const year = await loadActiveSchoolYear(actor.centerId);
    if (!year) {
      res.status(409).json({ error: "El centro no tiene un curso activo." });
      return;
    }
    const rows = await db
      .select()
      .from(activitiesTable)
      .where(
        and(
          eq(activitiesTable.centerId, actor.centerId),
          eq(activitiesTable.schoolYearId, year.id),
        ),
      )
      .orderBy(desc(activitiesTable.updatedAt))
      .limit(MAX_ACTIVITY_ROWS);
    const visible = rows.filter((row) => canReadActivity(actor, row));
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await Promise.all(visible.map(activityView)));
  },
);

router.post(
  "/activities",
  requireAuth,
  requireCsrf,
  requirePermission("activities.write"),
  async (req, res) => {
    const parsed = CreateActivityBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Los datos de la actuación no son válidos." });
      return;
    }
    const context = userContext(res);
    const actor = await loadCaptureActor(context.user.id);
    if (!actor) {
      res.status(401).json({ error: "La cuenta actual ya no está disponible." });
      return;
    }
    const year = await loadActiveSchoolYear(actor.centerId);
    const plan = year
      ? await loadCurrentPlan(actor.centerId, year.id)
      : null;
    if (!year) {
      res.status(409).json({ error: "El centro no tiene un curso activo." });
      return;
    }
    const catalog = await loadCatalogPayload(plan?.catalogRowId);
    const families = (catalog as { familias_profesionales?: unknown } | null)
      ?.familias_profesionales;
    if (!Array.isArray(families) || !families.includes(parsed.data.professionalFamily)) {
      res.status(400).json({ error: "La familia profesional no pertenece al catálogo activo." });
      return;
    }
    if (
      actor.role !== "c2_innovacion" &&
      (!actor.professionalFamily ||
        !sameFamily(actor.professionalFamily, parsed.data.professionalFamily))
    ) {
      res.status(403).json({ error: "No puedes registrar actuaciones para otra familia." });
      return;
    }
    const responsibleUserId =
      actor.role === "c2_innovacion" && parsed.data.responsibleUserId
        ? parsed.data.responsibleUserId
        : actor.id;
    if (
      actor.role !== "c2_innovacion" &&
      parsed.data.responsibleUserId &&
      parsed.data.responsibleUserId !== actor.id
    ) {
      res.status(403).json({ error: "Solo C2 puede asignar otra persona responsable." });
      return;
    }
    const [responsible] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.id, responsibleUserId),
          eq(usersTable.centerId, actor.centerId),
          eq(usersTable.active, true),
        ),
      )
      .limit(1);
    if (!responsible) {
      res.status(400).json({ error: "La persona responsable no pertenece al centro o está inactiva." });
      return;
    }
    if (!(await validateProjectForPlan(parsed.data.projectId, plan?.id ?? null))) {
      res.status(400).json({ error: "El proyecto no pertenece al PIC activo." });
      return;
    }
    const linkedActions = await validateIndicatorLinks(
      plan?.id ?? null,
      parsed.data.indicatorCodes,
    );
    if (!linkedActions) {
      res.status(400).json({ error: "Selecciona solo indicadores incluidos en el PIC del curso activo." });
      return;
    }
    const indicatorCatalog = listOfficialIndicators(catalog);
    if (
      parsed.data.indicatorCodes.some(
        (code) => !indicatorCatalog.some((indicator) => indicator.code === code),
      )
    ) {
      res.status(400).json({ error: "Uno o más indicadores no están en el catálogo oficial." });
      return;
    }

    const activityDate = parsed.data.activityDate ?? null;
    const activityFingerprint = fingerprint(
      parsed.data.title,
      activityDate,
      parsed.data.professionalFamily,
      responsibleUserId,
    );
    const sourceFingerprint = createHash("sha256")
      .update(`manual\u001f${parsed.data.sourceLabel.trim().toLocaleLowerCase("es")}`)
      .digest("hex");

    const result = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(activitiesTable)
        .values({
          centerId: actor.centerId,
          schoolYearId: year.id,
          title: parsed.data.title.trim(),
          description: parsed.data.description.trim(),
          activityDate,
          professionalFamily: parsed.data.professionalFamily,
          projectId: parsed.data.projectId ?? null,
          responsibleUserId,
          createdBy: actor.id,
          fingerprint: activityFingerprint,
        })
        .onConflictDoNothing({
          target: [
            activitiesTable.centerId,
            activitiesTable.schoolYearId,
            activitiesTable.fingerprint,
          ],
        })
        .returning();
      const duplicate = !inserted;
      const [activity] = inserted
        ? [inserted]
        : await tx
            .select()
            .from(activitiesTable)
            .where(
              and(
                eq(activitiesTable.centerId, actor.centerId),
                eq(activitiesTable.schoolYearId, year.id),
                eq(activitiesTable.fingerprint, activityFingerprint),
              ),
            )
            .limit(1);
      if (!activity) throw new Error("No se pudo recuperar la actuación registrada.");
      if (!canWriteActivity(actor, activity)) {
        throw new Error("ACTIVITY_SCOPE_DENIED");
      }
      await tx
        .insert(activitySourcesTable)
        .values({
          activityId: activity.id,
          sourceType: "manual",
          sourceLabel: parsed.data.sourceLabel.trim(),
          sourceFingerprint,
          createdBy: actor.id,
        })
        .onConflictDoNothing();
      if (parsed.data.indicatorCodes.length > 0) {
        await tx
          .insert(activityIndicatorLinksTable)
          .values(
            parsed.data.indicatorCodes.map((indicatorCode) => ({
              activityId: activity.id,
              planId: plan!.id,
              actionCode: linkedActions.get(indicatorCode)!,
              indicatorCode,
              linkedBy: actor.id,
            })),
          )
          .onConflictDoNothing();
      }
      if (inserted) await saveActivityVersion(tx, inserted, actor.id);
      return { activity, duplicate };
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message === "ACTIVITY_SCOPE_DENIED") {
        res.status(409).json({ error: "La actuación equivalente pertenece a otro ámbito." });
        return null;
      }
      throw error;
    });
    if (!result) return;
    await recordCaptureAudit(
      req,
      actor.id,
      result.duplicate ? "activity.source.deduplicated" : "activity.created",
      "activity",
      result.activity.id,
      { sourceType: "manual", duplicate: result.duplicate },
    );
    const response = {
      activity: await activityView(result.activity),
      duplicate: result.duplicate,
    };
    const validated = CreateActivityResponse.safeParse(response);
    if (!validated.success) {
      res.status(500).json({ error: "La actuación guardada no coincide con el contrato API." });
      return;
    }
    res.status(201).json(validated.data);
  },
);

router.get(
  "/activities/:activityId",
  requireAuth,
  requirePermission("activities.read"),
  async (req, res) => {
    const context = userContext(res);
    const { actor, activity } = await loadVisibleActivity(
      context.user.id,
      pathParam(req, "activityId"),
    );
    if (!actor || !activity) {
      res.status(404).json({ error: "No se encontró la actuación en tu ámbito." });
      return;
    }
    const view = await activityView(activity);
    const parsed = GetActivityResponse.safeParse(view);
    if (!parsed.success) {
      res.status(500).json({ error: "La actuación guardada no coincide con el contrato API." });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.json(parsed.data);
  },
);

router.patch(
  "/activities/:activityId",
  requireAuth,
  requireCsrf,
  requirePermission("activities.write"),
  async (req, res) => {
    const parsed = UpdateActivityBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Los cambios de la actuación no son válidos." });
      return;
    }
    const context = userContext(res);
    const { actor, activity } = await loadVisibleActivity(
      context.user.id,
      pathParam(req, "activityId"),
    );
    if (!actor || !activity || !canWriteActivity(actor, activity)) {
      res.status(404).json({ error: "No se encontró la actuación en tu ámbito." });
      return;
    }
    if (activity.revision !== parsed.data.expectedRevision) {
      res.status(409).json({ error: "La actuación cambió. Recarga antes de corregirla." });
      return;
    }
    if (activity.status === "descartada") {
      res.status(409).json({ error: "Una actuación descartada conserva su historial y no se reabre." });
      return;
    }
    if (activity.status === "validada" && actor.role !== "c2_innovacion") {
      res.status(403).json({ error: "Solo C2 puede corregir una actuación validada." });
      return;
    }
    const year = await loadActiveSchoolYear(actor.centerId);
    const plan = year ? await loadCurrentPlan(actor.centerId, year.id) : null;
    const newFamily = parsed.data.professionalFamily ?? activity.professionalFamily;
    if (
      actor.role !== "c2_innovacion" &&
      !sameFamily(actor.professionalFamily, newFamily)
    ) {
      res.status(403).json({ error: "No puedes cambiar la familia de la actuación." });
      return;
    }
    const catalog = await loadCatalogPayload(plan?.catalogRowId);
    const families = (catalog as { familias_profesionales?: unknown } | null)
      ?.familias_profesionales;
    if (!Array.isArray(families) || !families.includes(newFamily)) {
      res.status(400).json({ error: "La familia profesional no pertenece al catálogo activo." });
      return;
    }
    if (!(await validateProjectForPlan(parsed.data.projectId ?? activity.projectId, plan?.id ?? null))) {
      res.status(400).json({ error: "El proyecto no pertenece al PIC activo." });
      return;
    }
    const codes = parsed.data.indicatorCodes;
    const linkedActions =
      codes === undefined
        ? null
        : await validateIndicatorLinks(plan?.id ?? null, codes);
    if (codes !== undefined && !linkedActions) {
      res.status(400).json({ error: "Selecciona solo indicadores incluidos en el PIC del curso activo." });
      return;
    }
    const activityDate =
      parsed.data.activityDate === undefined
        ? activity.activityDate
        : parsed.data.activityDate;
    const updated = await db.transaction(async (tx) => {
      const [saved] = await tx
        .update(activitiesTable)
        .set({
          title: parsed.data.title?.trim() ?? activity.title,
          description: parsed.data.description?.trim() ?? activity.description,
          activityDate,
          professionalFamily: newFamily,
          projectId:
            parsed.data.projectId === undefined
              ? activity.projectId
              : parsed.data.projectId,
          fingerprint: fingerprint(
            parsed.data.title ?? activity.title,
            activityDate,
            newFamily,
            activity.responsibleUserId,
          ),
          revision: activity.revision + 1,
          status: "pendiente_c2",
          informationStatus: "en_revision",
          confirmedBy: null,
          confirmedAt: null,
          validatedBy: null,
          validatedAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(activitiesTable.id, activity.id),
            eq(activitiesTable.revision, parsed.data.expectedRevision),
          ),
        )
        .returning();
      if (!saved) return null;
      if (codes !== undefined) {
        await tx
          .delete(activityIndicatorLinksTable)
          .where(eq(activityIndicatorLinksTable.activityId, activity.id));
        if (codes.length > 0) {
          await tx.insert(activityIndicatorLinksTable).values(
            codes.map((indicatorCode) => ({
              activityId: activity.id,
              planId: plan!.id,
              actionCode: linkedActions!.get(indicatorCode)!,
              indicatorCode,
              linkedBy: actor.id,
            })),
          );
        }
      }
      await saveActivityVersion(tx, saved, actor.id);
      return saved;
    });
    if (!updated) {
      res.status(409).json({ error: "La actuación cambió durante el guardado." });
      return;
    }
    await recordCaptureAudit(req, actor.id, "activity.updated", "activity", activity.id, {
      revision: updated.revision,
      revalidationRequired: true,
    });
    res.json(await activityView(updated));
  },
);

router.post(
  "/activities/:activityId/confirm",
  requireAuth,
  requireCsrf,
  requirePermission("activities.confirm"),
  async (req, res) => {
    const parsed = ConfirmActivityBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "La confirmación no tiene un estado válido." });
      return;
    }
    const context = userContext(res);
    const { actor, activity } = await loadVisibleActivity(
      context.user.id,
      pathParam(req, "activityId"),
    );
    if (!actor || !activity || !canWriteActivity(actor, activity)) {
      res.status(404).json({ error: "No se encontró la actuación en tu ámbito." });
      return;
    }
    if (activity.revision !== parsed.data.expectedRevision) {
      res.status(409).json({ error: "La actuación cambió. Recarga antes de confirmarla." });
      return;
    }
    if (activity.status === "descartada" || activity.status === "validada") {
      res.status(409).json({ error: "El estado actual de la actuación no admite confirmación." });
      return;
    }
    const updated = await db.transaction(async (tx) => {
      const [saved] = await tx
        .update(activitiesTable)
        .set({
          informationStatus: parsed.data.informationStatus,
          status: "pendiente_c2",
          confirmedBy: actor.id,
          confirmedAt: new Date(),
          revision: activity.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(activitiesTable.id, activity.id),
            eq(activitiesTable.revision, parsed.data.expectedRevision),
          ),
        )
        .returning();
      if (!saved) return null;
      await saveActivityVersion(tx, saved, actor.id);
      return saved;
    });
    if (!updated) {
      res.status(409).json({ error: "La actuación cambió durante la confirmación." });
      return;
    }
    await recordCaptureAudit(
      req,
      actor.id,
      "activity.confirmed",
      "activity",
      activity.id,
      { informationStatus: updated.informationStatus },
    );
    res.json(await activityView(updated));
  },
);

router.post(
  "/activities/:activityId/validate",
  requireAuth,
  requireCsrf,
  requirePermission("activities.validate"),
  async (req, res) => {
    const parsed = ValidateActivityBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "La revisión esperada no es válida." });
      return;
    }
    const context = userContext(res);
    const { actor, activity } = await loadVisibleActivity(
      context.user.id,
      pathParam(req, "activityId"),
    );
    if (!actor || !activity) {
      res.status(404).json({ error: "No se encontró la actuación." });
      return;
    }
    if (actor.role !== "c2_innovacion") {
      res.status(403).json({ error: "La validación corresponde a C2." });
      return;
    }
    if (
      activity.revision !== parsed.data.expectedRevision ||
      activity.status !== "pendiente_c2" ||
      activity.informationStatus !== "confirmada" ||
      !activity.activityDate
    ) {
      res.status(409).json({ error: "Confirma los datos y la fecha antes de validar la actuación." });
      return;
    }
    const updated = await db.transaction(async (tx) => {
      const [saved] = await tx
        .update(activitiesTable)
        .set({
          status: "validada",
          validatedBy: actor.id,
          validatedAt: new Date(),
          revision: activity.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(activitiesTable.id, activity.id),
            eq(activitiesTable.revision, parsed.data.expectedRevision),
            eq(activitiesTable.status, "pendiente_c2"),
          ),
        )
        .returning();
      if (!saved) return null;
      await saveActivityVersion(tx, saved, actor.id);
      return saved;
    });
    if (!updated) {
      res.status(409).json({ error: "La actuación cambió durante la validación." });
      return;
    }
    await recordCaptureAudit(req, actor.id, "activity.validated", "activity", activity.id, {
      revision: updated.revision,
    });
    res.json(await activityView(updated));
  },
);

router.post(
  "/activities/:activityId/discard",
  requireAuth,
  requireCsrf,
  requirePermission("activities.write"),
  async (req, res) => {
    const parsed = DiscardActivityBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "La revisión esperada no es válida." });
      return;
    }
    const context = userContext(res);
    const { actor, activity } = await loadVisibleActivity(
      context.user.id,
      pathParam(req, "activityId"),
    );
    if (!actor || !activity || !canWriteActivity(actor, activity)) {
      res.status(404).json({ error: "No se encontró la actuación en tu ámbito." });
      return;
    }
    if (activity.revision !== parsed.data.expectedRevision) {
      res.status(409).json({ error: "La actuación cambió. Recarga antes de retirarla." });
      return;
    }
    if (activity.status === "descartada") {
      res.status(409).json({ error: "La actuación ya estaba retirada." });
      return;
    }
    const updated = await db.transaction(async (tx) => {
      const [saved] = await tx
        .update(activitiesTable)
        .set({
          status: "descartada",
          discardedAt: new Date(),
          revision: activity.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(activitiesTable.id, activity.id),
            eq(activitiesTable.revision, parsed.data.expectedRevision),
          ),
        )
        .returning();
      if (!saved) return null;
      await saveActivityVersion(tx, saved, actor.id);
      return saved;
    });
    if (!updated) {
      res.status(409).json({ error: "La actuación cambió durante la retirada." });
      return;
    }
    await recordCaptureAudit(req, actor.id, "activity.discarded", "activity", activity.id, {
      previousStatus: activity.status,
      revision: updated.revision,
    });
    res.json(await activityView(updated));
  },
);

export default router;

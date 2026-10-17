import { Router, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, max, sql } from "drizzle-orm";
import {
  auditLogsTable,
  centersTable,
  db,
  picActionSelectionsTable,
  picCalendarMeetingsTable,
  picCatalogsTable,
  picCiclopeMembersTable,
  picCustomActionsTable,
  picDafoTable,
  picIndicatorTargetsTable,
  picOdsLinksTable,
  picPlansTable,
  picProjectsTable,
  picSnapshotsTable,
  picSubmissionRecordsTable,
  schoolYearsTable,
  usersTable,
} from "@workspace/db";
import {
  CreateCurrentPicPlanResponse,
  CreatePicSnapshotBody,
  CreatePicSnapshotResponse,
  GetPicSnapshotResponse,
  GetCurrentPicPlanResponse,
  GetPicSubmissionResponse,
  GetPicSubmissionEvidenceResponse,
  RecordPicSubmissionBody,
  RecordPicSubmissionResponse,
  ListPicSnapshotsResponse,
  SavePicPlanBody,
  SavePicPlanResponse,
  ValidatePicPlanResponse,
  type PicPlanContent,
} from "@workspace/api-zod";
import {
  getClientIp,
  keyedHash,
  requireAuth,
  requireCsrf,
  requirePermission,
  type AuthContext,
} from "../lib/auth";
import { dataDirectory } from "../lib/storage";
import { withDerivedCenterTotals } from "../lib/pic-center-profile";
import {
  catalogDigest,
} from "../lib/reference-data";
import {
  createEmptyPicPlanContent,
  validatePicPlan,
  type OfficialPicCatalog,
} from "../lib/pic-plan-validation";
import {
  createPicDocx,
  createPicPdf,
  createLaycosExport,
} from "../lib/pic-plan-exports";

const router = Router();
const MAX_EVIDENCE_BYTES = 1024 * 1024;
const ALLOWED_EVIDENCE = {
  "application/pdf": { extension: ".pdf", signature: (data: Buffer) => data.subarray(0, 5).toString() === "%PDF-" },
  "image/png": {
    extension: ".png",
    signature: (data: Buffer) =>
      data.length >= 8 &&
      data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  "image/jpeg": {
    extension: ".jpg",
    signature: (data: Buffer) =>
      data.length >= 3 &&
      data[0] === 0xff &&
      data[1] === 0xd8 &&
      data[2] === 0xff,
  },
} as const;

function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === "string" ? value : value?.[0] ?? "";
}

type PlanJoinRow = {
  plan: typeof picPlansTable.$inferSelect;
  centerName: string;
  schoolYear: string;
  catalogId: string;
};

async function getCurrentUserCenter(userId: string): Promise<string | null> {
  const [user] = await db
    .select({ centerId: usersTable.centerId })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return user?.centerId ?? null;
}

async function getActiveYear(centerId: string) {
  const [year] = await db
    .select({ id: schoolYearsTable.id, label: schoolYearsTable.label })
    .from(schoolYearsTable)
    .where(
      and(
        eq(schoolYearsTable.centerId, centerId),
        eq(schoolYearsTable.active, true),
      ),
    )
    .limit(1);
  return year ?? null;
}

async function loadPlan(planId: string, centerId: string): Promise<PlanJoinRow | null> {
  const [row] = await db
    .select({
      plan: picPlansTable,
      centerName: centersTable.name,
      schoolYear: schoolYearsTable.label,
      catalogId: picCatalogsTable.catalogId,
    })
    .from(picPlansTable)
    .innerJoin(centersTable, eq(picPlansTable.centerId, centersTable.id))
    .innerJoin(schoolYearsTable, eq(picPlansTable.schoolYearId, schoolYearsTable.id))
    .innerJoin(picCatalogsTable, eq(picPlansTable.catalogRowId, picCatalogsTable.id))
    .where(and(eq(picPlansTable.id, planId), eq(picPlansTable.centerId, centerId)))
    .limit(1);
  return row ?? null;
}

function toPublicPlan(row: PlanJoinRow) {
  const response = {
    id: row.plan.id,
    revision: row.plan.revision,
    status: row.plan.status,
    catalogId: row.catalogId,
    catalogVersion: row.plan.catalogVersion,
    centerName: row.centerName,
    schoolYear: row.schoolYear,
    content: row.plan.content,
    updatedAt: row.plan.updatedAt.toISOString(),
  };
  const parsed = GetCurrentPicPlanResponse.safeParse(response);
  if (!parsed.success) {
    throw new Error("Stored PIC plan does not match the API contract.");
  }
  return parsed.data;
}

async function loadPlanCatalog(catalogRowId: string): Promise<OfficialPicCatalog | null> {
  const [catalog] = await db
    .select({ payload: picCatalogsTable.payload })
    .from(picCatalogsTable)
    .where(eq(picCatalogsTable.id, catalogRowId))
    .limit(1);
  return catalog?.payload as OfficialPicCatalog | undefined ?? null;
}

function actor(req: Request, context: AuthContext) {
  return {
    userId: context.user.id,
    ipHash: keyedHash(getClientIp(req)),
  };
}

router.get(
  "/plans/current",
  requireAuth,
  requirePermission("pic.plan.read"),
  async (req, res) => {
    const context = res.locals.auth as AuthContext;
    const centerId = await getCurrentUserCenter(context.user.id);
    if (!centerId) {
      res.status(403).json({ error: "La cuenta no está asociada a un centro." });
      return;
    }
    const year = await getActiveYear(centerId);
    if (!year) {
      res.status(409).json({ error: "El centro no tiene un curso activo configurado." });
      return;
    }
    const [plan] = await db
      .select({ id: picPlansTable.id })
      .from(picPlansTable)
      .where(
        and(
          eq(picPlansTable.centerId, centerId),
          eq(picPlansTable.schoolYearId, year.id),
        ),
      )
      .limit(1);
    if (!plan) {
      res.status(404).json({ error: "Aún no se ha creado el PIC del curso activo." });
      return;
    }
    const row = await loadPlan(plan.id, centerId);
    if (!row) {
      res.status(404).json({ error: "No se encontró el PIC solicitado." });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.json(toPublicPlan(row));
  },
);

router.post(
  "/plans/current",
  requireAuth,
  requireCsrf,
  requirePermission("pic.plan.write"),
  async (req, res) => {
    const context = res.locals.auth as AuthContext;
    const centerId = await getCurrentUserCenter(context.user.id);
    if (!centerId) {
      res.status(403).json({ error: "La cuenta no está asociada a un centro." });
      return;
    }
    const [year] = await db
      .select({ id: schoolYearsTable.id })
      .from(schoolYearsTable)
      .where(
        and(
          eq(schoolYearsTable.centerId, centerId),
          eq(schoolYearsTable.active, true),
        ),
      )
      .limit(1);
    const [catalog] = await db
      .select({
        id: picCatalogsTable.id,
        catalogId: picCatalogsTable.catalogId,
        version: picCatalogsTable.version,
      })
      .from(picCatalogsTable)
      .where(eq(picCatalogsTable.active, true))
      .limit(1);
    if (!year || !catalog) {
      res.status(409).json({ error: "Falta el curso activo o el catálogo PIC vigente." });
      return;
    }
    const [created] = await db
      .insert(picPlansTable)
      .values({
        centerId,
        schoolYearId: year.id,
        catalogRowId: catalog.id,
        catalogVersion: catalog.version,
        content: createEmptyPicPlanContent() as unknown as Record<string, unknown>,
        updatedBy: context.user.id,
      })
      .onConflictDoNothing({
        target: [picPlansTable.centerId, picPlansTable.schoolYearId],
      })
      .returning({ id: picPlansTable.id });
    if (!created) {
      res.status(409).json({ error: "Ya existe un PIC para el curso activo." });
      return;
    }
    const row = await loadPlan(created.id, centerId);
    if (!row) {
      res.status(500).json({ error: "No se pudo recuperar el PIC recién creado." });
      return;
    }
    await db.insert(auditLogsTable).values({
      userId: context.user.id,
      action: "pic.plan.created",
      entityType: "pic_plan",
      entityId: created.id,
      details: { catalogId: catalog.catalogId, catalogVersion: catalog.version },
      ipHash: keyedHash(getClientIp(req)),
    });
    const response = CreateCurrentPicPlanResponse.safeParse(toPublicPlan(row));
    if (!response.success) {
      res.status(500).json({ error: "El PIC creado no supera la validación de respuesta." });
      return;
    }
    res.status(201).json(response.data);
  },
);

router.put(
  "/plans/:planId",
  requireAuth,
  requireCsrf,
  requirePermission("pic.plan.write"),
  async (req, res) => {
    const parsed = SavePicPlanBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "El contenido del PIC no tiene el formato esperado." });
      return;
    }
    const context = res.locals.auth as AuthContext;
    const centerId = await getCurrentUserCenter(context.user.id);
    if (!centerId) {
      res.status(403).json({ error: "La cuenta no está asociada a un centro." });
      return;
    }
    const existing = await loadPlan(pathParam(req, "planId"), centerId);
    if (!existing) {
      res.status(404).json({ error: "No se encontró el PIC solicitado." });
      return;
    }
    if (existing.plan.revision !== parsed.data.expectedRevision) {
      res.status(409).json({ error: "El PIC cambió desde que lo abriste. Recarga para evitar perder cambios." });
      return;
    }
    const content = withDerivedCenterTotals(parsed.data.content as PicPlanContent);
    if (content.center.familyProfiles) {
      const catalog = await loadPlanCatalog(existing.plan.catalogRowId);
      if (!catalog) {
        res.status(409).json({ error: "No se encontró el catálogo vinculado al PIC." });
        return;
      }
      const names = content.center.familyProfiles.map(row => row.professionalFamily);
      if (new Set(names).size !== names.length ||
          names.some(name => !catalog.familias_profesionales.includes(name))) {
        res.status(400).json({ error: "El desglose debe usar familias oficiales del Anexo I, sin repetir ninguna." });
        return;
      }
    }
    const { userId, ipHash } = actor(req, context);
    const updated = await db.transaction(async (tx) => {
      const [saved] = await tx
        .update(picPlansTable)
        .set({
          content: content as unknown as Record<string, unknown>,
          revision: existing.plan.revision + 1,
          status: "draft",
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(picPlansTable.id, existing.plan.id),
            eq(picPlansTable.centerId, centerId),
            eq(picPlansTable.revision, parsed.data.expectedRevision),
          ),
        )
        .returning({ id: picPlansTable.id, revision: picPlansTable.revision });
      if (!saved) return null;

      await tx.delete(picDafoTable).where(eq(picDafoTable.planId, saved.id));
      await tx.delete(picProjectsTable).where(eq(picProjectsTable.planId, saved.id));
      await tx.delete(picActionSelectionsTable).where(eq(picActionSelectionsTable.planId, saved.id));
      await tx.delete(picIndicatorTargetsTable).where(eq(picIndicatorTargetsTable.planId, saved.id));
      await tx.delete(picCustomActionsTable).where(eq(picCustomActionsTable.planId, saved.id));
      await tx.delete(picOdsLinksTable).where(eq(picOdsLinksTable.planId, saved.id));
      await tx.delete(picCiclopeMembersTable).where(eq(picCiclopeMembersTable.planId, saved.id));
      await tx.delete(picCalendarMeetingsTable).where(eq(picCalendarMeetingsTable.planId, saved.id));

      if (content.dafo.length) {
        await tx.insert(picDafoTable).values(
          content.dafo.map((entry, position) => ({
            planId: saved.id,
            quadrant: entry.quadrant,
            position,
            category: entry.category,
            situation: entry.situation,
            customDetail: entry.customDetail || null,
          })),
        );
      }
      if (content.projects.length) {
        await tx.insert(picProjectsTable).values(
          content.projects.map((project) => ({
            planId: saved.id,
            promoter: project.promoter,
            name: project.name,
            centerCoordinates: project.centerCoordinates,
            coordinatingFamily: project.coordinatingFamily,
            coordinatorName: project.coordinatorName,
            coordinatorEmail: project.coordinatorEmail,
            includedInPic: project.includedInPic,
          })),
        );
      }
      if (content.selectedActions.length) {
        await tx.insert(picActionSelectionsTable).values(
          content.selectedActions.map((selection) => ({
            planId: saved.id,
            actionCode: selection.actionCode,
            objectiveCode: selection.objectiveCode,
          })),
        );
        const targets = content.selectedActions.flatMap((selection) =>
          selection.indicators
            .filter(
              (indicator) =>
                indicator.targetValue !== null && indicator.riskValue !== null,
            )
            .map((indicator) => ({
              planId: saved.id,
              actionCode: selection.actionCode,
              indicatorId: indicator.indicatorId,
              unit: indicator.unit,
              targetValue: indicator.targetValue as number | boolean,
              riskValue: indicator.riskValue as number | boolean,
              updatedBy: userId,
            })),
        );
        if (targets.length) await tx.insert(picIndicatorTargetsTable).values(targets);
      }
      if (content.customActions.length) {
        const customRows = content.customActions.flatMap((action, position) =>
          action.targetValue === null || action.riskValue === null
            ? []
            : [{
                planId: saved.id,
                position,
                objectiveCode: action.objectiveCode,
                title: action.title,
                indicatorLabel: action.indicatorLabel,
                unit: action.unit,
                targetValue: action.targetValue,
                riskValue: action.riskValue,
              }],
        );
        if (customRows.length) await tx.insert(picCustomActionsTable).values(customRows);
      }
      if (content.odsLinks.length) {
        await tx.insert(picOdsLinksTable).values(
          content.odsLinks.map((link) => ({
            planId: saved.id,
            agenda: link.agenda,
            odsCode: link.odsCode,
            objectiveCodes: link.objectiveCodes,
          })),
        );
      }
      if (content.ciclopeMembers.length) {
        await tx.insert(picCiclopeMembersTable).values(
          content.ciclopeMembers.map((member, position) => ({
            planId: saved.id,
            position,
            name: member.name,
            role: member.role,
            professionalFamily: member.professionalFamily,
          })),
        );
      }
      const meetings = [
        ...content.calendar.redMeetingDates.map((scheduledDate, position) => ({
          planId: saved.id,
          meetingType: "red",
          position,
          scheduledDate,
        })),
        ...content.calendar.ciclopeMeetingDates.map((scheduledDate, position) => ({
          planId: saved.id,
          meetingType: "ciclope",
          position,
          scheduledDate,
        })),
      ];
      if (meetings.length) await tx.insert(picCalendarMeetingsTable).values(meetings);
      await tx.insert(auditLogsTable).values({
        userId,
        action: "pic.plan.saved",
        entityType: "pic_plan",
        entityId: saved.id,
        details: { revision: saved.revision },
        ipHash,
      });
      return saved;
    });
    if (!updated) {
      res.status(409).json({ error: "El PIC cambió mientras se guardaban tus cambios. Recarga e inténtalo de nuevo." });
      return;
    }
    const row = await loadPlan(updated.id, centerId);
    if (!row) {
      res.status(500).json({ error: "No se pudo recuperar el PIC guardado." });
      return;
    }
    const response = SavePicPlanResponse.safeParse(toPublicPlan(row));
    if (!response.success) {
      res.status(500).json({ error: "El PIC guardado no supera la validación de respuesta." });
      return;
    }
    res.json(response.data);
  },
);

router.get(
  "/plans/:planId/validation",
  requireAuth,
  requirePermission("pic.plan.read"),
  async (req, res) => {
    const context = res.locals.auth as AuthContext;
    const centerId = await getCurrentUserCenter(context.user.id);
    const plan = centerId ? await loadPlan(pathParam(req, "planId"), centerId) : null;
    if (!plan) {
      res.status(404).json({ error: "No se encontró el PIC solicitado." });
      return;
    }
    const catalog = await loadPlanCatalog(plan.plan.catalogRowId);
    if (!catalog) {
      res.status(503).json({ error: "No se encontró la versión de catálogo asociada al PIC." });
      return;
    }
    const result = validatePicPlan(plan.plan.content as unknown as PicPlanContent, catalog);
    const parsed = ValidatePicPlanResponse.safeParse(result);
    if (!parsed.success) {
      res.status(500).json({ error: "El resultado de validación no cumple el contrato de la API." });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.json(parsed.data);
  },
);

router.post(
  "/plans/:planId/snapshot",
  requireAuth,
  requireCsrf,
  requirePermission("pic.plan.write"),
  async (req, res) => {
    const parsedBody = CreatePicSnapshotBody.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: "Indica el motivo para conservar esta versión." });
      return;
    }
    const context = res.locals.auth as AuthContext;
    const centerId = await getCurrentUserCenter(context.user.id);
    const plan = centerId ? await loadPlan(pathParam(req, "planId"), centerId) : null;
    if (!plan) {
      res.status(404).json({ error: "No se encontró el PIC solicitado." });
      return;
    }
    const catalog = await loadPlanCatalog(plan.plan.catalogRowId);
    if (!catalog) {
      res.status(503).json({ error: "No se encontró la versión de catálogo asociada al PIC." });
      return;
    }
    const content = plan.plan.content as unknown as PicPlanContent;
    const validation = validatePicPlan(content, catalog);
    if (!validation.valid) {
      res.status(422).json(validation);
      return;
    }
    const sourceHash = catalogDigest({
      planId: plan.plan.id,
      revision: plan.plan.revision,
      catalogVersion: plan.plan.catalogVersion,
      content,
    });
    const snapshot = await db.transaction(async (tx) => {
      const [lockedPlan] = await tx
        .select({ id: picPlansTable.id })
        .from(picPlansTable)
        .where(
          and(
            eq(picPlansTable.id, plan.plan.id),
            eq(picPlansTable.revision, plan.plan.revision),
          ),
        )
        .for("update");
      if (!lockedPlan) return null;
      // Serialize version allocation for this plan; snapshots remain immutable.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${plan.plan.id}))`,
      );
      const [latest] = await tx
        .select({ version: max(picSnapshotsTable.version) })
        .from(picSnapshotsTable)
        .where(eq(picSnapshotsTable.planId, plan.plan.id));
      const [created] = await tx
        .insert(picSnapshotsTable)
        .values({
          planId: plan.plan.id,
          version: (latest?.version ?? 0) + 1,
          planRevision: plan.plan.revision,
          reason: parsedBody.data.reason.trim(),
          sourceHash,
          content: content as unknown as Record<string, unknown>,
          validation: validation as unknown as Record<string, unknown>,
          createdBy: context.user.id,
        })
        .returning({
          id: picSnapshotsTable.id,
          version: picSnapshotsTable.version,
          sourceHash: picSnapshotsTable.sourceHash,
          createdAt: picSnapshotsTable.createdAt,
        });
      await tx
        .update(picPlansTable)
        .set({ status: "internally_complete", updatedAt: new Date() })
        .where(eq(picPlansTable.id, plan.plan.id));
      await tx.insert(auditLogsTable).values({
        userId: context.user.id,
        action: "pic.plan.snapshot.created",
        entityType: "pic_plan_snapshot",
        entityId: created.id,
        details: {
          planId: plan.plan.id,
          version: created.version,
          planRevision: plan.plan.revision,
          reason: parsedBody.data.reason.trim(),
          sourceHash,
        },
        ipHash: keyedHash(getClientIp(req)),
      });
      return created;
    });
    if (!snapshot) {
      res.status(409).json({ error: "El PIC cambió durante la validación. Recarga, guarda y vuelve a validar." });
      return;
    }
    const response = CreatePicSnapshotResponse.safeParse({
      snapshotId: snapshot.id,
      version: snapshot.version,
      sourceHash: snapshot.sourceHash,
      createdAt: snapshot.createdAt.toISOString(),
    });
    if (!response.success) {
      res.status(500).json({ error: "No se pudo validar la respuesta del snapshot." });
      return;
    }
    res.status(201).json(response.data);
  },
);

router.get(
  "/plans/:planId/snapshots",
  requireAuth,
  requirePermission("pic.plan.read"),
  async (req, res) => {
    const context = res.locals.auth as AuthContext;
    const centerId = await getCurrentUserCenter(context.user.id);
    const plan = centerId ? await loadPlan(pathParam(req, "planId"), centerId) : null;
    if (!plan) {
      res.status(404).json({ error: "No se encontró el PIC solicitado." });
      return;
    }
    const snapshots = await db
      .select({
        id: picSnapshotsTable.id,
        version: picSnapshotsTable.version,
        planRevision: picSnapshotsTable.planRevision,
        reason: picSnapshotsTable.reason,
        sourceHash: picSnapshotsTable.sourceHash,
        createdAt: picSnapshotsTable.createdAt,
      })
      .from(picSnapshotsTable)
      .where(eq(picSnapshotsTable.planId, plan.plan.id))
      .orderBy(desc(picSnapshotsTable.version));
    const response = ListPicSnapshotsResponse.safeParse(
      snapshots.map((snapshot) => ({
        ...snapshot,
        createdAt: snapshot.createdAt.toISOString(),
      })),
    );
    if (!response.success) {
      res.status(500).json({ error: "No se pudo validar el historial de snapshots." });
      return;
    }
    res.json(response.data);
  },
);

router.get(
  "/plans/:planId/snapshots/:snapshotId",
  requireAuth,
  requirePermission("pic.plan.read"),
  async (req, res) => {
    const context = res.locals.auth as AuthContext;
    const centerId = await getCurrentUserCenter(context.user.id);
    const plan = centerId ? await loadPlan(pathParam(req, "planId"), centerId) : null;
    if (!plan) {
      res.status(404).json({ error: "No se encontró el PIC solicitado." });
      return;
    }
    const [snapshot] = await db
      .select()
      .from(picSnapshotsTable)
      .where(
        and(
          eq(picSnapshotsTable.id, pathParam(req, "snapshotId")),
          eq(picSnapshotsTable.planId, plan.plan.id),
        ),
      )
      .limit(1);
    if (!snapshot) {
      res.status(404).json({ error: "No se encontró la versión solicitada." });
      return;
    }
    const response = GetPicSnapshotResponse.safeParse({
      id: snapshot.id,
      version: snapshot.version,
      planRevision: snapshot.planRevision,
      reason: snapshot.reason,
      sourceHash: snapshot.sourceHash,
      createdAt: snapshot.createdAt.toISOString(),
      content: snapshot.content,
      validation: snapshot.validation,
    });
    if (!response.success) {
      res.status(500).json({ error: "La versión guardada no supera la validación de respuesta." });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.json(response.data);
  },
);

router.get(
  "/plans/:planId/submission",
  requireAuth,
  requirePermission("pic.plan.read"),
  async (req, res) => {
    const context = res.locals.auth as AuthContext;
    const centerId = await getCurrentUserCenter(context.user.id);
    const plan = centerId ? await loadPlan(pathParam(req, "planId"), centerId) : null;
    if (!plan) {
      res.status(404).json({ error: "No se encontró el PIC solicitado." });
      return;
    }
    const [submission] = await db
      .select()
      .from(picSubmissionRecordsTable)
      .where(eq(picSubmissionRecordsTable.planId, plan.plan.id))
      .orderBy(desc(picSubmissionRecordsTable.createdAt))
      .limit(1);
    if (!submission) {
      res.status(404).json({ error: "Todavía no se ha registrado una presentación manual en Laycos." });
      return;
    }
    res.json({
      id: submission.id,
      submissionDate: submission.submissionDate,
      externalIdentifier: submission.externalIdentifier,
      evidenceFileName: submission.evidenceFileName,
      evidenceSha256: submission.evidenceSha256,
    });
  },
);

router.post(
  "/plans/:planId/submission",
  requireAuth,
  requireCsrf,
  requirePermission("pic.plan.submit"),
  async (req, res) => {
    const parsed = RecordPicSubmissionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Los datos o el archivo de justificante no son válidos." });
      return;
    }
    const context = res.locals.auth as AuthContext;
    const centerId = await getCurrentUserCenter(context.user.id);
    const plan = centerId ? await loadPlan(pathParam(req, "planId"), centerId) : null;
    if (!plan) {
      res.status(404).json({ error: "No se encontró el PIC solicitado." });
      return;
    }
    const [snapshot] = await db
      .select({
        id: picSnapshotsTable.id,
        planRevision: picSnapshotsTable.planRevision,
      })
      .from(picSnapshotsTable)
      .where(
        and(
          eq(picSnapshotsTable.id, parsed.data.snapshotId),
          eq(picSnapshotsTable.planId, plan.plan.id),
        ),
      )
      .limit(1);
    if (!snapshot) {
      res.status(422).json({ error: "Crea primero un snapshot validado de este PIC." });
      return;
    }

    const mimeType = parsed.data.evidenceMimeType as keyof typeof ALLOWED_EVIDENCE;
    const rule = ALLOWED_EVIDENCE[mimeType];
    if (!rule || !/^[A-Za-z0-9+/]+={0,2}$/.test(parsed.data.evidenceFileBase64)) {
      res.status(400).json({ error: "El tipo o la codificación del justificante no son válidos." });
      return;
    }
    const evidence = Buffer.from(parsed.data.evidenceFileBase64, "base64");
    if (
      evidence.length === 0 ||
      evidence.length > MAX_EVIDENCE_BYTES ||
      evidence.toString("base64").replace(/=+$/, "") !==
        parsed.data.evidenceFileBase64.replace(/=+$/, "") ||
      !rule.signature(evidence) ||
      (mimeType === "application/pdf" &&
        !evidence.subarray(-1024).includes(Buffer.from("%%EOF"))) ||
      (mimeType === "image/png" &&
        (evidence.length < 45 ||
          !evidence.subarray(-12).equals(
            Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]),
          ))) ||
      (mimeType === "image/jpeg" &&
        !evidence.subarray(-2).equals(Buffer.from([0xff, 0xd9])))
    ) {
      res.status(400).json({ error: "El archivo no coincide con su tipo declarado o supera 1 MiB." });
      return;
    }
    const sha = createHash("sha256").update(evidence).digest("hex");
    const extension = rule.extension;
    const storageKey = `${sha}${extension}`;
    const evidenceDirectory = path.join(dataDirectory, "pic-submissions");
    const evidencePath = path.join(evidenceDirectory, storageKey);
    await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
    let createdEvidence = false;
    try {
      try {
        await writeFile(evidencePath, evidence, { flag: "wx", mode: 0o600 });
        createdEvidence = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const safeName = path
        .basename(parsed.data.evidenceFileName.replaceAll("\\", "/"))
        .replace(/[^A-Za-z0-9._-]/g, "_")
        .slice(0, 120) || `justificante${extension}`;
      const [submission] = await db.transaction(async (tx) => {
        const [saved] = await tx
          .insert(picSubmissionRecordsTable)
          .values({
            planId: plan.plan.id,
            snapshotId: snapshot.id,
            submissionDate: parsed.data.submissionDate,
            externalIdentifier: parsed.data.externalIdentifier || null,
            evidenceFileName: safeName,
            evidenceMimeType: mimeType,
            evidenceSha256: sha,
            evidenceStorageKey: storageKey,
            recordedBy: context.user.id,
          })
          .returning();
        await tx
          .update(picPlansTable)
          .set({ status: "submitted", updatedAt: new Date() })
          .where(
            and(
              eq(picPlansTable.id, plan.plan.id),
              eq(picPlansTable.revision, snapshot.planRevision),
            ),
          );
        await tx.insert(auditLogsTable).values({
          userId: context.user.id,
          action: "pic.plan.submission.recorded",
          entityType: "pic_plan_submission",
          entityId: saved.id,
          details: {
            planId: plan.plan.id,
            snapshotId: snapshot.id,
            submissionDate: parsed.data.submissionDate,
            evidenceSha256: sha,
          },
          ipHash: keyedHash(getClientIp(req)),
        });
        return [saved];
      });
      const response = RecordPicSubmissionResponse.safeParse({
        id: submission.id,
        submissionDate: submission.submissionDate,
        externalIdentifier: submission.externalIdentifier,
        evidenceFileName: submission.evidenceFileName,
        evidenceSha256: submission.evidenceSha256,
      });
      if (!response.success) {
        res.status(500).json({ error: "No se pudo validar el justificante registrado." });
        return;
      }
      res.status(201).json(response.data);
    } catch (error) {
      if (createdEvidence) await unlink(evidencePath).catch(() => undefined);
      throw error;
    }
  },
);

router.get(
  "/plans/:planId/submission/:submissionId/evidence",
  requireAuth,
  requirePermission("pic.plan.read"),
  async (req, res) => {
    const context = res.locals.auth as AuthContext;
    const centerId = await getCurrentUserCenter(context.user.id);
    const plan = centerId ? await loadPlan(pathParam(req, "planId"), centerId) : null;
    if (!plan) {
      res.status(404).json({ error: "No se encontró el PIC solicitado." });
      return;
    }
    const [submission] = await db
      .select()
      .from(picSubmissionRecordsTable)
      .where(
        and(
          eq(picSubmissionRecordsTable.id, pathParam(req, "submissionId")),
          eq(picSubmissionRecordsTable.planId, plan.plan.id),
        ),
      )
      .limit(1);
    if (!submission) {
      res.status(404).json({ error: "No se encontró el justificante." });
      return;
    }
    const evidencePath = path.join(dataDirectory, "pic-submissions", submission.evidenceStorageKey);
    const data = await readFile(evidencePath).catch(() => null);
    if (!data) {
      res.status(404).json({ error: "El archivo del justificante no está disponible." });
      return;
    }
    const response = GetPicSubmissionEvidenceResponse.safeParse({
      filename: submission.evidenceFileName,
      mediaType: submission.evidenceMimeType,
      contentBase64: data.toString("base64"),
    });
    if (!response.success) {
      res.status(500).json({ error: "No se pudo validar el archivo de justificante." });
      return;
    }
    res.json(response.data);
  },
);

router.get(
  "/plans/:planId/exports/laycos",
  requireAuth,
  requirePermission("pic.plan.read"),
  async (req, res) => {
    const context = res.locals.auth as AuthContext;
    const centerId = await getCurrentUserCenter(context.user.id);
    const plan = centerId ? await loadPlan(pathParam(req, "planId"), centerId) : null;
    if (!plan) {
      res.status(404).json({ error: "No se encontró el PIC solicitado." });
      return;
    }
    const catalog = await loadPlanCatalog(plan.plan.catalogRowId);
    if (!catalog) {
      res.status(503).json({ error: "No se encontró la versión de catálogo asociada al PIC." });
      return;
    }
    const fields = createLaycosExport(
      plan.plan.content as unknown as PicPlanContent,
      catalog,
      plan.centerName,
      plan.schoolYear,
    );
    res.json({
      planId: plan.plan.id,
      revision: plan.plan.revision,
      catalogVersion: plan.plan.catalogVersion,
      generatedAt: new Date().toISOString(),
      fields,
    });
  },
);

async function respondWithExport(
  req: Request,
  res: Response,
  format: "docx" | "pdf",
) {
  const context = res.locals.auth as AuthContext;
  const centerId = await getCurrentUserCenter(context.user.id);
  const plan = centerId ? await loadPlan(pathParam(req, "planId"), centerId) : null;
  if (!plan) {
    res.status(404).json({ error: "No se encontró el PIC solicitado." });
    return;
  }
  const catalog = await loadPlanCatalog(plan.plan.catalogRowId);
  if (!catalog) {
    res.status(503).json({ error: "No se encontró la versión de catálogo asociada al PIC." });
    return;
  }
  const content = plan.plan.content as unknown as PicPlanContent;
  const validation = validatePicPlan(content, catalog);
  const buffer =
    format === "docx"
      ? await createPicDocx(content, catalog, plan.centerName, plan.schoolYear, plan.plan.revision, validation)
      : await createPicPdf(content, catalog, plan.centerName, plan.schoolYear, plan.plan.revision, validation);
  res.json({
    filename: `PIC_${plan.schoolYear.replace(/[^0-9A-Za-z-]/g, "_")}_rev${plan.plan.revision}.${format}`,
    mediaType:
      format === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf",
    contentBase64: buffer.toString("base64"),
    generatedAt: new Date().toISOString(),
  });
}

router.get(
  "/plans/:planId/exports/docx",
  requireAuth,
  requirePermission("pic.plan.read"),
  async (req, res) => respondWithExport(req, res, "docx"),
);

router.get(
  "/plans/:planId/exports/pdf",
  requireAuth,
  requirePermission("pic.plan.read"),
  async (req, res) => respondWithExport(req, res, "pdf"),
);

export default router;

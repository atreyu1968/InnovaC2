import { createHash } from "node:crypto";
import { and, desc, eq, isNull, inArray } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import {
  activitiesTable,
  activityVersionsTable,
  db,
  informationRequestsTable,
  informationResponsesTable,
  picPlansTable,
  picProjectsTable,
  usersTable,
} from "@workspace/db";
import {
  CreateInformationRequestBody,
  RespondToInformationRequestBody,
  ValidateInformationResponseBody,
  type InformationRequest as ApiInformationRequest,
} from "@workspace/api-zod";
import {
  canReadActivity,
  loadActiveSchoolYear,
  loadCaptureActor,
  loadCatalogPayload,
  loadCurrentPlan,
  recordCaptureAudit,
  sameFamily,
} from "../lib/capture-scope";
import { requireAuth, requireCsrf, requirePermission, type AuthContext } from "../lib/auth";

const router = Router();

function authContext(res: Response): AuthContext {
  return res.locals.auth as AuthContext;
}

function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === "string" ? value : value?.[0] ?? "";
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

async function requestView(
  row: typeof informationRequestsTable.$inferSelect,
): Promise<ApiInformationRequest> {
  const [latest] = await db
    .select()
    .from(informationResponsesTable)
    .where(eq(informationResponsesTable.requestId, row.id))
    .orderBy(desc(informationResponsesTable.createdAt))
    .limit(1);
  return {
    id: row.id,
    recipientUserId: row.recipientUserId,
    subjectType: row.subjectType as ApiInformationRequest["subjectType"],
    subjectId: row.subjectId,
    requestedFields: row.requestedFields,
    reason: row.reason,
    dueAt: row.dueAt,
    status: row.status as ApiInformationRequest["status"],
    revision: row.revision,
    latestResponseStatus: latest
      ? (latest.responseStatus as ApiInformationRequest["latestResponseStatus"])
      : null,
    latestAnswers: latest?.answers ?? {},
    latestComment: latest?.comment ?? "",
    createdAt: row.createdAt,
  };
}

async function currentActivity(
  actorId: string,
  centerId: string,
  schoolYearId: string,
  activityId: string,
) {
  const actor = await loadCaptureActor(actorId);
  if (!actor) return null;
  const [activity] = await db
    .select()
    .from(activitiesTable)
    .where(
      and(
        eq(activitiesTable.id, activityId),
        eq(activitiesTable.centerId, centerId),
        eq(activitiesTable.schoolYearId, schoolYearId),
      ),
    )
    .limit(1);
  return activity && canReadActivity(actor, activity) ? activity : null;
}

function missingActivityFields(
  activity: typeof activitiesTable.$inferSelect,
  requested: string[],
): string[] {
  const knownValues: Record<string, unknown> = {
    title: activity.title,
    description: activity.description,
    activityDate: activity.activityDate,
    professionalFamily: activity.professionalFamily,
    projectId: activity.projectId,
  };
  return [...new Set(requested)].filter((field) => {
    if (!(field in knownValues)) return true;
    const value = knownValues[field];
    return value === null || value === undefined || value === "";
  });
}

function requestKey(
  recipientUserId: string,
  subjectType: string,
  subjectId: string,
): string {
  return createHash("sha256")
    .update([recipientUserId, subjectType, subjectId].join("\u001f"))
    .digest("hex");
}

function safeAnswers(
  requestedFields: string[],
  answers: Record<string, unknown>,
): Record<string, unknown> | null {
  const permitted = new Set(requestedFields);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (!permitted.has(key)) return null;
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      return null;
    }
    if (typeof value === "string" && value.length > 4_000) return null;
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    result[key] = value;
  }
  return result;
}

router.get(
  "/information-requests",
  requireAuth,
  requirePermission("information.respond"),
  async (_req, res) => {
    const actor = await loadCaptureActor(authContext(res).user.id);
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
      .from(informationRequestsTable)
      .where(
        and(
          eq(informationRequestsTable.centerId, actor.centerId),
          eq(informationRequestsTable.schoolYearId, year.id),
          actor.role === "c2_innovacion"
            ? inArray(informationRequestsTable.status, [
                "solicitada",
                "respondida",
                "validada",
                "cerrada",
              ])
            : eq(informationRequestsTable.recipientUserId, actor.id),
        ),
      )
      .orderBy(desc(informationRequestsTable.createdAt))
      .limit(200);
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await Promise.all(rows.map(requestView)));
  },
);

router.post(
  "/information-requests",
  requireAuth,
  requireCsrf,
  requirePermission("information.manage"),
  async (req, res) => {
    const parsed = CreateInformationRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "La solicitud de información no es válida." });
      return;
    }
    const actor = await loadCaptureActor(authContext(res).user.id);
    if (!actor || actor.role !== "c2_innovacion") {
      res.status(403).json({ error: "Solo C2 puede solicitar información mínima." });
      return;
    }
    const year = await loadActiveSchoolYear(actor.centerId);
    if (!year) {
      res.status(409).json({ error: "El centro no tiene un curso activo." });
      return;
    }
    const [recipient] = await db
      .select({
        id: usersTable.id,
        professionalFamily: usersTable.professionalFamily,
      })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.id, parsed.data.recipientUserId),
          eq(usersTable.centerId, actor.centerId),
          eq(usersTable.active, true),
        ),
      )
      .limit(1);
    if (!recipient) {
      res.status(400).json({ error: "La persona destinataria no está activa en este centro." });
      return;
    }

    let missingFields: string[] = [...parsed.data.requestedFields];
    if (parsed.data.subjectType === "activity") {
      const activity = await currentActivity(
        actor.id,
        actor.centerId,
        year.id,
        parsed.data.subjectId,
      );
      if (!activity) {
        res.status(404).json({ error: "No se encontró la actuación en el ámbito de C2." });
        return;
      }
      if (
        recipient.id !== activity.responsibleUserId &&
        !sameFamily(recipient.professionalFamily, activity.professionalFamily)
      ) {
        res.status(400).json({ error: "La persona destinataria no corresponde a la familia responsable." });
        return;
      }
      missingFields = missingActivityFields(activity, missingFields);
    } else {
      const [project] = await db
        .select({ id: picProjectsTable.id })
        .from(picProjectsTable)
        .innerJoin(picPlansTable, eq(picProjectsTable.planId, picPlansTable.id))
        .where(
          and(
            eq(picProjectsTable.id, parsed.data.subjectId),
            eq(picPlansTable.centerId, actor.centerId),
            eq(picPlansTable.schoolYearId, year.id),
          ),
        )
        .limit(1);
      if (!project) {
        res.status(404).json({ error: "No se encontró el proyecto del curso activo." });
        return;
      }
    }
    if (missingFields.length === 0) {
      res.status(400).json({ error: "No queda ningún campo esencial pendiente de respuesta." });
      return;
    }
    const key = requestKey(
      recipient.id,
      parsed.data.subjectType,
      parsed.data.subjectId,
    );
    const [open] = await db
      .select()
      .from(informationRequestsTable)
      .where(
        and(
          eq(informationRequestsTable.centerId, actor.centerId),
          eq(informationRequestsTable.schoolYearId, year.id),
          eq(informationRequestsTable.requestKey, key),
          eq(informationRequestsTable.status, "solicitada"),
        ),
      )
      .limit(1);
    let saved: typeof informationRequestsTable.$inferSelect | undefined;
    if (open) {
      const mergedFields = [...new Set([...open.requestedFields, ...missingFields])];
      [saved] = await db
        .update(informationRequestsTable)
        .set({
          requestedFields: mergedFields,
          reason: parsed.data.reason.trim(),
          dueAt: parsed.data.dueAt ?? open.dueAt,
          revision: open.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(informationRequestsTable.id, open.id),
            eq(informationRequestsTable.revision, open.revision),
          ),
        )
        .returning();
    } else {
      [saved] = await db
        .insert(informationRequestsTable)
        .values({
          centerId: actor.centerId,
          schoolYearId: year.id,
          recipientUserId: recipient.id,
          subjectType: parsed.data.subjectType,
          subjectId: parsed.data.subjectId,
          requestedFields: missingFields,
          reason: parsed.data.reason.trim(),
          requestKey: key,
          dueAt: parsed.data.dueAt ?? null,
          createdBy: actor.id,
        })
        .returning();
    }
    if (!saved) {
      res.status(409).json({ error: "La solicitud cambió mientras se actualizaba." });
      return;
    }
    await recordCaptureAudit(
      req,
      actor.id,
      open ? "information.request.merged" : "information.request.created",
      "information_request",
      saved.id,
      { requestedFields: saved.requestedFields, recipientUserId: recipient.id },
    );
    res.status(201).json(await requestView(saved));
  },
);

router.post(
  "/information-requests/:requestId/respond",
  requireAuth,
  requireCsrf,
  requirePermission("information.respond"),
  async (req, res) => {
    const parsed = RespondToInformationRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "La respuesta no tiene un formato válido." });
      return;
    }
    const actor = await loadCaptureActor(authContext(res).user.id);
    const [request] = actor
      ? await db
          .select()
          .from(informationRequestsTable)
          .where(
            and(
              eq(informationRequestsTable.id, pathParam(req, "requestId")),
              eq(informationRequestsTable.centerId, actor.centerId),
            ),
          )
          .limit(1)
      : [];
    if (!actor || !request) {
      res.status(404).json({ error: "No se encontró la solicitud." });
      return;
    }
    if (request.recipientUserId !== actor.id) {
      res.status(403).json({ error: "La solicitud no está asignada a esta cuenta." });
      return;
    }
    if (request.status !== "solicitada") {
      res.status(409).json({ error: "La solicitud ya se respondió o cerró." });
      return;
    }
    const answers =
      parsed.data.responseStatus === "respondida"
        ? safeAnswers(request.requestedFields, parsed.data.answers)
        : {};
    if (!answers) {
      res.status(400).json({ error: "Responde solo a los campos solicitados y con valores simples." });
      return;
    }
    if (
      parsed.data.responseStatus === "respondida" &&
      request.requestedFields.some(
        (field) => !(field in answers) || answers[field] === null || answers[field] === "",
      )
    ) {
      res.status(400).json({ error: "Completa los campos solicitados o marca explícitamente «Sin información»." });
      return;
    }
    const committed = await db.transaction(async (tx) => {
      const [updatedRequest] = await tx
        .update(informationRequestsTable)
        .set({
          status: "respondida",
          revision: request.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(informationRequestsTable.id, request.id),
            eq(informationRequestsTable.revision, request.revision),
            eq(informationRequestsTable.status, "solicitada"),
          ),
        )
        .returning({ id: informationRequestsTable.id });
      if (!updatedRequest) return false;
      await tx.insert(informationResponsesTable).values({
        requestId: request.id,
        responderId: actor.id,
        responseStatus: parsed.data.responseStatus,
        answers,
        comment: parsed.data.comment?.trim() ?? "",
      });
      return true;
    });
    if (!committed) {
      res.status(409).json({ error: "La solicitud cambió mientras se guardaba la respuesta." });
      return;
    }
    await recordCaptureAudit(req, actor.id, "information.response.created", "information_request", request.id, {
      responseStatus: parsed.data.responseStatus,
      answeredFields: Object.keys(answers),
    });
    const [updated] = await db
      .select()
      .from(informationRequestsTable)
      .where(eq(informationRequestsTable.id, request.id))
      .limit(1);
    if (!updated) {
      res.status(500).json({ error: "No se pudo recuperar la solicitud respondida." });
      return;
    }
    res.status(201).json(await requestView(updated));
  },
);

router.post(
  "/information-requests/:requestId/validate",
  requireAuth,
  requireCsrf,
  requirePermission("information.manage"),
  async (req, res) => {
    const parsed = ValidateInformationResponseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "La revisión esperada no es válida." });
      return;
    }
    const actor = await loadCaptureActor(authContext(res).user.id);
    const [request] = actor
      ? await db
          .select()
          .from(informationRequestsTable)
          .where(
            and(
              eq(informationRequestsTable.id, pathParam(req, "requestId")),
              eq(informationRequestsTable.centerId, actor.centerId),
              eq(informationRequestsTable.schoolYearId, (await loadActiveSchoolYear(actor.centerId))?.id ?? ""),
            ),
          )
          .limit(1)
      : [];
    if (!actor || actor.role !== "c2_innovacion" || !request) {
      res.status(404).json({ error: "No se encontró la solicitud." });
      return;
    }
    if (request.revision !== parsed.data.expectedRevision || request.status !== "respondida") {
      res.status(409).json({ error: "La solicitud cambió o todavía no tiene respuesta." });
      return;
    }
    const [response] = await db
      .select()
      .from(informationResponsesTable)
      .where(eq(informationResponsesTable.requestId, request.id))
      .orderBy(desc(informationResponsesTable.createdAt))
      .limit(1);
    if (!response) {
      res.status(409).json({ error: "No se encontró una respuesta para validar." });
      return;
    }
    let activity: typeof activitiesTable.$inferSelect | null = null;
    let activityPatch: Partial<typeof activitiesTable.$inferInsert> = {};
    if (request.subjectType === "activity" && response.responseStatus === "respondida") {
      activity = await currentActivity(
        actor.id,
        actor.centerId,
        request.schoolYearId,
        request.subjectId,
      );
      if (!activity) {
        res.status(409).json({ error: "La actuación asociada ya no está disponible." });
        return;
      }
      const answers = response.answers;
      const patch: Partial<typeof activitiesTable.$inferInsert> = {};
      for (const field of request.requestedFields) {
        const value = answers[field];
        if (value === undefined || value === null || value === "") continue;
        if (
          field === "title" &&
          !activity.title.trim() &&
          typeof value === "string" &&
          value.length <= 200
        ) {
          patch.title = value.trim();
        } else if (
          field === "description" &&
          !activity.description.trim() &&
          typeof value === "string" &&
          value.length <= 4000
        ) {
          patch.description = value.trim();
        } else if (
          field === "activityDate" &&
          !activity.activityDate &&
          typeof value === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
        ) {
          patch.activityDate = value;
        } else if (field === "projectId" && !activity.projectId && typeof value === "string") {
          const plan = await loadCurrentPlan(actor.centerId, request.schoolYearId);
          const [project] = plan
            ? await db
                .select({ id: picProjectsTable.id })
                .from(picProjectsTable)
                .where(
                  and(
                    eq(picProjectsTable.id, value),
                    eq(picProjectsTable.planId, plan.id),
                  ),
                )
                .limit(1)
            : [];
          if (project) {
            patch.projectId = project.id;
          }
        }
      }
      activityPatch = patch;
    }

    let updatedRequest: typeof informationRequestsTable.$inferSelect;
    try {
      updatedRequest = await db.transaction(async (tx) => {
        if (activity && Object.keys(activityPatch).length > 0) {
          const [savedActivity] = await tx
            .update(activitiesTable)
            .set({
              ...activityPatch,
              status: "pendiente_c2",
              informationStatus: "en_revision",
              confirmedBy: null,
              confirmedAt: null,
              validatedBy: null,
              validatedAt: null,
              revision: activity.revision + 1,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(activitiesTable.id, activity.id),
                eq(activitiesTable.revision, activity.revision),
              ),
            )
            .returning();
          if (!savedActivity) throw new Error("INFORMATION_ACTIVITY_CONFLICT");
          await tx.insert(activityVersionsTable).values({
            activityId: savedActivity.id,
            revision: savedActivity.revision,
            content: activitySnapshot(savedActivity),
            createdBy: actor.id,
          });
        }
        const [savedRequest] = await tx
          .update(informationRequestsTable)
          .set({
            status: "validada",
            revision: request.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(informationRequestsTable.id, request.id),
              eq(informationRequestsTable.revision, request.revision),
              eq(informationRequestsTable.status, "respondida"),
            ),
          )
          .returning();
        if (!savedRequest) throw new Error("INFORMATION_REQUEST_CONFLICT");
        await tx
        .update(informationResponsesTable)
        .set({ validatedBy: actor.id, validatedAt: new Date() })
        .where(eq(informationResponsesTable.id, response.id));
        return savedRequest;
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "INFORMATION_ACTIVITY_CONFLICT" ||
          error.message === "INFORMATION_REQUEST_CONFLICT")
      ) {
        res.status(409).json({ error: "La actuación o la solicitud cambió antes de validar; recarga e inténtalo de nuevo." });
        return;
      }
      throw error;
    }
    await recordCaptureAudit(req, actor.id, "information.response.validated", "information_request", request.id, {
      responseId: response.id,
      responseStatus: response.responseStatus,
    });
    res.json(await requestView(updatedRequest));
  },
);

export default router;

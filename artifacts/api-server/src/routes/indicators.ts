import { and, desc, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import {
  activityIndicatorLinksTable,
  activitiesTable,
  db,
  documentVersionsTable,
  documentsTable,
  evidencesTable,
  evidenceLinksTable,
  indicatorObservationsTable,
  picIndicatorTargetsTable,
} from "@workspace/db";
import {
  CreateIndicatorObservationBody,
  CreateIndicatorObservationResponse,
  ListCurrentIndicatorsResponse,
  type IndicatorObservation as ApiIndicatorObservation,
  type IndicatorSummary as ApiIndicatorSummary,
} from "@workspace/api-zod";
import {
  indicatorByCode,
  loadActiveSchoolYear,
  loadCaptureActor,
  loadCatalogPayload,
  loadCurrentPlan,
  recordCaptureAudit,
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

async function eligibleEvidence(
  centerId: string,
  schoolYearId: string,
  evidenceIds: string[],
) {
  if (evidenceIds.length === 0) return [];
  const rows = await db
    .select({
      evidenceId: evidencesTable.id,
      planId: evidenceLinksTable.planId,
      indicatorCode: evidenceLinksTable.indicatorCode,
    })
    .from(evidencesTable)
    .innerJoin(
      documentVersionsTable,
      eq(evidencesTable.documentVersionId, documentVersionsTable.id),
    )
    .innerJoin(
      documentsTable,
      eq(documentVersionsTable.documentId, documentsTable.id),
    )
    .leftJoin(
      evidenceLinksTable,
      eq(evidenceLinksTable.evidenceId, evidencesTable.id),
    )
    .where(
      and(
        eq(documentsTable.centerId, centerId),
        eq(documentsTable.schoolYearId, schoolYearId),
        eq(documentsTable.status, "aprobado"),
        eq(documentVersionsTable.scanStatus, "limpio"),
        eq(evidencesTable.status, "validada"),
      ),
    );
  const eligible = new Set(rows.map((row) => row.evidenceId));
  if (evidenceIds.some((id) => !eligible.has(id))) return null;
  return [...new Set(evidenceIds)];
}

async function qualifyingActivityEvidence(
  planId: string,
  centerId: string,
  schoolYearId: string,
  indicatorCode: string,
) {
  const rows = await db
    .select({
      activityId: activitiesTable.id,
      evidenceId: evidencesTable.id,
    })
    .from(activityIndicatorLinksTable)
    .innerJoin(
      activitiesTable,
      eq(activityIndicatorLinksTable.activityId, activitiesTable.id),
    )
    .innerJoin(
      evidenceLinksTable,
      and(
        eq(evidenceLinksTable.activityId, activitiesTable.id),
        eq(evidenceLinksTable.planId, planId),
        eq(evidenceLinksTable.indicatorCode, indicatorCode),
      ),
    )
    .innerJoin(
      evidencesTable,
      eq(evidenceLinksTable.evidenceId, evidencesTable.id),
    )
    .innerJoin(
      documentVersionsTable,
      eq(evidencesTable.documentVersionId, documentVersionsTable.id),
    )
    .innerJoin(
      documentsTable,
      eq(documentVersionsTable.documentId, documentsTable.id),
    )
    .where(
      and(
        eq(activityIndicatorLinksTable.planId, planId),
        eq(activityIndicatorLinksTable.indicatorCode, indicatorCode),
        eq(activitiesTable.centerId, centerId),
        eq(activitiesTable.schoolYearId, schoolYearId),
        eq(activitiesTable.status, "validada"),
        eq(activitiesTable.informationStatus, "confirmada"),
        eq(documentsTable.status, "aprobado"),
        eq(documentVersionsTable.scanStatus, "limpio"),
        eq(evidencesTable.status, "validada"),
      ),
    );
  return {
    activityIds: [...new Set(rows.map((row) => row.activityId))],
    evidenceIds: [...new Set(rows.map((row) => row.evidenceId))],
  };
}

function assessment(
  value: number | boolean,
  target: number | boolean,
  risk: number | boolean,
): ApiIndicatorObservation["assessment"] {
  if (typeof value === "boolean") {
    if (value === target) return "logrado";
    if (value === risk) return "en_progreso";
    return "no_logrado";
  }
  if (typeof target !== "number" || typeof risk !== "number") {
    return "sin_datos";
  }
  if (value >= target) return "logrado";
  if (value >= risk) return "en_progreso";
  return "no_logrado";
}

async function latestObservation(
  planId: string,
  indicatorCode: string,
): Promise<ApiIndicatorObservation | null> {
  const [row] = await db
    .select()
    .from(indicatorObservationsTable)
    .where(
      and(
        eq(indicatorObservationsTable.planId, planId),
        eq(indicatorObservationsTable.indicatorCode, indicatorCode),
      ),
    )
    .orderBy(desc(indicatorObservationsTable.createdAt))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    planId: row.planId,
    indicatorCode: row.indicatorCode,
    period: row.period,
    revision: row.revision,
    value: row.value,
    method: row.method,
    formula: row.formula,
    evidenceIds: row.evidenceIds,
    sourceActivityCount: row.sourceActivityCount,
    assessment: row.assessment as ApiIndicatorObservation["assessment"],
    createdAt: row.createdAt,
  };
}

router.get(
  "/indicators/current",
  requireAuth,
  requirePermission("indicators.read"),
  async (_req, res) => {
    const actor = await loadCaptureActor(authContext(res).user.id);
    if (!actor) {
      res.status(401).json({ error: "La cuenta actual ya no está disponible." });
      return;
    }
    const year = await loadActiveSchoolYear(actor.centerId);
    const plan = year ? await loadCurrentPlan(actor.centerId, year.id) : null;
    if (!year || !plan) {
      res.status(404).json({ error: "No hay un PIC para el curso activo." });
      return;
    }
    const catalog = await loadCatalogPayload(plan.catalogRowId);
    const targets = await db
      .select()
      .from(picIndicatorTargetsTable)
      .where(eq(picIndicatorTargetsTable.planId, plan.id));
    const summaries: ApiIndicatorSummary[] = [];
    for (const target of targets) {
      const official = indicatorByCode(catalog, target.indicatorId);
      if (!official) continue;
      const qualifying =
        official.type === "numero"
          ? await qualifyingActivityEvidence(
              plan.id,
              actor.centerId,
              year.id,
              target.indicatorId,
            )
          : { activityIds: [], evidenceIds: [] };
      const observation = await latestObservation(plan.id, target.indicatorId);
      const liveNumber = qualifying.activityIds.length > 0
        ? qualifying.activityIds.length
        : null;
      summaries.push({
        planId: plan.id,
        actionCode: target.actionCode,
        code: target.indicatorId,
        description: official.description,
        type: official.type as ApiIndicatorSummary["type"],
        methodNote: official.method,
        target: target.targetValue,
        risk: target.riskValue,
        currentValue:
          official.type === "numero"
            ? liveNumber
            : observation?.value ?? null,
        activityCount: qualifying.activityIds.length,
        evidenceCount: qualifying.evidenceIds.length,
        latestObservation: observation,
      });
    }
    const parsed = ListCurrentIndicatorsResponse.safeParse(summaries);
    if (!parsed.success) {
      res.status(500).json({ error: "Los indicadores del PIC no coinciden con el contrato API." });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.json(parsed.data);
  },
);

router.post(
  "/indicators/:indicatorCode/observations",
  requireAuth,
  requireCsrf,
  requirePermission("indicators.write"),
  async (req, res) => {
    const parsed = CreateIndicatorObservationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Los datos de la observación no son válidos." });
      return;
    }
    const actor = await loadCaptureActor(authContext(res).user.id);
    if (!actor || actor.role !== "c2_innovacion") {
      res.status(403).json({ error: "Solo C2 puede confirmar observaciones de indicadores." });
      return;
    }
    const year = await loadActiveSchoolYear(actor.centerId);
    const plan = year ? await loadCurrentPlan(actor.centerId, year.id) : null;
    if (!year || !plan) {
      res.status(404).json({ error: "No hay un PIC para el curso activo." });
      return;
    }
    const indicatorCode = pathParam(req, "indicatorCode");
    const catalog = await loadCatalogPayload(plan.catalogRowId);
    const official = indicatorByCode(catalog, indicatorCode);
    const [target] = await db
      .select()
      .from(picIndicatorTargetsTable)
      .where(
        and(
          eq(picIndicatorTargetsTable.planId, plan.id),
          eq(picIndicatorTargetsTable.indicatorId, indicatorCode),
        ),
      )
      .limit(1);
    if (!official || !target) {
      res.status(404).json({ error: "El indicador no está seleccionado en el PIC activo." });
      return;
    }
    const evidenceIdsInput = parsed.data.evidenceIds ?? [];
    let value: number | boolean;
    let numerator: number | null = null;
    let denominator: number | null = null;
    let evidenceIds: string[];
    let sourceActivityCount = 0;
    let method: string;
    let formula: string;

    if (official.type === "numero") {
      const sources = await qualifyingActivityEvidence(
        plan.id,
        actor.centerId,
        year.id,
        indicatorCode,
      );
      value = sources.activityIds.length;
      evidenceIds = sources.evidenceIds;
      sourceActivityCount = sources.activityIds.length;
      method = "conteo_operativo_actuaciones_validadas_con_evidencia";
      formula = "COUNT(DISTINCT activity_id) WHERE validada AND confirmada AND evidencia aprobada";
    } else if (official.type === "booleano") {
      if (typeof parsed.data.value !== "boolean" || evidenceIdsInput.length === 0) {
        res.status(400).json({ error: "Confirma Sí/No y aporta al menos una evidencia aprobada." });
        return;
      }
      const verified = await eligibleEvidence(
        actor.centerId,
        year.id,
        evidenceIdsInput,
      );
      if (!verified) {
        res.status(409).json({ error: "Una evidencia no existe, no está aprobada o no tiene análisis limpio." });
        return;
      }
      value = parsed.data.value;
      evidenceIds = verified;
      method = "confirmacion_explicita_C2_con_evidencia";
      formula = "valor_booleano_confirmado_por_C2";
    } else if (official.type === "porcentaje") {
      const numeratorInput = parsed.data.numerator;
      const denominatorInput = parsed.data.denominator;
      if (
        typeof numeratorInput !== "number" ||
        typeof denominatorInput !== "number" ||
        denominatorInput <= 0 ||
        numeratorInput > denominatorInput ||
        evidenceIdsInput.length === 0
      ) {
        res.status(400).json({ error: "Indica numerador, denominador positivo, numerador no superior al denominador y evidencia aprobada." });
        return;
      }
      const verified = await eligibleEvidence(
        actor.centerId,
        year.id,
        evidenceIdsInput,
      );
      if (!verified) {
        res.status(409).json({ error: "Una evidencia no existe, no está aprobada o no tiene análisis limpio." });
        return;
      }
      numerator = numeratorInput;
      denominator = denominatorInput;
      value = Math.round((numeratorInput / denominatorInput) * 1_000) / 10;
      evidenceIds = verified;
      method = "porcentaje_con_numerador_denominador_confirmados_por_C2";
      formula = "ROUND(numerator / denominator * 100, 1)";
    } else {
      res.status(400).json({ error: "El tipo de indicador necesita una regla oficial configurada antes de calcularlo." });
      return;
    }

    if (official.type !== "numero") {
      for (const evidenceId of evidenceIds) {
        const [existingLink] = await db
          .select({ id: evidenceLinksTable.id })
          .from(evidenceLinksTable)
          .where(
            and(
              eq(evidenceLinksTable.evidenceId, evidenceId),
              eq(evidenceLinksTable.planId, plan.id),
              eq(evidenceLinksTable.indicatorCode, indicatorCode),
            ),
          )
          .limit(1);
        if (!existingLink) {
          await db.insert(evidenceLinksTable).values({
            evidenceId,
            planId: plan.id,
            indicatorCode,
            linkedBy: actor.id,
            note: `Evidencia de observación ${parsed.data.period}`,
          });
        }
      }
    }

    const previous = await db
      .select({ revision: indicatorObservationsTable.revision })
      .from(indicatorObservationsTable)
      .where(
        and(
          eq(indicatorObservationsTable.planId, plan.id),
          eq(indicatorObservationsTable.indicatorCode, indicatorCode),
          eq(indicatorObservationsTable.period, parsed.data.period),
        ),
      )
      .orderBy(desc(indicatorObservationsTable.revision))
      .limit(1);
    const revision = (previous[0]?.revision ?? 0) + 1;
    const assess =
      official.type === "numero" && sourceActivityCount === 0
        ? "sin_datos"
        : assessment(
            value,
            target.targetValue,
            target.riskValue,
          );
    const [saved] = await db
      .insert(indicatorObservationsTable)
      .values({
        planId: plan.id,
        indicatorCode,
        period: parsed.data.period,
        revision,
        value,
        numerator,
        denominator,
        method,
        formula,
        evidenceIds,
        sourceActivityCount,
        assessment: assess,
        createdBy: actor.id,
        validatedBy: actor.id,
      })
      .returning();
    const response: ApiIndicatorObservation = {
      id: saved.id,
      planId: saved.planId,
      indicatorCode: saved.indicatorCode,
      period: saved.period,
      revision: saved.revision,
      value: saved.value,
      method: saved.method,
      formula: saved.formula,
      evidenceIds: saved.evidenceIds,
      sourceActivityCount: saved.sourceActivityCount,
      assessment: saved.assessment as ApiIndicatorObservation["assessment"],
      createdAt: saved.createdAt,
    };
    const validated = CreateIndicatorObservationResponse.safeParse(response);
    if (!validated.success) {
      res.status(500).json({ error: "La observación no coincide con el contrato API." });
      return;
    }
    await recordCaptureAudit(
      req,
      actor.id,
      "indicator.observation.created",
      "indicator_observation",
      saved.id,
      {
        indicatorCode,
        period: saved.period,
        revision,
        method,
        formula,
        evidenceCount: evidenceIds.length,
        sourceActivityCount,
        assessment: assess,
      },
    );
    res.status(201).json(validated.data);
  },
);

export default router;

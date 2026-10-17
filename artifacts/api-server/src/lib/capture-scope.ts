import { and, eq, isNull } from "drizzle-orm";
import type { Request } from "express";
import {
  auditLogsTable,
  db,
  documentAccessGrantsTable,
  picCatalogsTable,
  picPlansTable,
  schoolYearsTable,
  usersTable,
} from "@workspace/db";
import type { UserRole } from "@workspace/api-zod";
import { getClientIp, keyedHash } from "./auth";

export type CaptureActor = {
  id: string;
  centerId: string;
  role: UserRole;
  professionalFamily: string | null;
};

export type ActiveSchoolYear = {
  id: string;
  label: string;
};

export type CurrentPlan = {
  id: string;
  catalogRowId: string;
  catalogVersion: string;
};

export async function loadCaptureActor(userId: string): Promise<CaptureActor | null> {
  const [row] = await db
    .select({
      id: usersTable.id,
      centerId: usersTable.centerId,
      role: usersTable.role,
      professionalFamily: usersTable.professionalFamily,
    })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.active, true)))
    .limit(1);
  return row ?? null;
}

export async function loadActiveSchoolYear(
  centerId: string,
): Promise<ActiveSchoolYear | null> {
  const [row] = await db
    .select({ id: schoolYearsTable.id, label: schoolYearsTable.label })
    .from(schoolYearsTable)
    .where(
      and(
        eq(schoolYearsTable.centerId, centerId),
        eq(schoolYearsTable.active, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function loadCurrentPlan(
  centerId: string,
  schoolYearId: string,
): Promise<CurrentPlan | null> {
  const [row] = await db
    .select({
      id: picPlansTable.id,
      catalogRowId: picPlansTable.catalogRowId,
      catalogVersion: picPlansTable.catalogVersion,
    })
    .from(picPlansTable)
    .where(
      and(
        eq(picPlansTable.centerId, centerId),
        eq(picPlansTable.schoolYearId, schoolYearId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function loadCatalogPayload(catalogRowId?: string): Promise<unknown | null> {
  const [row] = await db
    .select({ payload: picCatalogsTable.payload })
    .from(picCatalogsTable)
    .where(
      catalogRowId
        ? eq(picCatalogsTable.id, catalogRowId)
        : eq(picCatalogsTable.active, true),
    )
    .limit(1);
  return row?.payload ?? null;
}

export type OfficialIndicator = {
  code: string;
  actionCode: string;
  description: string;
  type: "booleano" | "numero" | "porcentaje" | "escala_1_5" | "revisar_unidad";
  method: string;
  evidenceSource: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function listOfficialIndicators(payload: unknown): OfficialIndicator[] {
  const root = asRecord(payload);
  const objectives = Array.isArray(root?.objetivos) ? root.objetivos : [];
  const result: OfficialIndicator[] = [];
  for (const objective of objectives) {
    const objectiveRecord = asRecord(objective);
    const actions = Array.isArray(objectiveRecord?.acciones)
      ? objectiveRecord.acciones
      : [];
    for (const action of actions) {
      const actionRecord = asRecord(action);
      const actionCode =
        typeof actionRecord?.codigo === "string" ? actionRecord.codigo : "";
      const indicators = Array.isArray(actionRecord?.indicadores)
        ? actionRecord.indicadores
        : [];
      for (const indicator of indicators) {
        const indicatorRecord = asRecord(indicator);
        if (
          !actionCode ||
          typeof indicatorRecord?.id !== "string" ||
          typeof indicatorRecord.descripcion !== "string"
        ) {
          continue;
        }
        const type = indicatorRecord.tipo;
        result.push({
          code: indicatorRecord.id,
          actionCode,
          description: indicatorRecord.descripcion,
          type:
            type === "booleano" ||
            type === "numero" ||
            type === "porcentaje" ||
            type === "escala_1_5" ||
            type === "revisar_unidad"
              ? type
              : "revisar_unidad",
          method:
            typeof indicatorRecord.metodo_calculo === "string"
              ? indicatorRecord.metodo_calculo
              : "CONFIGURAR_Y_VALIDAR_CON_C2",
          evidenceSource:
            typeof indicatorRecord.fuente_evidencia === "string"
              ? indicatorRecord.fuente_evidencia
              : "",
        });
      }
    }
  }
  return result;
}

export function indicatorByCode(
  payload: unknown,
  code: string,
): OfficialIndicator | null {
  return listOfficialIndicators(payload).find((item) => item.code === code) ?? null;
}

export function sameFamily(
  actorFamily: string | null,
  recordFamily: string | null,
): boolean {
  return Boolean(
    actorFamily &&
      recordFamily &&
      actorFamily.trim().toLocaleLowerCase("es") ===
        recordFamily.trim().toLocaleLowerCase("es"),
  );
}

export function canReadActivity(
  actor: CaptureActor,
  activity: {
    professionalFamily: string;
    responsibleUserId: string;
    createdBy: string | null;
  },
): boolean {
  if (actor.role === "c2_innovacion") return true;
  if (
    (actor.role === "jefatura_departamento" ||
      actor.role === "coordinacion_red") &&
    sameFamily(actor.professionalFamily, activity.professionalFamily)
  ) {
    return true;
  }
  return activity.createdBy === actor.id || activity.responsibleUserId === actor.id;
}

export function canWriteActivity(
  actor: CaptureActor,
  activity: {
    professionalFamily: string;
    responsibleUserId: string;
    createdBy: string | null;
  },
): boolean {
  return canReadActivity(actor, activity);
}

export async function canReadDocument(
  actor: CaptureActor,
  document: {
    professionalFamily: string | null;
    accessScope: string;
    createdBy: string | null;
    id: string;
  },
): Promise<boolean> {
  if (actor.role === "c2_innovacion" || document.createdBy === actor.id) {
    return true;
  }
  if (document.accessScope === "center") return true;
  if (
    document.accessScope === "family" &&
    sameFamily(actor.professionalFamily, document.professionalFamily)
  ) {
    return true;
  }
  if (document.accessScope !== "restricted") return false;
  const [grant] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .innerJoin(
      documentAccessGrantsTable,
      eq(documentAccessGrantsTable.userId, usersTable.id),
    )
    .where(
      and(
        eq(usersTable.id, actor.id),
        eq(documentAccessGrantsTable.documentId, document.id),
        isNull(documentAccessGrantsTable.revokedAt),
      ),
    )
    .limit(1);
  return Boolean(grant);
}

export async function recordCaptureAudit(
  req: Request,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(auditLogsTable).values({
    userId: actorId,
    action,
    entityType,
    entityId,
    details,
    ipHash: keyedHash(getClientIp(req)),
  });
}

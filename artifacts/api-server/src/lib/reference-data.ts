import { createHash } from "node:crypto";
import initialCatalog from "../../../../config/pic_2026_2027_catalogo.json";
import { and, eq } from "drizzle-orm";
import {
  db,
  picCatalogsTable,
  rolePermissionsTable,
  userRoleEnum,
} from "@workspace/db";
import type { UserRole } from "@workspace/api-zod";
import { logger } from "./logger";

const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  admin_tecnico: [
    "dashboard.read",
    "pic.catalog.read",
    "pic.catalog.import",
    "users.read",
    "users.create",
    "audit.read",
    "backups.manage",
    "settings.manage",
  ],
  c2_innovacion: [
    "dashboard.read",
    "pic.catalog.read",
    "pic.plan.read",
    "pic.plan.write",
    "pic.plan.submit",
    "activities.read",
    "activities.write",
    "activities.confirm",
    "activities.validate",
    "documents.read",
    "documents.write",
    "documents.approve",
    "documents.share",
    "information.manage",
    "information.respond",
    "indicators.read",
    "indicators.write",
    "meetings.read",
    "meetings.write",
  ],
  equipo_directivo: [
    "dashboard.read",
    "pic.catalog.read",
    "pic.plan.read",
    "institutional.approve",
  ],
  coordinacion_red: [
    "dashboard.read",
    "pic.catalog.read",
    "activities.read",
    "activities.write",
    "activities.confirm",
    "meetings.read",
    "information.respond",
  ],
  jefatura_departamento: [
    "dashboard.read",
    "pic.catalog.read",
    "activities.read",
    "activities.write",
    "activities.confirm",
    "documents.read",
    "documents.write",
    "information.respond",
  ],
  profesorado: [
    "dashboard.read",
    "pic.catalog.read",
    "activities.write",
    "activities.read",
    "activities.confirm",
    "documents.write",
    "documents.read",
    "information.respond",
  ],
  consulta_c1: ["dashboard.read", "pic.catalog.read", "pic.summary.read"],
  consulta_auditora: [
    "dashboard.read",
    "pic.catalog.read",
    "pic.summary.read",
    "audit.read",
  ],
};

// Keep existing installations and future role permissions in sync on startup.
ROLE_PERMISSIONS.admin_tecnico = [...new Set(Object.values(ROLE_PERMISSIONS).flat())];

export function catalogDigest(catalog: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(catalog)))
    .digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function validateCatalog(catalog: unknown): {
  valid: boolean;
  errors: string[];
  objectiveCount: number;
  actionCount: number;
  indicatorCount: number;
} {
  const errors: string[] = [];
  if (!catalog || typeof catalog !== "object") {
    return {
      valid: false,
      errors: ["El catálogo debe ser un objeto JSON."],
      objectiveCount: 0,
      actionCount: 0,
      indicatorCount: 0,
    };
  }
  const value = catalog as Record<string, unknown>;
  const isRecord = (item: unknown): item is Record<string, unknown> =>
    Boolean(item && typeof item === "object");
  const objectives = Array.isArray(value.objetivos) ? value.objetivos : [];
  const actions = objectives.flatMap((objective) =>
    objective &&
    typeof objective === "object" &&
    Array.isArray((objective as Record<string, unknown>).acciones)
      ? ((objective as Record<string, unknown>).acciones as unknown[])
      : [],
  );
  const indicators = actions.flatMap((action) =>
    action && typeof action === "object" &&
    Array.isArray((action as Record<string, unknown>).indicadores)
      ? ((action as Record<string, unknown>).indicadores as unknown[])
      : [],
  );
  if (value.id !== "PIC_2026_2027_INNOVACION_C2") {
    errors.push("El identificador de catálogo no es el oficial esperado.");
  }
  if (objectives.length !== 6) errors.push("El catálogo debe tener 6 objetivos.");
  if (actions.length !== 24) errors.push("El catálogo debe tener 24 acciones.");
  if (indicators.length !== 31) {
    errors.push("El catálogo debe tener 31 indicadores.");
  }
  const actionCodes = actions
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => item.codigo);
  if (new Set(actionCodes).size !== actionCodes.length) {
    errors.push("Hay códigos de acción duplicados.");
  }
  const indicatorIds = indicators
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => item.id);
  if (new Set(indicatorIds).size !== indicatorIds.length) {
    errors.push("Hay identificadores de indicador duplicados.");
  }
  const mandatoryCodes = new Set(
    actions
      .filter(isRecord)
      .filter((item) => item.obligatoria === true)
      .map((item) => item.codigo),
  );
  if (!mandatoryCodes.has("1.1") || !mandatoryCodes.has("1.2")) {
    errors.push("Las acciones obligatorias 1.1 y 1.2 deben estar marcadas.");
  }
  if (!Array.isArray(value.familias_profesionales) || !Array.isArray(value.ods_2030) ||
      !Array.isArray(value.ods_canarios) || !Array.isArray(value.cargos_ciclope) ||
      !value.dafo_categorias || typeof value.dafo_categorias !== "object") {
    errors.push("Faltan los anexos oficiales de familias, ODS, cargos CICLOPE o DAFO.");
  }
  return {
    valid: errors.length === 0,
    errors,
    objectiveCount: objectives.length,
    actionCount: actions.length,
    indicatorCount: indicators.length,
  };
}

export async function ensureReferenceData(): Promise<void> {
  const roleValues = new Set(userRoleEnum.enumValues);
  const permissionRows = Object.entries(ROLE_PERMISSIONS).flatMap(
    ([role, permissions]) => {
      if (!roleValues.has(role as UserRole)) {
        throw new Error(`Unknown role in permission map: ${role}`);
      }
      return permissions.map((permission) => ({
        role: role as UserRole,
        permission,
      }));
    },
  );
  await db
    .insert(rolePermissionsTable)
    .values(permissionRows)
    .onConflictDoNothing();

  const parsedCatalog = JSON.parse(
    JSON.stringify(initialCatalog),
  ) as Record<string, unknown>;
  const validation = validateCatalog(parsedCatalog);
  if (!validation.valid) {
    throw new Error(`Bundled PIC catalogue is invalid: ${validation.errors.join("; ")}`);
  }
  const catalogId = String(parsedCatalog.id);
  const version = String(parsedCatalog.version);
  const sourceHash = catalogDigest(parsedCatalog);
  const [stored] = await db
    .select({
      sourceHash: picCatalogsTable.sourceHash,
      active: picCatalogsTable.active,
    })
    .from(picCatalogsTable)
    .where(
      and(
        eq(picCatalogsTable.catalogId, catalogId),
        eq(picCatalogsTable.version, version),
      ),
    )
    .limit(1);
  if (!stored) {
    await db.insert(picCatalogsTable).values({
      catalogId,
      version,
      state: String(parsedCatalog.estado),
      sourceHash,
      payload: parsedCatalog,
      active: true,
    });
    logger.info({ catalogId, version }, "Imported the initial PIC catalogue");
  } else if (stored.sourceHash !== sourceHash) {
    logger.warn(
      { catalogId, version },
      "Bundled catalogue differs from the stored version; keeping the stored catalogue unchanged",
    );
  }
}

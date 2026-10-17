import { sql, eq } from "drizzle-orm";
import { db, schoolYearsTable } from "@workspace/db";
import type { SchoolYearValidation } from "@workspace/api-zod";

export type CycleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const courseTables = [
  "pic_plans", "pic_dafo", "pic_projects", "pic_action_selections", "pic_indicator_targets",
  "pic_custom_actions", "pic_ods_links", "pic_ciclope_members", "pic_calendar_meetings",
  "pic_snapshots", "pic_submission_records", "activities", "activity_versions",
  "activity_sources", "activity_people", "activity_indicator_links", "documents",
  "document_versions", "document_access_grants", "evidences", "evidence_links",
  "information_requests", "information_responses", "indicator_observations", "school_year_assignments",
] as const;

export class CycleConflict extends Error {}

export function publicYear(year: typeof schoolYearsTable.$inferSelect) {
  return {
    id: year.id, label: year.label, active: year.active, revision: year.revision,
    closedAt: year.closedAt?.toISOString() ?? null, closeReason: year.closeReason,
  };
}

export async function collectCourse(tx: CycleTx, yearId: string) {
  const sources: { source: string; id: string; data: Record<string, unknown> }[] = [];
  for (const table of courseTables) {
    // Table names are exclusively the static allowlist above; never user input.
    const rows = await tx.execute<{ data: Record<string, unknown> }>(sql`
      SELECT to_jsonb(r) AS data FROM ${sql.identifier(table)} r
      WHERE course_row_year(${table},to_jsonb(r))=${yearId}::uuid
      ORDER BY to_jsonb(r)::text`);
    for (const { data } of rows.rows) {
      sources.push({ source: table, id: String(data.id ?? `${data.school_year_id}:${data.user_id}`), data });
    }
  }
  // Freeze the exact referenced catalog, rather than the later active catalog.
  const catalogs = await tx.execute<{ data: Record<string, unknown> }>(sql`
    SELECT to_jsonb(c) AS data FROM pic_catalogs c WHERE c.row_id IN
      (SELECT catalog_row_id FROM pic_plans WHERE school_year_id=${yearId}::uuid) ORDER BY c.row_id`);
  for (const { data } of catalogs.rows) sources.push({ source: "pic_catalogs", id: String(data.row_id), data });
  // Account identities and effective permissions are historical context, never password/session fields.
  const accounts = await tx.execute<{ data: Record<string, unknown> }>(sql`
    SELECT jsonb_build_object('id',u.id,'name',u.name,'role',coalesce(a.role,u.role),
      'professional_family',CASE WHEN a.user_id IS NULL THEN u.professional_family ELSE a.professional_family END,
      'active',u.active,'assigned',a.user_id IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM school_year_assignments WHERE school_year_id=${yearId}::uuid
      )) AS data
    FROM users u LEFT JOIN school_year_assignments a ON a.user_id=u.id AND a.school_year_id=${yearId}::uuid
    WHERE u.center_id=(SELECT center_id FROM school_years WHERE id=${yearId}::uuid) ORDER BY u.id`);
  for (const { data } of accounts.rows) sources.push({ source: "course_accounts", id: String(data.id), data });
  const permissions = await tx.execute<{ data: Record<string, unknown> }>(sql`
    SELECT to_jsonb(p) AS data FROM role_permissions p ORDER BY role,permission`);
  for (const { data } of permissions.rows) sources.push({
    source: "role_permissions", id: `${data.role}:${data.permission}`, data,
  });
  return sources;
}

export async function validateClosure(tx: CycleTx, yearId: string): Promise<SchoolYearValidation> {
  const [year] = await tx.select().from(schoolYearsTable).where(eq(schoolYearsTable.id, yearId));
  if (!year) throw new CycleConflict("No se encontró el curso.");
  const result = await tx.execute<{
    pending_activities: string; pending_requests: string; pending_documents: string; plans: string; draft_plans: string;
  }>(sql`SELECT
    (SELECT count(*) FROM activities WHERE school_year_id=${yearId}::uuid AND status NOT IN ('validada','descartada')) AS pending_activities,
    (SELECT count(*) FROM information_requests WHERE school_year_id=${yearId}::uuid AND status IN ('solicitada','respondida')) AS pending_requests,
    (SELECT count(*) FROM documents WHERE school_year_id=${yearId}::uuid AND status='pendiente_revision') AS pending_documents,
    (SELECT count(*) FROM pic_plans WHERE school_year_id=${yearId}::uuid) AS plans,
    (SELECT count(*) FROM pic_plans WHERE school_year_id=${yearId}::uuid AND status='draft') AS draft_plans`);
  const counts = result.rows[0]!;
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!year.active || year.closedAt) blockers.push("El curso ya está cerrado o no está activo.");
  if (Number(counts.pending_activities)) blockers.push(`${counts.pending_activities} actuaciones pendientes de validar o descartar.`);
  if (Number(counts.pending_requests)) blockers.push(`${counts.pending_requests} solicitudes de información pendientes de resolver.`);
  if (Number(counts.pending_documents)) blockers.push(`${counts.pending_documents} documentos pendientes de revisión.`);
  if (!Number(counts.plans)) warnings.push("No existe PIC: se conservará un expediente sin plan.");
  if (Number(counts.draft_plans)) warnings.push("El PIC sigue en borrador. El cierre no acredita su aprobación ni su entrega.");
  warnings.push("El cierre es irreversible. No se copiarán logros, indicadores ni documentos al curso siguiente.");
  return { canClose: !blockers.length, revision: year.revision, blockers, warnings };
}

import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Router, type RequestHandler } from "express";
import {
  auditLogsTable, db, schoolYearAssignmentsTable, schoolYearSnapshotsTable,
  schoolYearsTable, usersTable,
} from "@workspace/db";
import { OpenSchoolYearBody, CloseSchoolYearBody, ExportSchoolYearResponse } from "@workspace/api-zod";
import { getClientIp, keyedHash, requireAuth, requireCsrf, type AuthContext } from "../lib/auth";
import { collectCourse, CycleConflict, publicYear, validateClosure } from "../lib/school-cycle";
import { loadResourceActor } from "../lib/capture-scope";
import initialCatalog from "../../../../config/pic_2026_2027_catalogo.json";
import { buildSchoolYearExport, publicArchiveValue } from "../lib/school-year-export";

const router = Router();
const manageCycle: RequestHandler = async (_req, res, next) => {
  const role = (res.locals.auth as AuthContext).user.role;
  if (role !== "admin_tecnico" && role !== "c2_innovacion") {
    res.status(403).json({ error: "Solo administración técnica y C2 pueden gestionar o consultar expedientes de cursos." });
    return;
  }
  if (role === "c2_innovacion") {
    const [actor] = await db.select().from(usersTable)
      .where(eq(usersTable.id, (res.locals.auth as AuthContext).user.id));
    const [latest] = await db.select().from(schoolYearsTable)
      .where(eq(schoolYearsTable.centerId, actor!.centerId)).orderBy(desc(schoolYearsTable.label)).limit(1);
    const assignments = latest ? await db.select().from(schoolYearAssignmentsTable)
      .where(eq(schoolYearAssignmentsTable.schoolYearId, latest.id)) : [];
    if (assignments.length && !assignments.some(a => a.userId === actor!.id && a.role === "c2_innovacion")) {
      res.status(403).json({ error: "Esta cuenta C2 no tiene una asignación revisada en el último curso del centro." });
      return;
    }
  }
  res.setHeader("Cache-Control", "private, no-store");
  next();
};
router.use("/school-years", requireAuth, manageCycle);

router.get("/school-years", async (_req, res) => {
  const actorId = (res.locals.auth as AuthContext).user.id;
  const [actor] = await db.select().from(usersTable).where(eq(usersTable.id, actorId));
  const years = await db.select().from(schoolYearsTable)
    .where(eq(schoolYearsTable.centerId, actor!.centerId)).orderBy(desc(schoolYearsTable.label));
  res.json(years.map(publicYear));
});

router.get("/school-years/review", async (_req, res) => {
  const actorId = (res.locals.auth as AuthContext).user.id;
  const [actor] = await db.select().from(usersTable).where(eq(usersTable.id, actorId));
  const [year] = await db.select().from(schoolYearsTable).where(eq(schoolYearsTable.centerId, actor!.centerId))
    .orderBy(desc(schoolYearsTable.label)).limit(1);
  const assignments = year ? await db.select().from(schoolYearAssignmentsTable)
    .where(eq(schoolYearAssignmentsTable.schoolYearId, year.id)) : [];
  const users = await db.select().from(usersTable)
    .where(and(eq(usersTable.centerId, actor!.centerId), eq(usersTable.active, true)));
  res.json(users.map(user => ({
    userId: user.id, name: user.name, role: user.role, professionalFamily: user.professionalFamily,
    assigned: assignments.some(a => a.userId === user.id),
  })));
});

const withYear: RequestHandler = async (req, res, next) => {
  const yearId = String(req.params.yearId ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(yearId)) {
    res.status(400).json({ error: "Identificador de curso no válido." }); return;
  }
  const [actor] = await db.select().from(usersTable).where(eq(usersTable.id, (res.locals.auth as AuthContext).user.id));
  const [year] = await db.select().from(schoolYearsTable)
    .where(and(eq(schoolYearsTable.id, yearId), eq(schoolYearsTable.centerId, actor!.centerId)));
  if (!year) { res.status(404).json({ error: "No se encontró el curso en este centro." }); return; }
  res.locals.schoolYear = year;
  next();
};

router.get("/school-years/:yearId/validation", withYear, async (_req, res) => {
  const year = res.locals.schoolYear as typeof schoolYearsTable.$inferSelect;
  const validation = await db.transaction(async tx => {
    await tx.select().from(schoolYearsTable).where(eq(schoolYearsTable.id, year.id)).for("share");
    return validateClosure(tx, year.id);
  });
  res.json(validation);
});

router.post("/school-years/:yearId/close", requireCsrf, withYear, async (req, res) => {
  const parsed = CloseSchoolYearBody.safeParse(req.body);
  if (!parsed.success || parsed.data.reason.trim().length < 10) {
    res.status(400).json({ error: "Indica la revisión, el curso y un motivo de al menos 10 caracteres." }); return;
  }
  const context = res.locals.auth as AuthContext;
  const prior = res.locals.schoolYear as typeof schoolYearsTable.$inferSelect;
  try {
    const closed = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${prior.centerId},0))`);
      const [year] = await tx.select().from(schoolYearsTable).where(eq(schoolYearsTable.id, prior.id)).for("update");
      if (!year || year.closedAt || !year.active || year.revision !== parsed.data.expectedRevision)
        throw new CycleConflict("El curso cambió o ya se cerró. Repite la validación.");
      if (parsed.data.confirmation !== year.label) throw new CycleConflict("Escribe exactamente el nombre del curso para confirmar.");
      const validation = await validateClosure(tx, year.id);
      if (!validation.canClose) throw new CycleConflict(validation.blockers.join(" "));
      const sources = await collectCourse(tx, year.id);
      const content = { schemaVersion: 1, schoolYearId: year.id, label: year.label, validation, sources };
      const sourceHash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
      await tx.insert(schoolYearSnapshotsTable).values({ schoolYearId: year.id, content, sourceHash, createdBy: context.user.id });
      const [saved] = await tx.update(schoolYearsTable).set({
        active: false, closedAt: new Date(), closedBy: context.user.id,
        closeReason: parsed.data.reason.trim(), revision: year.revision + 1,
      }).where(eq(schoolYearsTable.id, year.id)).returning();
      await tx.insert(auditLogsTable).values({
        userId: context.user.id, action: "school_year.closed", entityType: "school_year", entityId: year.id,
        ipHash: keyedHash(getClientIp(req)), details: { label: year.label, sourceHash, reason: parsed.data.reason.trim() },
      });
      return saved!;
    });
    res.json(publicYear(closed));
  } catch (error) {
    if (error instanceof CycleConflict) { res.status(409).json({ error: error.message }); return; }
    throw error;
  }
});

router.post("/school-years", requireCsrf, async (req, res) => {
  const parsed = OpenSchoolYearBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.permissionsReviewed) {
    res.status(400).json({ error: "Revisa expresamente responsables, familias y permisos antes de abrir el curso." }); return;
  }
  const input = parsed.data;
  const [start, end] = input.label.split("-").map(Number);
  if (end !== start! + 1 || new Set(input.assignments.map(a => a.userId)).size !== input.assignments.length ||
      input.assignments.some(a => a.professionalFamily && !initialCatalog.familias_profesionales.includes(a.professionalFamily)) ||
      input.assignments.some(a => ["profesorado", "jefatura_departamento", "coordinacion_red"].includes(a.role) && !a.professionalFamily)) {
    res.status(400).json({ error: "El curso debe tener años consecutivos y asignaciones sin duplicados." }); return;
  }
  const context = res.locals.auth as AuthContext;
  try {
    const opened = await db.transaction(async tx => {
      const [actor] = await tx.select().from(usersTable).where(eq(usersTable.id, context.user.id));
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor!.centerId},0))`);
      const years = await tx.select().from(schoolYearsTable).where(eq(schoolYearsTable.centerId, actor!.centerId))
        .orderBy(desc(schoolYearsTable.label)).for("update");
      const prior = years[0];
      if (!prior || prior.id !== input.previousYearId || prior.revision !== input.expectedRevision ||
          !prior.closedAt || years.some(y => y.active) || start !== Number(prior.label.split("-")[1]))
        throw new CycleConflict("Debe cerrarse el último curso antes de abrir uno posterior. Actualiza la lista.");
      const accounts = await tx.select().from(usersTable).where(and(
        eq(usersTable.centerId, actor!.centerId), eq(usersTable.active, true),
        inArray(usersTable.id, input.assignments.map(a => a.userId)),
      )).for("share");
      if (accounts.length !== input.assignments.length ||
          !input.assignments.some(a => a.role === "c2_innovacion") ||
          input.assignments.some(a => accounts.find(u => u.id === a.userId)?.role !== a.role))
        throw new CycleConflict("Las asignaciones deben corresponder a cuentas activas y sus roles vigentes, con al menos un responsable C2.");
      const [year] = await tx.insert(schoolYearsTable).values({ centerId: actor!.centerId, label: input.label }).returning();
      await tx.insert(schoolYearAssignmentsTable).values(input.assignments.map(a => ({
        schoolYearId: year!.id, userId: a.userId, role: a.role,
        professionalFamily: a.professionalFamily?.trim() || null, reviewedBy: context.user.id,
      })));
      await tx.insert(auditLogsTable).values({
        userId: context.user.id, action: "school_year.opened", entityType: "school_year", entityId: year!.id,
        ipHash: keyedHash(getClientIp(req)), details: { label: input.label, previousYearId: prior.id, assignments: input.assignments, permissionsReviewed: true },
      });
      const [saved] = await tx.select().from(schoolYearsTable).where(eq(schoolYearsTable.id, year!.id));
      return saved!;
    });
    res.status(201).json(publicYear(opened));
  } catch (error) {
    if (error instanceof CycleConflict) { res.status(409).json({ error: error.message }); return; }
    throw error;
  }
});

const withHistoricalYear: RequestHandler = async (_req, res, next) => {
  const year = res.locals.schoolYear as typeof schoolYearsTable.$inferSelect;
  const [snapshot] = await db.select().from(schoolYearSnapshotsTable).where(eq(schoolYearSnapshotsTable.schoolYearId, year.id));
  if (!year.closedAt || !snapshot) { res.status(409).json({ error: "El expediente solo está disponible después del cierre." }); return; }
  const [account] = await db.select().from(usersTable)
    .where(eq(usersTable.id, (res.locals.auth as AuthContext).user.id));
  const historicalActor = account ? await loadResourceActor(account, year.id, "documents.read") : null;
  if (!historicalActor || (historicalActor.role !== "admin_tecnico" && historicalActor.role !== "c2_innovacion")) {
    res.status(403).json({ error: "La cuenta no tenía acceso C2 autorizado en este curso histórico." }); return;
  }
  res.locals.schoolYearSnapshot = snapshot;
  next();
};

router.get("/school-years/:yearId/history", withYear, withHistoricalYear, async (req, res) => {
  const year = res.locals.schoolYear as typeof schoolYearsTable.$inferSelect;
  const snapshot = res.locals.schoolYearSnapshot as typeof schoolYearSnapshotsTable.$inferSelect;
  await db.insert(auditLogsTable).values({
    userId: (res.locals.auth as AuthContext).user.id, action: "school_year.history.read",
    entityType: "school_year", entityId: year.id, details: { label: year.label, sourceHash: snapshot.sourceHash },
    ipHash: keyedHash(getClientIp(req)),
  });
  const sources = snapshot.content.sources as { source: string; id: string; data: Record<string, unknown> }[];
  res.json({
    schoolYearId: year.id, label: year.label, closedAt: year.closedAt!.toISOString(), sourceHash: snapshot.sourceHash,
    // Storage locations never leave the server; historical consultation does not grant a download.
    sources: publicArchiveValue(sources),
  });
});

router.get("/school-years/:yearId/export", withYear, withHistoricalYear, async (req, res): Promise<void> => {
  const year = res.locals.schoolYear as typeof schoolYearsTable.$inferSelect;
  const snapshot = res.locals.schoolYearSnapshot as typeof schoolYearSnapshotsTable.$inferSelect;
  try {
    const exported = ExportSchoolYearResponse.parse(buildSchoolYearExport(year, snapshot));
    await db.insert(auditLogsTable).values({
      userId: (res.locals.auth as AuthContext).user.id, action: "school_year.export",
      entityType: "school_year", entityId: year.id, ipHash: keyedHash(getClientIp(req)),
      details: { label: year.label, sourceHash: snapshot.sourceHash, contentSha256: exported.manifest.contentSha256 },
    });
    res.setHeader("Content-Disposition", `attachment; filename="expediente-${year.label}-${year.id}.json"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.json(exported);
  } catch (error) {
    if (error instanceof CycleConflict) { res.status(409).json({ error: error.message }); return; }
    throw error;
  }
});

export default router;

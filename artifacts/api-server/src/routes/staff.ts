import { and, asc, eq } from "drizzle-orm";
import { Router, type Response } from "express";
import { db, usersTable, schoolYearAssignmentsTable } from "@workspace/db";
import { requireAuth, requirePermission, type AuthContext } from "../lib/auth";
import { loadActiveSchoolYear, loadCaptureActor } from "../lib/capture-scope";

const router = Router();

router.get(
  "/staff/options",
  requireAuth,
  requirePermission("information.manage"),
  async (_req, res: Response) => {
    const auth = res.locals.auth as AuthContext;
    const actor = await loadCaptureActor(auth.user.id);
    if (!actor) {
      res.status(401).json({ error: "La cuenta actual ya no está disponible." });
      return;
    }
    const rows = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        role: usersTable.role,
        professionalFamily: usersTable.professionalFamily,
      })
      .from(usersTable)
      .where(and(eq(usersTable.centerId, actor.centerId), eq(usersTable.active, true)))
      .orderBy(asc(usersTable.name));
    const year = await loadActiveSchoolYear(actor.centerId);
    const assignments = year ? await db.select().from(schoolYearAssignmentsTable)
      .where(eq(schoolYearAssignmentsTable.schoolYearId, year.id)) : [];
    res.setHeader("Cache-Control", "private, no-store");
    res.json(assignments.length ? rows.flatMap(row => {
      const assignment = assignments.find(a => a.userId === row.id);
      return assignment ? [{ ...row, professionalFamily: assignment.professionalFamily }] : [];
    }) : rows);
  },
);

export default router;

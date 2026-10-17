import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import {
  centersTable,
  db,
  picCatalogsTable,
  schoolYearsTable,
  usersTable,
} from "@workspace/db";
import { GetCurrentCatalogResponse } from "@workspace/api-zod";
import {
  requireAuth,
  requirePermission,
} from "../lib/auth";
import { validateCatalog } from "../lib/reference-data";

const router = Router();

router.get(
  "/dashboard/summary",
  requireAuth,
  requirePermission("dashboard.read"),
  async (_req, res) => {
    const [institution] = await db
      .select({
        centerId: centersTable.id,
        centerName: centersTable.name,
        schoolYear: schoolYearsTable.label,
      })
      .from(centersTable)
      .leftJoin(schoolYearsTable, eq(schoolYearsTable.centerId, centersTable.id))
      .where(eq(schoolYearsTable.active, true))
      .limit(1);
    if (!institution) {
      res.status(404).json({ error: "No hay un centro o curso escolar activo." });
      return;
    }
    const [users] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(usersTable)
      .where(eq(usersTable.centerId, institution.centerId));
    const [storedCatalog] = await db
      .select({ payload: picCatalogsTable.payload })
      .from(picCatalogsTable)
      .where(eq(picCatalogsTable.active, true))
      .limit(1);
    if (!storedCatalog) {
      res.status(503).json({ error: "No hay un catálogo PIC activo importado." });
      return;
    }
    const parsedCatalog = GetCurrentCatalogResponse.safeParse(storedCatalog.payload);
    const counts = validateCatalog(storedCatalog.payload);
    if (!parsedCatalog.success || !counts.valid) {
      res.status(503).json({ error: "El catálogo activo no supera la validación." });
      return;
    }
    res.json({
      centerName: institution.centerName,
      schoolYear: institution.schoolYear,
      userCount: Number(users?.value ?? 0),
      objectiveCount: counts.objectiveCount,
      actionCount: counts.actionCount,
      indicatorCount: counts.indicatorCount,
      catalogVersion: parsedCatalog.data.version,
    });
  },
);

export default router;

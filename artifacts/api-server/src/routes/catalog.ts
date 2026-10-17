import { Router } from "express";
import { and, eq } from "drizzle-orm";
import {
  auditLogsTable,
  db,
  picCatalogsTable,
} from "@workspace/db";
import {
  GetCurrentCatalogResponse,
  ImportCatalogBody,
} from "@workspace/api-zod";
import {
  getClientIp,
  keyedHash,
  requireAuth,
  requireCsrf,
  requirePermission,
  type AuthContext,
} from "../lib/auth";
import { catalogDigest, validateCatalog } from "../lib/reference-data";

const router = Router();

router.get(
  "/catalogs/current",
  requireAuth,
  requirePermission("pic.catalog.read"),
  async (_req, res) => {
    const [catalog] = await db
      .select({ payload: picCatalogsTable.payload })
      .from(picCatalogsTable)
      .where(eq(picCatalogsTable.active, true))
      .limit(1);
    if (!catalog) {
      res.status(404).json({ error: "No hay un catálogo PIC vigente." });
      return;
    }
    const parsed = GetCurrentCatalogResponse.safeParse(catalog.payload);
    if (!parsed.success) {
      res.status(503).json({ error: "El catálogo vigente no supera la validación." });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.json(parsed.data);
  },
);

router.post(
  "/admin/catalogs/import",
  requireAuth,
  requireCsrf,
  requirePermission("pic.catalog.import"),
  async (req, res) => {
    const parsedBody = ImportCatalogBody.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: "El contenido JSON no es un catálogo PIC válido." });
      return;
    }
    const parsedCatalog = GetCurrentCatalogResponse.safeParse(
      parsedBody.data.catalog,
    );
    const validation = validateCatalog(parsedBody.data.catalog);
    if (!parsedCatalog.success || !validation.valid) {
      res.status(400).json({
        error: "El catálogo no cumple los requisitos PIC oficiales.",
        details: validation.errors,
      });
      return;
    }
    const catalog = parsedCatalog.data;
    const sourceHash = catalogDigest(catalog);
    const [existing] = await db
      .select({
        sourceHash: picCatalogsTable.sourceHash,
        active: picCatalogsTable.active,
      })
      .from(picCatalogsTable)
      .where(
        and(
          eq(picCatalogsTable.catalogId, catalog.id),
          eq(picCatalogsTable.version, catalog.version),
        ),
      )
      .limit(1);
    if (existing && existing.sourceHash !== sourceHash) {
      res.status(409).json({
        error: "Esta versión ya existe con un contenido distinto. Publica una versión nueva.",
      });
      return;
    }

    const context = res.locals.auth as AuthContext;
    const active = existing?.active ?? true;
    await db.transaction(async (tx) => {
      if (!existing) {
        await tx
          .update(picCatalogsTable)
          .set({ active: false })
          .where(eq(picCatalogsTable.active, true));
        await tx.insert(picCatalogsTable).values({
          catalogId: catalog.id,
          version: catalog.version,
          state: catalog.estado,
          sourceHash,
          payload: catalog,
          active: true,
        });
      }
      await tx.insert(auditLogsTable).values({
        userId: context.user.id,
        action: "pic.catalog.imported",
        entityType: "pic_catalog",
        entityId: `${catalog.id}:${catalog.version}`,
        details: {
          sourceHash,
          active,
          objectiveCount: validation.objectiveCount,
          actionCount: validation.actionCount,
          indicatorCount: validation.indicatorCount,
        },
        ipHash: keyedHash(getClientIp(req)),
      });
    });
    res.status(201).json({
      catalogId: catalog.id,
      version: catalog.version,
      sourceHash,
      active,
      objectiveCount: validation.objectiveCount,
      actionCount: validation.actionCount,
      indicatorCount: validation.indicatorCount,
    });
  },
);

export default router;

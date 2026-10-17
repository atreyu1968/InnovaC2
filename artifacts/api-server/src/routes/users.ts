import argon2 from "argon2";
import { Router } from "express";
import { eq } from "drizzle-orm";
import {
  auditLogsTable,
  db,
  usersTable,
} from "@workspace/db";
import { CreateUserBody } from "@workspace/api-zod";
import {
  getClientIp,
  keyedHash,
  requireAuth,
  requireCsrf,
  requirePermission,
  type AuthContext,
} from "../lib/auth";
import initialCatalog from "../../../../config/pic_2026_2027_catalogo.json";

const router = Router();

router.get(
  "/users",
  requireAuth,
  requirePermission("users.read"),
  async (_req, res) => {
    const context = res.locals.auth as AuthContext;
    const [account] = await db
      .select({ centerId: usersTable.centerId })
      .from(usersTable)
      .where(eq(usersTable.id, context.user.id))
      .limit(1);
    if (!account) {
      res.status(401).json({ error: "La cuenta actual ya no está disponible." });
      return;
    }
    const rows = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
        professionalFamily: usersTable.professionalFamily,
        active: usersTable.active,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(eq(usersTable.centerId, account.centerId))
      .orderBy(usersTable.createdAt);
    res.json(rows);
  },
);

router.post(
  "/users",
  requireAuth,
  requireCsrf,
  requirePermission("users.create"),
  async (req, res) => {
    const parsed = CreateUserBody.safeParse(req.body);
    const catalogFamilies = new Set(initialCatalog.familias_profesionales);
    if (
      !parsed.success ||
      parsed.data.temporaryPassword.length > 1024 ||
      (parsed.data.professionalFamily !== undefined &&
        parsed.data.professionalFamily !== null &&
        !catalogFamilies.has(parsed.data.professionalFamily)) ||
      (["profesorado", "jefatura_departamento", "coordinacion_red"].includes(
        parsed.data.role,
      ) &&
        !parsed.data.professionalFamily)
    ) {
      res.status(400).json({ error: "Los datos de la cuenta no son válidos." });
      return;
    }
    const context = res.locals.auth as AuthContext;
    const [creator] = await db
      .select({ centerId: usersTable.centerId })
      .from(usersTable)
      .where(eq(usersTable.id, context.user.id))
      .limit(1);
    if (!creator) {
      res.status(401).json({ error: "La cuenta actual ya no está disponible." });
      return;
    }
    const passwordHash = await argon2.hash(parsed.data.temporaryPassword, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    try {
      const [created] = await db
        .insert(usersTable)
        .values({
          centerId: creator.centerId,
          email: parsed.data.email.trim().toLowerCase(),
          name: parsed.data.name.trim(),
          passwordHash,
          role: parsed.data.role,
          professionalFamily: parsed.data.professionalFamily ?? null,
        })
        .returning({
          id: usersTable.id,
          email: usersTable.email,
          name: usersTable.name,
          role: usersTable.role,
          professionalFamily: usersTable.professionalFamily,
          active: usersTable.active,
          createdAt: usersTable.createdAt,
        });
      await db.insert(auditLogsTable).values({
        userId: context.user.id,
        action: "users.created",
        entityType: "user",
        entityId: created.id,
        details: { role: created.role },
        ipHash: keyedHash(getClientIp(req)),
      });
      res.status(201).json(created);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      ) {
        res.status(409).json({ error: "Ya existe una cuenta con ese correo." });
        return;
      }
      throw error;
    }
  },
);

export default router;

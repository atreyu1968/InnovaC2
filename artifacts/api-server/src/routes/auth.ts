import argon2 from "argon2";
import { Router } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  auditLogsTable,
  authLoginAttemptsTable,
  authSessionsTable,
  centersTable,
  db,
  schoolYearsTable,
  usersTable,
} from "@workspace/db";
import {
  InitializeSetupBody,
  LoginBody,
} from "@workspace/api-zod";
import {
  clearSessionCookie,
  createSession,
  decryptCsrfToken,
  getClientIp,
  keyedHash,
  requireAuth,
  requireCsrf,
  setSessionCookie,
  sha256,
  touchSession,
  type AuthContext,
} from "../lib/auth";

const router = Router();
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;
const MAX_LOGIN_ATTEMPTS = 8;
const RATE_WINDOW_MINUTES = 15;

async function isInitialized(): Promise<boolean> {
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  return Boolean(user);
}

function attemptKeys(ip: string, email: string): string[] {
  return [
    keyedHash(`login-ip:${ip}`),
    keyedHash(`login-identity:${ip}:${email}`),
  ];
}

async function hasActiveBlock(keys: string[]): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .select({ lockedUntil: authLoginAttemptsTable.lockedUntil })
    .from(authLoginAttemptsTable)
    .where(
      and(
        inArray(authLoginAttemptsTable.key, keys),
        sql`${authLoginAttemptsTable.lockedUntil} > ${now}`,
      ),
    );
  return rows.length > 0;
}

async function recordFailedLogin(keys: string[]): Promise<void> {
  const table = authLoginAttemptsTable;
  const windowExpired = sql`${table.windowStartedAt} < NOW() - INTERVAL '15 minutes'`;
  const nextCount = sql<number>`CASE WHEN ${windowExpired} THEN 1 ELSE ${table.attemptCount} + 1 END`;
  for (const key of keys) {
    await db
      .insert(table)
      .values({ key, attemptCount: 1 })
      .onConflictDoUpdate({
        target: table.key,
        set: {
          attemptCount: nextCount,
          windowStartedAt: sql`CASE WHEN ${windowExpired} THEN NOW() ELSE ${table.windowStartedAt} END`,
          lockedUntil: sql`CASE WHEN (${nextCount}) >= ${MAX_LOGIN_ATTEMPTS} THEN NOW() + INTERVAL '15 minutes' ELSE NULL END`,
          updatedAt: sql`NOW()`,
        },
      });
  }
}

async function clearFailedLogins(keys: string[]): Promise<void> {
  await db.delete(authLoginAttemptsTable).where(inArray(authLoginAttemptsTable.key, keys));
}

router.get("/setup/status", async (_req, res) => {
  res.json({ initialized: await isInitialized() });
});

router.post("/setup/initialize", async (req, res) => {
  const parsed = InitializeSetupBody.safeParse(req.body);
  if (!parsed.success || parsed.data.password.length > 1024) {
    res.status(400).json({
      error: parsed.success
        ? "La contraseña supera el máximo permitido."
        : "Los datos iniciales no son válidos.",
    });
    return;
  }
  if (await isInitialized()) {
    res.status(409).json({ error: "La configuración inicial ya se ha completado." });
    return;
  }
  const origin = req.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.get("host")) {
        res.status(403).json({ error: "El origen de la solicitud no está permitido." });
        return;
      }
    } catch {
      res.status(403).json({ error: "El origen de la solicitud no está permitido." });
      return;
    }
  }

  const input = parsed.data;
  const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);
  const created = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('innova_c2_initial_setup'))`,
    );
    const [existing] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .limit(1);
    if (existing) return null;

    const [center] = await tx
      .insert(centersTable)
      .values({ name: input.centerName.trim() })
      .returning({ id: centersTable.id });
    const [schoolYear] = await tx
      .insert(schoolYearsTable)
      .values({ centerId: center.id, label: input.schoolYear, active: true })
      .returning({ id: schoolYearsTable.id });
    const [user] = await tx
      .insert(usersTable)
      .values({
        centerId: center.id,
        email: input.email.trim().toLowerCase(),
        name: input.name.trim(),
        passwordHash,
        role: "admin_tecnico",
      })
      .returning({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
        active: usersTable.active,
        createdAt: usersTable.createdAt,
      });
    await tx.insert(auditLogsTable).values({
      userId: user.id,
      action: "setup.initialized",
      entityType: "center",
      entityId: center.id,
      details: { schoolYearId: schoolYear.id },
      ipHash: keyedHash(getClientIp(req)),
    });
    return user;
  });
  if (!created) {
    res.status(409).json({ error: "La configuración inicial ya se ha completado." });
    return;
  }
  const session = await createSession(created.id);
  setSessionCookie(res, session.sessionToken);
  res.status(201).json({ user: created, csrfToken: session.csrfToken });
});

router.post("/auth/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success || parsed.data.password.length > 1024) {
    res.status(400).json({ error: "El correo o la contraseña no son válidos." });
    return;
  }
  if (!(await isInitialized())) {
    res.status(409).json({ error: "La configuración inicial está pendiente." });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;
  const keys = attemptKeys(getClientIp(req), email);
  if (await hasActiveBlock(keys)) {
    res.status(429).json({
      error: `Demasiados intentos. Espera ${RATE_WINDOW_MINUTES} minutos antes de volver a intentarlo.`,
    });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  const passwordMatches = user
    ? await argon2.verify(user.passwordHash, password).catch(() => false)
    : (await argon2.hash(password, ARGON2_OPTIONS), false);
  const authenticated = Boolean(user?.active) && passwordMatches;
  if (!authenticated || !user) {
    await recordFailedLogin(keys);
    await db.insert(auditLogsTable).values({
      userId: user?.id ?? null,
      action: "auth.login.failed",
      entityType: "user",
      entityId: user?.id ?? null,
      details: { emailHash: sha256(email) },
      ipHash: keyedHash(getClientIp(req)),
    });
    res.status(401).json({ error: "Correo o contraseña incorrectos." });
    return;
  }

  await clearFailedLogins(keys);
  const session = await createSession(user.id);
  setSessionCookie(res, session.sessionToken);
  await db.insert(auditLogsTable).values({
    userId: user.id,
    action: "auth.login.succeeded",
    entityType: "auth_session",
    ipHash: keyedHash(getClientIp(req)),
  });
  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt,
    },
    csrfToken: session.csrfToken,
  });
});

router.get("/auth/me", requireAuth, async (_req, res) => {
  const context = res.locals.auth as AuthContext;
  await touchSession(context.sessionId);
  const csrfToken = decryptCsrfToken(context.csrfTokenCiphertext);
  res.setHeader("Cache-Control", "no-store");
  res.json({ user: context.user, csrfToken });
});

router.post("/auth/logout", requireAuth, requireCsrf, async (_req, res) => {
  const context = res.locals.auth as AuthContext;
  await db.delete(authSessionsTable).where(eq(authSessionsTable.id, context.sessionId));
  await db.insert(auditLogsTable).values({
    userId: context.user.id,
    action: "auth.logout",
    entityType: "auth_session",
    entityId: context.sessionId,
  });
  clearSessionCookie(res);
  res.json({ success: true });
});

export default router;

import argon2 from "argon2";
import { Router, type Request } from "express";
import { and, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import {
  auditLogsTable,
  authLoginAttemptsTable,
  authSessionsTable,
  centersTable,
  db,
  passwordResetTokensTable,
  schoolYearsTable,
  usersTable,
} from "@workspace/db";
import {
  ChangePasswordBody,
  ChangePasswordResponse,
  CompletePasswordResetBody,
  CompletePasswordResetResponse,
  InitializeSetupBody,
  LoginBody,
  RequestPasswordResetBody,
  RequestPasswordResetResponse,
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
import {
  sendPasswordChangeNoticeEmail,
  sendPasswordResetEmail,
} from "../lib/password-reset-email";

const router = Router();
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;
const MAX_LOGIN_ATTEMPTS = 8;
const RATE_WINDOW_MINUTES = 15;
const PASSWORD_RESET_DURATION_MS = 30 * 60 * 1000;
const PASSWORD_RESET_RESPONSE =
  "Si existe una cuenta activa con ese correo, recibirás un enlace para cambiar la contraseña.";
const PASSWORD_RESET_IP_LIMIT = 5;
const PASSWORD_RESET_EMAIL_LIMIT = 3;

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

async function recordResetRateLimitHit(
  key: string,
  maximum: number,
  windowMinutes: number,
): Promise<void> {
  const table = authLoginAttemptsTable;
  const windowInterval =
    windowMinutes === 15 ? sql`INTERVAL '15 minutes'` : sql`INTERVAL '60 minutes'`;
  const windowExpired = sql`${table.windowStartedAt} < NOW() - ${windowInterval}`;
  const nextCount = sql<number>`CASE WHEN ${windowExpired} THEN 1 ELSE ${table.attemptCount} + 1 END`;
  await db
    .insert(table)
    .values({ key, attemptCount: 1 })
    .onConflictDoUpdate({
      target: table.key,
      set: {
        attemptCount: nextCount,
        windowStartedAt: sql`CASE WHEN ${windowExpired} THEN NOW() ELSE ${table.windowStartedAt} END`,
        lockedUntil: sql`CASE WHEN (${nextCount}) >= ${maximum} THEN NOW() + ${windowInterval} ELSE NULL END`,
        updatedAt: sql`NOW()`,
      },
    });
}

function passwordResetOrigin(req: Request): string | null {
  const origin = req.get("origin");
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    if (
      parsed.host !== req.get("host") ||
      !["http:", "https:"].includes(parsed.protocol) ||
      (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
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

router.post("/auth/password-reset/request", async (req, res): Promise<void> => {
  const parsed = RequestPasswordResetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "El correo electrónico no es válido." });
    return;
  }

  const origin = passwordResetOrigin(req);
  if (!origin) {
    res.status(403).json({ error: "El origen de la solicitud no está permitido." });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const ip = getClientIp(req);
  const ipKey = keyedHash(`password-reset-ip:${ip}`);
  const emailKey = keyedHash(`password-reset-email:${email}`);
  if (await hasActiveBlock([ipKey])) {
    res.status(429).json({
      error: "Se ha alcanzado el límite de solicitudes. Inténtalo de nuevo más tarde.",
    });
    return;
  }

  const emailIsBlocked = await hasActiveBlock([emailKey]);
  await recordResetRateLimitHit(ipKey, PASSWORD_RESET_IP_LIMIT, 15);
  await recordResetRateLimitHit(emailKey, PASSWORD_RESET_EMAIL_LIMIT, 60);

  res.setHeader("Cache-Control", "no-store");
  if (emailIsBlocked) {
    res
      .status(202)
      .json(RequestPasswordResetResponse.parse({ message: PASSWORD_RESET_RESPONSE }));
    return;
  }

  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(and(eq(usersTable.email, email), eq(usersTable.active, true)))
    .limit(1);
  if (!user) {
    res
      .status(202)
      .json(RequestPasswordResetResponse.parse({ message: PASSWORD_RESET_RESPONSE }));
    return;
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  const tokenExpiresAt = new Date(Date.now() + PASSWORD_RESET_DURATION_MS);
  const [resetRecord] = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`password-reset:${user.id}`}))`,
    );
    await tx
      .delete(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.userId, user.id));
    return tx
      .insert(passwordResetTokensTable)
      .values({ userId: user.id, tokenHash, expiresAt: tokenExpiresAt })
      .returning({ id: passwordResetTokensTable.id });
  });

  const resetUrl = new URL("/reset-password", origin);
  resetUrl.searchParams.set("token", token);
  try {
    await sendPasswordResetEmail({ to: user.email, resetUrl: resetUrl.toString() });
  } catch (error) {
    req.log.error(
      { err: error, userId: user.id },
      "Password reset email could not be sent",
    );
    await db
      .delete(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.id, resetRecord.id));
  }

  res
    .status(202)
    .json(RequestPasswordResetResponse.parse({ message: PASSWORD_RESET_RESPONSE }));
});

router.post("/auth/password-reset/complete", async (req, res): Promise<void> => {
  const parsed = CompletePasswordResetBody.safeParse(req.body);
  if (!parsed.success || parsed.data.password.length > 1024) {
    res.status(400).json({ error: "El enlace no es válido o ha caducado." });
    return;
  }

  const tokenHash = sha256(parsed.data.token);
  const [candidate] = await db
    .select({ id: passwordResetTokensTable.id })
    .from(passwordResetTokensTable)
    .where(
      and(
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        isNull(passwordResetTokensTable.usedAt),
        gt(passwordResetTokensTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!candidate) {
    res.status(400).json({ error: "El enlace no es válido o ha caducado." });
    return;
  }

  const passwordHash = await argon2.hash(parsed.data.password, ARGON2_OPTIONS);
  const reset = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(passwordResetTokensTable)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokensTable.id, candidate.id),
          isNull(passwordResetTokensTable.usedAt),
          gt(passwordResetTokensTable.expiresAt, new Date()),
        ),
      )
      .returning({ userId: passwordResetTokensTable.userId });
    if (!claimed) return null;

    const [updatedUser] = await tx
      .update(usersTable)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(usersTable.id, claimed.userId))
      .returning({ email: usersTable.email });
    if (!updatedUser) {
      throw new Error("Password reset user no longer exists.");
    }
    await tx
      .delete(authSessionsTable)
      .where(eq(authSessionsTable.userId, claimed.userId));
    await tx
      .delete(passwordResetTokensTable)
      .where(
        and(
          eq(passwordResetTokensTable.userId, claimed.userId),
          sql`${passwordResetTokensTable.id} <> ${candidate.id}`,
        ),
      );
    await tx.insert(auditLogsTable).values({
      userId: claimed.userId,
      action: "auth.password_reset.completed",
      entityType: "user",
      entityId: claimed.userId,
      ipHash: keyedHash(getClientIp(req)),
    });
    return { userId: claimed.userId, email: updatedUser.email };
  });

  if (!reset) {
    res.status(400).json({ error: "El enlace no es válido o ha caducado." });
    return;
  }

  try {
    await sendPasswordChangeNoticeEmail(reset.email);
  } catch (error) {
    req.log.error(
      {
        errorCategory: error instanceof Error ? "email_delivery_error" : "unknown_error",
      },
      "Password change notification could not be sent",
    );
  }

  clearSessionCookie(res);
  res.setHeader("Cache-Control", "no-store");
  res.json(CompletePasswordResetResponse.parse({ success: true }));
});

router.post("/auth/password/change", requireAuth, requireCsrf, async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const context = res.locals.auth as AuthContext;
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "La contraseña nueva debe tener entre 12 y 1024 caracteres." });
    return;
  }
  const keys = [keyedHash(`password-change-user:${context.user.id}`)];
  if (await hasActiveBlock(keys)) {
    res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos antes de volver a intentarlo." });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, context.user.id));
  if (!user?.active) {
    res.status(401).json({ error: "La sesión ha caducado o no es válida." });
    return;
  }
  const matches = await argon2.verify(user.passwordHash, parsed.data.currentPassword).catch(() => false);
  if (!matches) {
    await recordFailedLogin(keys);
    res.status(400).json({ error: "La contraseña actual no es correcta." });
    return;
  }
  if (parsed.data.currentPassword === parsed.data.password) {
    res.status(400).json({ error: "La contraseña nueva debe ser diferente de la actual." });
    return;
  }
  const passwordHash = await argon2.hash(parsed.data.password, ARGON2_OPTIONS);
  const changed = await db.transaction(async (tx) => {
    // Compare-and-swap prevents two requests verified against the same old hash
    // from both succeeding. Recheck the session in case it was revoked in flight.
    const [updated] = await tx.update(usersTable)
      .set({ passwordHash, updatedAt: new Date() })
      .where(and(
        eq(usersTable.id, user.id),
        eq(usersTable.passwordHash, user.passwordHash),
        eq(usersTable.active, true),
        sql`EXISTS (SELECT 1 FROM ${authSessionsTable} WHERE ${authSessionsTable.id} = ${context.sessionId} AND ${authSessionsTable.userId} = ${user.id} AND ${authSessionsTable.expiresAt} > NOW())`,
      ))
      .returning({ email: usersTable.email });
    if (!updated) return null;
    await tx.delete(authSessionsTable).where(and(
      eq(authSessionsTable.userId, user.id),
      ne(authSessionsTable.id, context.sessionId),
    ));
    await tx.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.userId, user.id));
    await tx.insert(auditLogsTable).values({
      userId: user.id,
      action: "auth.password.changed",
      entityType: "user",
      entityId: user.id,
      ipHash: keyedHash(getClientIp(req)),
    });
    return updated;
  });
  if (!changed) {
    res.status(409).json({ error: "La contraseña o la sesión ha cambiado. Recarga la página antes de volver a intentarlo." });
    return;
  }
  await clearFailedLogins(keys);
  let noticeSent = false;
  try {
    await sendPasswordChangeNoticeEmail(changed.email);
    noticeSent = true;
  } catch {
    req.log.error({ errorCategory: "email_delivery_error" }, "Password change notification could not be sent");
  }
  res.json(ChangePasswordResponse.parse({ success: true, noticeSent }));
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

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { RequestHandler, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import {
  authSessionsTable,
  db,
  rolePermissionsTable,
  usersTable,
  schoolYearsTable,
  schoolYearAssignmentsTable,
} from "@workspace/db";
import type { UserRole } from "@workspace/api-zod";

export const SESSION_COOKIE = "innova_session";
export const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  createdAt: Date;
};

export type AuthContext = {
  user: PublicUser;
  sessionId: string;
  csrfHash: string;
  csrfTokenCiphertext: string;
};

export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  return secret;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function csrfEncryptionKey(): Buffer {
  return createHash("sha256").update(sessionSecret()).digest();
}

function encryptCsrfToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", csrfEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptCsrfToken(ciphertext: string): string {
  const [version, ivEncoded, tagEncoded, dataEncoded] = ciphertext.split(".");
  if (version !== "v1" || !ivEncoded || !tagEncoded || !dataEncoded) {
    throw new Error("Invalid encrypted CSRF token.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    csrfEncryptionKey(),
    Buffer.from(ivEncoded, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function keyedHash(value: string): string {
  return createHmac("sha256", sessionSecret()).update(value).digest("hex");
}

export function getClientIp(req: Parameters<RequestHandler>[0]): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure:
      process.env.NODE_ENV === "production" ||
      process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure:
      process.env.NODE_ENV === "production" ||
      process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
  });
}

export async function createSession(userId: string): Promise<{
  csrfToken: string;
  sessionToken: string;
}> {
  const sessionToken = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  await db.insert(authSessionsTable).values({
    userId,
    tokenHash: keyedHash(`session:${sessionToken}`),
    csrfHash: sha256(csrfToken),
    csrfTokenCiphertext: encryptCsrfToken(csrfToken),
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
  });
  return { csrfToken, sessionToken };
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const cookie = req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  const token = cookie
    ? cookie.slice(SESSION_COOKIE.length + 1)
    : "";
  if (!token) {
    res.status(401).json({ error: "Se requiere iniciar sesión." });
    return;
  }

  const [row] = await db
    .select({
      sessionId: authSessionsTable.id,
      csrfHash: authSessionsTable.csrfHash,
      csrfTokenCiphertext: authSessionsTable.csrfTokenCiphertext,
      expiresAt: authSessionsTable.expiresAt,
      userId: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      role: usersTable.role,
      active: usersTable.active,
      createdAt: usersTable.createdAt,
    })
    .from(authSessionsTable)
    .innerJoin(usersTable, eq(authSessionsTable.userId, usersTable.id))
    .where(
      and(
        eq(authSessionsTable.tokenHash, keyedHash(`session:${token}`)),
        gt(authSessionsTable.expiresAt, new Date()),
        eq(usersTable.active, true),
      ),
    )
    .limit(1);

  if (!row) {
    clearSessionCookie(res);
    res.status(401).json({ error: "La sesión ha caducado o no es válida." });
    return;
  }

  res.locals.auth = {
    sessionId: row.sessionId,
    csrfHash: row.csrfHash,
    csrfTokenCiphertext: row.csrfTokenCiphertext,
    user: {
      id: row.userId,
      email: row.email,
      name: row.name,
      role: row.role,
      active: row.active,
      createdAt: row.createdAt,
    },
  } satisfies AuthContext;
  next();
};

export const requireCsrf: RequestHandler = (req, res, next) => {
  const context = res.locals.auth as AuthContext | undefined;
  const token = req.get("x-csrf-token");
  if (!context || !token) {
    res.status(403).json({ error: "Falta la comprobación de seguridad de sesión." });
    return;
  }
  const supplied = Buffer.from(sha256(token), "hex");
  const expected = Buffer.from(context.csrfHash, "hex");
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    res.status(403).json({ error: "La comprobación de seguridad no es válida." });
    return;
  }
  next();
};

export function requirePermission(permission: string): RequestHandler {
  return async (_req, res, next) => {
    const context = res.locals.auth as AuthContext | undefined;
    if (!context) {
      res.status(401).json({ error: "Se requiere iniciar sesión." });
      return;
    }
    // Annual access is explicit once a course has reviewed assignments. Global
    // account permissions remain an upper bound, never an automatic carry-over.
    if (context.user.role !== "admin_tecnico" && /^(pic\.plan\.|activities\.|documents\.|information\.|indicators\.|staff\.|communications\.)/.test(permission)) {
      const [account] = await db.select({ centerId: usersTable.centerId }).from(usersTable)
        .where(eq(usersTable.id, context.user.id));
      const [year] = account ? await db.select({ id: schoolYearsTable.id }).from(schoolYearsTable)
        .where(and(eq(schoolYearsTable.centerId, account.centerId), eq(schoolYearsTable.active, true))) : [];
      if (year) {
        const assignments = await db.select().from(schoolYearAssignmentsTable)
          .where(eq(schoolYearAssignmentsTable.schoolYearId, year.id));
        const assignment = assignments.find(a => a.userId === context.user.id);
        if (assignments.length && !assignment) {
          res.status(403).json({ error: "Esta cuenta no tiene una asignación revisada para el curso activo." });
          return;
        }
        if (assignment) {
          const [annualGrant] = await db.select().from(rolePermissionsTable).where(and(
            eq(rolePermissionsTable.role, assignment.role), eq(rolePermissionsTable.permission, permission),
          )).limit(1);
          if (!annualGrant) {
            res.status(403).json({ error: "La asignación del curso no permite esta operación." }); return;
          }
        }
      }
    }
    const [grant] = await db
      .select({ permission: rolePermissionsTable.permission })
      .from(rolePermissionsTable)
      .where(
        and(
          eq(rolePermissionsTable.role, context.user.role),
          eq(rolePermissionsTable.permission, permission),
        ),
      )
      .limit(1);
    if (!grant) {
      res.status(403).json({ error: "Tu rol no permite realizar esta operación." });
      return;
    }
    next();
  };
}

export async function touchSession(sessionId: string): Promise<void> {
  await db
    .update(authSessionsTable)
    .set({ lastSeenAt: new Date() })
    .where(eq(authSessionsTable.id, sessionId));
}

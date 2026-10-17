import { and, eq } from "drizzle-orm";
import { Router, type Response } from "express";
import {
  aiProviderSettingsTable, auditLogsTable, centersTable, db, usersTable,
} from "@workspace/db";
import { UpdateAdminAIProviderSettings } from "@workspace/api-zod";
import { requireAuth, requireCsrf, type AuthContext } from "../lib/auth";
import { encryptAIProviderKey, type AIProviderMode } from "../lib/ai-provider";
import { logger } from "../lib/logger";

const router = Router();

class SettingsFailure extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type AdminIdentity = { userId: string; centerId: string };

async function adminIdentity(res: Response): Promise<AdminIdentity> {
  const auth = (res.locals as { auth?: AuthContext }).auth;
  if (!auth) throw new SettingsFailure(401, "La sesión ha caducado.");
  if (auth.user.role !== "admin_tecnico") {
    throw new SettingsFailure(403, "Solo administración técnica puede configurar el proveedor de IA.");
  }
  const [user] = await db.select({ centerId: usersTable.centerId })
    .from(usersTable).where(eq(usersTable.id, auth.user.id)).limit(1);
  if (!user?.centerId) throw new SettingsFailure(403, "La cuenta no tiene un centro asignado.");
  return { userId: auth.user.id, centerId: user.centerId };
}

function dto(row?: typeof aiProviderSettingsTable.$inferSelect) {
  return {
    provider: (row?.provider ?? "disabled") as AIProviderMode,
    baseUrl: row?.baseUrl ?? null,
    transcriptionModel: row?.transcriptionModel ?? null,
    minutesModel: row?.minutesModel ?? null,
    apiKeyConfigured: Boolean(row?.apiKeyCiphertext && row.apiKeyIv && row.apiKeyTag),
    externalAuthorizedAt: row?.externalAuthorizedAt ?? null,
    revision: row?.revision ?? 0,
    updatedAt: row?.updatedAt ?? null,
  };
}

function normalizeBaseUrl(mode: AIProviderMode, input: string): string | null {
  const value = input.trim();
  if (!value) {
    if (mode === "disabled") return null;
    throw new SettingsFailure(400, "Indica el endpoint base del proveedor.");
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new SettingsFailure(400, "El endpoint debe ser una URL válida."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new SettingsFailure(400, "El endpoint debe usar HTTP(S), sin credenciales, consulta ni fragmento.");
  }
  if (mode === "external_authorized" && url.protocol !== "https:") {
    throw new SettingsFailure(400, "Los proveedores externos deben usar HTTPS.");
  }
  if (mode === "local" && !isLocalHost(url.hostname)) {
    throw new SettingsFailure(400, "El modo local solo acepta un host local o de red privada.");
  }
  return value.replace(/\/+$/, "");
}

function isLocalHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (name === "localhost" || name.endsWith(".localhost") || name.endsWith(".local") || name.endsWith(".lan")) return true;
  if (name === "::1" || name.startsWith("fc") || name.startsWith("fd") || name.startsWith("fe80:")) return true;
  const parts = name.split(".").map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168);
  }
  // Single-label names are commonly used for services on a private Docker or LAN network.
  return !name.includes(".") && name.length > 0;
}

function replyError(res: Response, error: unknown): void {
  if (error instanceof SettingsFailure) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  logger.error({ code: (error as { code?: string })?.code }, "AI provider settings failed");
  res.status(500).json({ error: "No se pudo completar la configuración del proveedor de IA." });
}

router.get("/admin/ai/provider", requireAuth, async (_req, res) => {
  try {
    const identity = await adminIdentity(res);
    const [row] = await db.select().from(aiProviderSettingsTable)
      .where(eq(aiProviderSettingsTable.centerId, identity.centerId)).limit(1);
    res.json(dto(row));
  } catch (error) { replyError(res, error); }
});

router.put("/admin/ai/provider", requireAuth, requireCsrf, async (req, res) => {
  try {
    const identity = await adminIdentity(res);
    const parsed = UpdateAdminAIProviderSettings.safeParse(req.body);
    if (!parsed.success) throw new SettingsFailure(400, "La configuración no tiene un formato válido.");
    const input = parsed.data;
    const mode = input.provider;
    const baseUrl = normalizeBaseUrl(mode, input.baseUrl);
    const transcriptionModel = input.transcriptionModel.trim() || null;
    const minutesModel = input.minutesModel.trim() || null;
    if (mode !== "disabled" && (!transcriptionModel || !minutesModel)) {
      throw new SettingsFailure(400, "Indica un modelo de transcripción y otro para redactar el acta.");
    }
    if (mode === "external_authorized" && !input.externalAuthorizationConfirmed) {
      throw new SettingsFailure(400, "Confirma que el uso del proveedor externo está autorizado antes de guardarlo.");
    }
    const suppliedKey = input.apiKey?.trim() || null;
    if (suppliedKey && input.clearApiKey) {
      throw new SettingsFailure(400, "No puedes guardar y borrar la clave en la misma operación.");
    }
    const encrypted = suppliedKey ? encryptAIProviderKey(suppliedKey) : null;

    const result = await db.transaction(async (tx) => {
      await tx.select({ id: centersTable.id }).from(centersTable)
        .where(eq(centersTable.id, identity.centerId)).for("update");
      const [current] = await tx.select().from(aiProviderSettingsTable)
        .where(eq(aiProviderSettingsTable.centerId, identity.centerId)).limit(1);
      const revision = current?.revision ?? 0;
      if (revision !== input.expectedRevision) {
        throw new SettingsFailure(409, "La configuración cambió en otra sesión. Recárgala antes de guardar.");
      }
      const hasKeyAfterUpdate = input.clearApiKey ? false : Boolean(encrypted || current?.apiKeyCiphertext);
      if (mode === "external_authorized" && !hasKeyAfterUpdate) {
        throw new SettingsFailure(400, "Introduce la clave del proveedor externo antes de activarlo.");
      }
      const keyValues = input.clearApiKey
        ? { apiKeyCiphertext: null, apiKeyIv: null, apiKeyTag: null }
        : encrypted
          ? { apiKeyCiphertext: encrypted.ciphertext, apiKeyIv: encrypted.iv, apiKeyTag: encrypted.tag }
          : {};
      const updatedAt = new Date();
      const values = {
        centerId: identity.centerId,
        provider: mode,
        baseUrl,
        transcriptionModel,
        minutesModel,
        ...keyValues,
        externalAuthorizedAt: mode === "external_authorized" ? updatedAt : null,
        externalAuthorizedBy: mode === "external_authorized" ? identity.userId : null,
        revision: revision + 1,
        updatedBy: identity.userId,
        updatedAt,
      };
      const [saved] = current
        ? await tx.update(aiProviderSettingsTable).set(values)
          .where(and(
            eq(aiProviderSettingsTable.centerId, identity.centerId),
            eq(aiProviderSettingsTable.revision, revision),
          )).returning()
        : await tx.insert(aiProviderSettingsTable).values(values).returning();
      if (!saved) throw new SettingsFailure(409, "La configuración cambió en otra sesión. Recárgala antes de guardar.");
      await tx.insert(auditLogsTable).values({
        userId: identity.userId,
        action: "admin.ai_provider.update",
        entityType: "ai_provider_settings",
        entityId: identity.centerId,
        details: {
          provider: mode,
          keyReplaced: Boolean(encrypted),
          keyRemoved: input.clearApiKey,
          externalAuthorizationConfirmed: mode === "external_authorized",
          revision: saved.revision,
        },
      });
      return saved;
    });
    res.json(dto(result));
  } catch (error) { replyError(res, error); }
});

export default router;

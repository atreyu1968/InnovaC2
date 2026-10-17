import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { aiProviderSettingsTable, db } from "@workspace/db";

export type AIProviderMode = "disabled" | "local" | "external_authorized";

export class AIProviderError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function encryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters to protect AI provider credentials.");
  }
  return Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(secret, "utf8"),
    Buffer.from("INNOVA-C2", "utf8"),
    Buffer.from("AI-provider-credential-v1", "utf8"),
    32,
  ));
}

export function encryptAIProviderKey(value: string): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptAIProviderKey(row: typeof aiProviderSettingsTable.$inferSelect): string | null {
  if (!row.apiKeyCiphertext || !row.apiKeyIv || !row.apiKeyTag) return null;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(row.apiKeyIv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(row.apiKeyTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.apiKeyCiphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export async function loadAIProvider(centerId: string) {
  const [row] = await db.select().from(aiProviderSettingsTable)
    .where(eq(aiProviderSettingsTable.centerId, centerId)).limit(1);
  if (!row || row.provider === "disabled") {
    throw new AIProviderError(503, "El proveedor de IA está desactivado en Configuración técnica.");
  }
  if (row.provider !== "local" && row.provider !== "external_authorized") {
    throw new AIProviderError(503, "La configuración del proveedor de IA no es válida.");
  }
  if (!row.baseUrl || !row.transcriptionModel || !row.minutesModel) {
    throw new AIProviderError(503, "Falta completar el endpoint o los modelos del proveedor de IA.");
  }
  const apiKey = decryptAIProviderKey(row);
  if (row.provider === "external_authorized" && (!row.externalAuthorizedAt || !apiKey)) {
    throw new AIProviderError(503, "El proveedor externo no tiene autorización o credenciales completas.");
  }
  return {
    mode: row.provider as Exclude<AIProviderMode, "disabled">,
    baseUrl: row.baseUrl.replace(/\/+$/, ""),
    transcriptionModel: row.transcriptionModel,
    minutesModel: row.minutesModel,
    apiKey,
  };
}

function providerHeaders(apiKey: string | null): HeadersInit {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function checkResponse(response: Response): Promise<void> {
  if (!response.ok) {
    throw new AIProviderError(502, `El proveedor de IA no completó la solicitud (HTTP ${response.status}).`);
  }
}

export async function transcribeMeetingAudio(input: {
  centerId: string;
  audio: Buffer;
  fileName: string;
  mediaType: string;
}): Promise<string> {
  const config = await loadAIProvider(input.centerId);
  const form = new FormData();
  form.set("model", config.transcriptionModel);
  form.set("language", "es");
  const audioBytes = input.audio.buffer.slice(
    input.audio.byteOffset,
    input.audio.byteOffset + input.audio.byteLength,
  ) as ArrayBuffer;
  form.set("file", new Blob([audioBytes], { type: input.mediaType }), input.fileName);
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: providerHeaders(config.apiKey),
      body: form,
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new AIProviderError(502, "No se pudo conectar con el endpoint de transcripción configurado.");
  }
  await checkResponse(response);
  const result = await response.json() as { text?: unknown };
  if (typeof result.text !== "string" || !result.text.trim()) {
    throw new AIProviderError(502, "El proveedor no devolvió una transcripción legible.");
  }
  return result.text.trim();
}

export async function draftMeetingMinutes(input: {
  centerId: string;
  meetingTitle: string;
  meetingDate: string;
  transcript: string;
}): Promise<string> {
  const config = await loadAIProvider(input.centerId);
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...providerHeaders(config.apiKey) },
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model: config.minutesModel,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "Redacta en español un borrador claro de acta a partir exclusivamente de la transcripción y los datos de contexto proporcionados. No inventes asistentes, constitución, acuerdos, fechas ni aprobaciones. Distingue temas tratados, acuerdos expresamente dichos y tareas expresamente asignadas. Si algo no consta, indícalo como «No consta en la transcripción». Devuelve solo el texto del borrador, sin afirmar que está aprobado.",
          },
          {
            role: "user",
            content: JSON.stringify({
              meetingTitle: input.meetingTitle,
              meetingDate: input.meetingDate,
              transcript: input.transcript,
            }),
          },
        ],
      }),
    });
  } catch {
    throw new AIProviderError(502, "No se pudo conectar con el proveedor de IA para preparar el borrador.");
  }
  await checkResponse(response);
  const result = await response.json() as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new AIProviderError(502, "El proveedor no devolvió un borrador de acta legible.");
  }
  return content.trim();
}

import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.resend.com";
const SEND_DOMAIN = "iesmmg.org";

export type ResendDomainCheck = {
  connected: boolean;
  verified: boolean;
  domain: string;
  status: string;
  records: Array<{ type: string; name: string; value: string; status: string; priority?: number | null }>;
};

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.startsWith("re_"));
}

export function mailSendEnabled(): boolean {
  return process.env.EMAIL_ENABLED === "true";
}

async function resendRequest(path: string, init?: RequestInit): Promise<unknown> {
  const key = process.env.RESEND_API_KEY;
  if (!key?.startsWith("re_")) throw new Error("RESEND_NOT_CONFIGURED");
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      signal: AbortSignal.timeout(12000),
      headers: { Authorization: `Bearer ${key}`, ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error("RESEND_UNAVAILABLE");
  }
  if (!response.ok) throw new Error(`RESEND_HTTP_${response.status}`);
  try { return await response.json(); } catch { throw new Error("RESEND_INVALID_RESPONSE"); }
}

export async function checkResendDomain(): Promise<ResendDomainCheck> {
  const base = {
    connected: resendConfigured(),
    verified: false,
    domain: SEND_DOMAIN,
    status: resendConfigured() ? "desconocido" : "sin_clave",
    records: [] as ResendDomainCheck["records"],
  };
  if (!base.connected) return base;
  const result = await resendRequest("/domains") as { data?: Array<{
    name?: unknown; status?: unknown; records?: Array<Record<string, unknown>>;
  }> };
  const domain = result.data?.find(item => item.name === SEND_DOMAIN);
  if (!domain) return { ...base, status: "no_registrado" };
  const records = (domain.records ?? []).filter(r =>
    typeof r.type === "string" && typeof r.name === "string" && typeof r.value === "string",
  ).map(r => ({
    type: String(r.type), name: String(r.name), value: String(r.value),
    status: typeof r.status === "string" ? r.status : "desconocido",
    priority: typeof r.priority === "number" ? r.priority : null,
  }));
  return {
    ...base,
    verified: domain.status === "verified",
    status: typeof domain.status === "string" ? domain.status : "desconocido",
    records,
  };
}

export type ProviderAttachment = { filename: string; content: string; content_type?: string };

export async function sendResendEmail(input: {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  threadReplyAddress: string;
  idempotencyKey: string;
  attachments: ProviderAttachment[];
}): Promise<{ id: string }> {
  const response = await resendRequest("/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      reply_to: input.threadReplyAddress || input.replyTo,
      subject: input.subject,
      text: input.text,
      headers: { "X-INNOVA-C2-Reply-To": input.threadReplyAddress },
      attachments: input.attachments,
    }),
  }) as { id?: unknown };
  if (typeof response.id !== "string" || !response.id) throw new Error("RESEND_INVALID_RESPONSE");
  return { id: response.id };
}

export async function retrieveResendEmail(emailId: string): Promise<Record<string, unknown>> {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(emailId)) throw new Error("RESEND_INVALID_ID");
  return await resendRequest(`/emails/receiving/${encodeURIComponent(emailId)}`) as Record<string, unknown>;
}

export async function listResendReceivedAttachments(emailId: string): Promise<Array<Record<string, unknown>>> {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(emailId)) throw new Error("RESEND_INVALID_ID");
  const result = await resendRequest(`/emails/receiving/${encodeURIComponent(emailId)}/attachments`) as { data?: unknown };
  return Array.isArray(result.data) ? result.data as Array<Record<string, unknown>> : [];
}

export async function downloadResendAttachment(url: string, maxBytes: number): Promise<Buffer> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("RESEND_ATTACHMENT_URL_INVALID"); }
  if (parsed.protocol !== "https:" || parsed.hostname !== "inbound-cdn.resend.com" || parsed.port || parsed.username || parsed.password)
    throw new Error("RESEND_ATTACHMENT_HOST_REJECTED");
  const response = await fetch(parsed, { signal: AbortSignal.timeout(15000), redirect: "error" });
  if (!response.ok || !response.body) throw new Error(`RESEND_ATTACHMENT_HTTP_${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("RESEND_ATTACHMENT_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size);
}

export function verifyResendSignature(input: {
  rawBody: Buffer | undefined;
  id?: string;
  timestamp?: string;
  signature?: string;
  secret: string | undefined;
  nowSeconds?: number;
}): boolean {
  const { rawBody, id, timestamp, signature, secret } = input;
  if (!rawBody || !id || id.length > 200 || !timestamp || !/^\d{10}$/.test(timestamp) ||
      !signature || signature.length > 2048 || !secret?.startsWith("whsec_")) return false;
  const issuedAt = Number(timestamp);
  if (!Number.isSafeInteger(issuedAt) || Math.abs((input.nowSeconds ?? Math.floor(Date.now() / 1000)) - issuedAt) > 300) return false;
  let key: Buffer;
  try { key = Buffer.from(secret.slice(6), "base64"); } catch { return false; }
  if (key.length < 16) return false;
  const signedContent = Buffer.concat([Buffer.from(`${id}.${timestamp}.`, "utf8"), rawBody]);
  const expected = createHmac("sha256", key).update(signedContent).digest();
  for (const part of signature.split(" ")) {
    const [version, encoded] = part.split(",");
    if (version !== "v1" || !encoded) continue;
    let candidate: Buffer;
    try { candidate = Buffer.from(encoded, "base64"); } catch { continue; }
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return true;
  }
  return false;
}

export function resendFromAddress(alias: string): string {
  if (!["innovacion", "ciclope", "proyectos"].includes(alias)) throw new Error("INVALID_SENDER_ALIAS");
  return `${alias}@${SEND_DOMAIN}`;
}

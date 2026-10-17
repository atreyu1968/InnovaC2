import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  db, schoolYearsTable, usersTable, documentsTable, documentVersionsTable,
  mailAttachmentsTable, mailContactsTable, mailMessagesTable, mailSettingsTable,
  mailThreadsTable, mailWebhookEventsTable,
} from "@workspace/db";
import { dataDirectory } from "./storage";
import { scanWithClamAv } from "./clamav";
import {
  checkResendDomain, downloadResendAttachment, listResendReceivedAttachments,
  mailSendEnabled, resendConfigured, resendFromAddress, retrieveResendEmail,
  sendResendEmail,
} from "./mail-provider";
import { logger } from "./logger";

export const privateMailDirectory = path.join(dataDirectory, "mail-private");
const MAX_INBOUND_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_OUTBOUND_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const RETRY_LIMIT = 5;
let workerStarted = false;
let activeRun = false;
let domainCache: { checkedAt: number; verified: boolean } | undefined;

export type PinnedDocument = {
  documentId: string; title: string; version: number; storageKey: string; originalName: string; mediaType: string; sizeBytes: number; sha256: string;
};
const SAFE_TYPES = new Set([
  "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg", "image/png", "image/webp", "text/plain", "text/csv",
]);

function safeName(name: string): string {
  const base = path.basename(name).replace(/[^\p{L}\p{N}_. -]/gu, "_").slice(0, 180);
  return base && base !== "." && base !== ".." ? base : "adjunto.bin";
}

function plainText(html: string): string {
  return html.replace(/<(script|style|iframe|object|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]{0,2000}>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 50000);
}

function domainVerified(): Promise<boolean> {
  const now = Date.now();
  if (domainCache && now - domainCache.checkedAt < 60_000) return Promise.resolve(domainCache.verified);
  return checkResendDomain().then(result => {
    domainCache = { checkedAt: Date.now(), verified: result.verified };
    return result.verified;
  });
}

export async function storedAttachments(ids: string[], schoolYearId: string, centerId: string): Promise<Array<PinnedDocument>> {
  if (ids.length > 10) throw new Error("MAIL_ATTACHMENTS_LIMIT");
  const snapshots: PinnedDocument[] = [];
  let total = 0;
  for (const id of ids) {
    const [document] = await db.select().from(documentsTable).where(and(
      eq(documentsTable.id, id), eq(documentsTable.centerId, centerId),
      eq(documentsTable.schoolYearId, schoolYearId), eq(documentsTable.accessScope, "center"),
      eq(documentsTable.status, "aprobado"),
    ));
    if (!document) throw new Error("MAIL_ATTACHMENT_NOT_AUTHORIZED");
    const [version] = await db.select().from(documentVersionsTable).where(and(
      eq(documentVersionsTable.documentId, id), eq(documentVersionsTable.version, document.currentVersion),
      eq(documentVersionsTable.scanStatus, "limpio"),
    ));
    if (!version || version.sizeBytes > MAX_OUTBOUND_ATTACHMENT_BYTES || !SAFE_TYPES.has(version.mediaType))
      throw new Error("MAIL_ATTACHMENT_NOT_SCANNED");
    total += version.sizeBytes;
    if (total > MAX_OUTBOUND_ATTACHMENT_BYTES) throw new Error("MAIL_ATTACHMENTS_TOTAL_LIMIT");
    snapshots.push({
      documentId: document.id, title: document.title, version: version.version,
      storageKey: version.storageKey, originalName: safeName(version.originalName),
      mediaType: version.mediaType, sizeBytes: version.sizeBytes, sha256: version.sha256,
    });
  }
  return snapshots;
}

async function sendQueuedMessage(messageId: string): Promise<void> {
  const [message] = await db.select().from(mailMessagesTable).where(eq(mailMessagesTable.id, messageId));
  if (!message) return;
  const [thread] = await db.select().from(mailThreadsTable).where(eq(mailThreadsTable.id, message.threadId));
  const [year] = await db.select().from(schoolYearsTable).where(and(
    eq(schoolYearsTable.id, message.schoolYearId), eq(schoolYearsTable.centerId, message.centerId),
    eq(schoolYearsTable.active, true), isNull(schoolYearsTable.closedAt),
  ));
  const [settings] = await db.select().from(mailSettingsTable).where(eq(mailSettingsTable.centerId, message.centerId));
  const [contact] = message.contactId ? await db.select().from(mailContactsTable).where(and(
    eq(mailContactsTable.id, message.contactId), eq(mailContactsTable.schoolYearId, message.schoolYearId),
    eq(mailContactsTable.centerId, message.centerId),
  )) : [];
  if (!year || !thread || !settings?.sendEnabled || !contact?.active ||
      ((contact.optOut || !contact.authorizationNote) && message.classification !== "obligatoria")) {
    await db.update(mailMessagesTable).set({ status: "fallido", lastError: "destinatario_no_autorizado" })
      .where(eq(mailMessagesTable.id, messageId));
    return;
  }
  if (!mailSendEnabled() || !resendConfigured()) {
    await db.update(mailMessagesTable).set({ status: "cola_pausada", retryAt: null, lastError: "proveedor_detenido_por_configuracion" })
      .where(eq(mailMessagesTable.id, messageId));
    return;
  }
  let verified: boolean;
  try { verified = await domainVerified(); }
  catch {
    await db.update(mailMessagesTable).set({ status: "en_cola", retryAt: new Date(Date.now() + 15 * 60_000), lastError: "dominio_no_verificable_temporalmente" })
      .where(eq(mailMessagesTable.id, messageId));
    return;
  }
  if (!verified) {
    await db.update(mailMessagesTable).set({ status: "en_cola", retryAt: new Date(Date.now() + 15 * 60_000), lastError: "dominio_sin_verificar" })
      .where(eq(mailMessagesTable.id, messageId));
    return;
  }

  const pinned = message.attachmentSnapshot as PinnedDocument[];
  const files: { filename: string; content: string; content_type?: string }[] = [];
  for (const attachment of pinned) {
    if (!/^[0-9a-f-]{36}$/i.test(attachment.storageKey) || attachment.sizeBytes > MAX_OUTBOUND_ATTACHMENT_BYTES ||
        !SAFE_TYPES.has(attachment.mediaType)) throw new Error("MAIL_ATTACHMENT_UNSAFE");
    const data = await readFile(path.join(dataDirectory, "documents", attachment.storageKey));
    if (data.length !== attachment.sizeBytes || createHash("sha256").update(data).digest("hex") !== attachment.sha256)
      throw new Error("MAIL_ATTACHMENT_INTEGRITY");
    if (await scanWithClamAv(data) !== "limpio") throw new Error("MAIL_ATTACHMENT_SCAN_UNAVAILABLE");
    files.push({ filename: attachment.originalName, content: data.toString("base64"), content_type: attachment.mediaType });
  }
  try {
    const result = await sendResendEmail({
      from: resendFromAddress(settings.senderAlias), to: contact.email,
      replyTo: settings.replyTo, subject: message.subject, text: message.bodyText,
      threadReplyAddress: `${settings.replyTo.split("@")[0]}+${thread.replyToken}@buzon.iesmmg.org`,
      idempotencyKey: `innova-${message.id}`, attachments: files,
    });
    await db.update(mailMessagesTable).set({
      status: "aceptado", providerMessageId: result.id, sentAt: new Date(), retryAt: null,
      lastError: null, revision: message.revision + 1,
    }).where(and(eq(mailMessagesTable.id, messageId), eq(mailMessagesTable.status, "enviando")));
    await db.update(mailThreadsTable).set({ folder: "enviados", updatedAt: new Date() }).where(eq(mailThreadsTable.id, thread.id));
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "RESEND_UNAVAILABLE";
    const statusCode = Number(messageText.match(/^RESEND_HTTP_(\d+)$/)?.[1] ?? 0);
    const transient = statusCode === 408 || statusCode === 409 || statusCode === 429 || statusCode >= 500 || statusCode === 0;
    const attempt = message.attempts;
    const retry = transient && attempt < RETRY_LIMIT;
    await db.update(mailMessagesTable).set({
      status: retry ? "en_cola" : "fallido",
      retryAt: retry ? new Date(Date.now() + Math.min(60, 2 ** attempt) * 60_000) : null,
      attempts: attempt, lastError: statusCode ? `resend_http_${statusCode}` : "resend_temporalmente_no_disponible",
      revision: message.revision + 1,
    }).where(and(eq(mailMessagesTable.id, messageId), eq(mailMessagesTable.status, "enviando")));
    await db.update(mailThreadsTable).set({ folder: retry ? "programadas" : "fallidas_rebotadas", updatedAt: new Date() }).where(eq(mailThreadsTable.id, thread.id));
  }
}

async function savePrivateAttachment(input: {
  centerId: string; schoolYearId: string; messageId: string; filename: string; mediaType: string; downloadUrl: string; size?: number;
}): Promise<void> {
  const reported = Number(input.size ?? 0);
  if (!Number.isSafeInteger(reported) || reported < 0 || reported > MAX_INBOUND_ATTACHMENT_BYTES) {
    await db.insert(mailAttachmentsTable).values({
      centerId: input.centerId, schoolYearId: input.schoolYearId, messageId: input.messageId,
      filename: safeName(input.filename), mediaType: input.mediaType.slice(0, 160),
      sizeBytes: Math.max(0, Math.min(reported || 0, MAX_INBOUND_ATTACHMENT_BYTES)),
      sha256: "", storageKey: randomUUID(), scanStatus: "limite_tamaño",
    });
    return;
  }
  if (!SAFE_TYPES.has(input.mediaType)) {
    await db.insert(mailAttachmentsTable).values({
      centerId: input.centerId, schoolYearId: input.schoolYearId, messageId: input.messageId,
      filename: safeName(input.filename), mediaType: input.mediaType.slice(0, 160),
      sizeBytes: reported, sha256: "", storageKey: randomUUID(), scanStatus: "tipo_no_permitido",
    });
    return;
  }
  const data = await downloadResendAttachment(input.downloadUrl, MAX_INBOUND_ATTACHMENT_BYTES);
  const key = randomUUID();
  const checksum = createHash("sha256").update(data).digest("hex");
  const result = await scanWithClamAv(data);
  await mkdir(privateMailDirectory, { recursive: true, mode: 0o700 });
  const temporary = path.join(privateMailDirectory, `${key}.tmp`);
  const destination = path.join(privateMailDirectory, key);
  try {
    await writeFile(temporary, data, { flag: "wx", mode: 0o600 });
    await rename(temporary, destination);
    try {
      await db.insert(mailAttachmentsTable).values({
        centerId: input.centerId, schoolYearId: input.schoolYearId, messageId: input.messageId,
        filename: safeName(input.filename), mediaType: input.mediaType, sizeBytes: data.length,
        sha256: checksum, storageKey: key, scanStatus: result,
      });
    } catch (error) { await unlink(destination).catch(() => undefined); throw error; }
  } finally { await unlink(temporary).catch(() => undefined); }
}

async function processInboundEvent(eventId: string, providerEmailId: string): Promise<void> {
  if ((await db.select({ id: mailMessagesTable.id }).from(mailMessagesTable)
    .where(eq(mailMessagesTable.providerMessageId, providerEmailId)).limit(1)).length) {
    await db.update(mailWebhookEventsTable).set({ status: "procesado", processedAt: new Date() }).where(eq(mailWebhookEventsTable.id, eventId));
    return;
  }
  const email = await retrieveResendEmail(providerEmailId);
  const from = typeof email.from === "string" ? email.from.slice(0, 320) : "";
  const toList = typeof email.to === "string" ? [email.to.slice(0, 320)]
    : Array.isArray(email.to) ? email.to.filter((v): v is string => typeof v === "string").slice(0, 20) : [];
  const fromAddress = /<([^<>]+)>/.exec(from)?.[1] ?? from;
  const normalizedFrom = fromAddress.trim().toLowerCase();
  const activeYears = await db.select().from(schoolYearsTable).where(and(eq(schoolYearsTable.active, true), isNull(schoolYearsTable.closedAt)));
  if (!activeYears.length || !normalizedFrom.includes("@")) throw new Error("INBOUND_NO_ACTIVE_COURSE");
  const reply = toList.map(v => v.trim().toLowerCase()).map(v => /^(?:innovacion|ciclope|proyectos)\+([0-9a-f-]{36})@buzon\.iesmmg\.org$/i.exec(v))
    .find(Boolean);
  let linkedThread: typeof mailThreadsTable.$inferSelect | undefined;
  if (reply?.[1]) {
    [linkedThread] = await db.select().from(mailThreadsTable).where(eq(mailThreadsTable.replyToken, reply[1]));
    if (linkedThread && !activeYears.some(y => y.id === linkedThread!.schoolYearId && y.centerId === linkedThread!.centerId))
      throw new Error("INBOUND_COURSE_CLOSED");
  }
  const year = linkedThread ? activeYears.find(y => y.id === linkedThread!.schoolYearId)
    : activeYears.length === 1 ? activeYears[0] : undefined;
  if (!year) throw new Error("INBOUND_CENTER_AMBIGUOUS");
  const contact = (await db.select().from(mailContactsTable).where(and(
    eq(mailContactsTable.emailKey, normalizedFrom), eq(mailContactsTable.schoolYearId, year.id),
    eq(mailContactsTable.centerId, year.centerId),
  )))[0];
  const messageId = typeof email.message_id === "string" ? email.message_id.slice(0, 998) : null;
  const subject = typeof email.subject === "string" ? email.subject.slice(0, 250) : "(sin asunto)";
  const text = typeof email.text === "string" ? email.text.slice(0, 50000)
    : typeof email.html === "string" ? plainText(email.html) : "";
  const headers = email.headers && typeof email.headers === "object" ? email.headers as Record<string, unknown> : {};
  const refs = [headers["in-reply-to"], headers.references].filter((v): v is string => typeof v === "string").join(" ").slice(0, 2000);
  let thread = linkedThread;
  let inbound;
  if (thread) {
    const [created] = await db.insert(mailMessagesTable).values({
      centerId: thread.centerId, schoolYearId: thread.schoolYearId, threadId: thread.id,
      contactId: contact?.id ?? thread.contactId, direction: "entrante", status: "recibido",
      sender: normalizedFrom, recipient: toList[0] ?? "", senderName: from.slice(0, 250),
      subject, bodyText: text, classification: "organizativa", inReplyTo: refs, messageId,
      providerMessageId: providerEmailId, createdBy: null, eventMetadata: { attachmentsPending: true },
    }).returning();
    inbound = created;
    await db.update(mailThreadsTable).set({ folder: "entrada", updatedAt: new Date() }).where(eq(mailThreadsTable.id, thread.id));
  } else {
    const conversationKey = createHash("sha256").update(messageId ?? providerEmailId).digest("hex");
    const [createdThread] = await db.insert(mailThreadsTable).values({
      centerId: year.centerId, schoolYearId: year.id, contactId: contact?.id ?? null,
      conversationKey, replyToken: randomUUID(), subject, folder: "entrada",
      createdBy: contact?.createdBy ?? null,
    }).onConflictDoNothing().returning();
    thread = createdThread ?? (await db.select().from(mailThreadsTable).where(and(
      eq(mailThreadsTable.schoolYearId, year.id), eq(mailThreadsTable.conversationKey, conversationKey),
    )))[0];
    if (!thread) throw new Error("INBOUND_THREAD_CONFLICT");
    const [created] = await db.insert(mailMessagesTable).values({
      centerId: year.centerId, schoolYearId: year.id, threadId: thread.id,
      contactId: contact?.id ?? null, direction: "entrante", status: "recibido",
      sender: normalizedFrom, recipient: toList[0] ?? "", senderName: from.slice(0, 250),
      subject, bodyText: text, classification: "organizativa", inReplyTo: refs, messageId,
      providerMessageId: providerEmailId, createdBy: null, eventMetadata: { attachmentsPending: true },
    }).returning();
    inbound = created;
  }
  if (Array.isArray(email.attachments)) {
    for (const raw of email.attachments.slice(0, 10)) {
      const item = raw as Record<string, unknown>;
      if (typeof item.download_url !== "string" || typeof item.filename !== "string") continue;
      await savePrivateAttachment({
        centerId: thread.centerId, schoolYearId: thread.schoolYearId, messageId: inbound.id,
        filename: item.filename, mediaType: typeof item.content_type === "string" ? item.content_type : "application/octet-stream",
        downloadUrl: item.download_url, size: typeof item.size === "number" ? item.size : 0,
      });
    }
  } else {
    const attachments = await listResendReceivedAttachments(providerEmailId);
    for (const raw of attachments.slice(0, 10)) {
      if (typeof raw.download_url !== "string" || typeof raw.filename !== "string") continue;
      await savePrivateAttachment({
        centerId: thread.centerId, schoolYearId: thread.schoolYearId, messageId: inbound.id,
        filename: raw.filename, mediaType: typeof raw.content_type === "string" ? raw.content_type : "application/octet-stream",
        downloadUrl: raw.download_url, size: typeof raw.size === "number" ? raw.size : 0,
      });
    }
  }
  await db.update(mailWebhookEventsTable).set({ status: "procesado", processedAt: new Date(), lastError: null }).where(eq(mailWebhookEventsTable.id, eventId));
}

async function processOneWebhook(): Promise<boolean> {
  const result = await db.transaction(async tx => {
    const [event] = await tx.select().from(mailWebhookEventsTable)
      .where(and(eq(mailWebhookEventsTable.status, "pendiente"),
        or(isNull(mailWebhookEventsTable.retryAt), lte(mailWebhookEventsTable.retryAt, new Date()))))
      .orderBy(mailWebhookEventsTable.receivedAt).limit(1).for("update", { skipLocked: true });
    if (!event) return null;
    await tx.update(mailWebhookEventsTable).set({ status: "procesando", attempts: event.attempts + 1 }).where(eq(mailWebhookEventsTable.id, event.id));
    return event;
  });
  if (!result) return false;
  try {
    if (result.eventType === "email.received") {
      if (!resendConfigured() || !result.providerMessageId) throw new Error("RECEIVE_PROVIDER_NOT_CONFIGURED");
      await processInboundEvent(result.id, result.providerMessageId);
    } else if (result.providerMessageId) {
      const terminal = new Map([
        ["email.delivered", "entregado"], ["email.bounced", "rebotado"],
        ["email.complained", "reclamacion"], ["email.failed", "fallido"],
      ]);
      const status = terminal.get(result.eventType);
      if (status) {
        const [message] = await db.select().from(mailMessagesTable).where(eq(mailMessagesTable.providerMessageId, result.providerMessageId));
        if (message) {
          await db.update(mailMessagesTable).set({
            status, deliveredAt: status === "entregado" ? new Date() : message.deliveredAt,
            revision: message.revision + 1, eventMetadata: { ...message.eventMetadata as object, lastProviderEvent: result.eventType },
          }).where(eq(mailMessagesTable.id, message.id));
          if (status === "rebotado" || status === "reclamacion") {
            if (message.contactId) await db.update(mailContactsTable).set({
              ...(status === "reclamacion" ? { optOut: true } : { active: false }), updatedAt: new Date(),
            }).where(eq(mailContactsTable.id, message.contactId));
            await db.update(mailThreadsTable).set({ folder: "fallidas_rebotadas", updatedAt: new Date() })
              .where(eq(mailThreadsTable.id, message.threadId));
          } else if (status === "entregado") {
            await db.update(mailThreadsTable).set({ folder: "enviadas", updatedAt: new Date() })
              .where(eq(mailThreadsTable.id, message.threadId));
          }
        }
      }
      await db.update(mailWebhookEventsTable).set({ status: "procesado", processedAt: new Date() })
        .where(eq(mailWebhookEventsTable.id, result.id));
    } else {
      await db.update(mailWebhookEventsTable).set({ status: "procesado", processedAt: new Date() })
        .where(eq(mailWebhookEventsTable.id, result.id));
    }
  } catch (error) {
    const attempts = result.attempts + 1;
    await db.update(mailWebhookEventsTable).set({
      status: attempts >= 8 ? "fallido" : "pendiente",
      retryAt: attempts >= 8 ? null : new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000),
      lastError: error instanceof Error ? error.message.slice(0, 80) : "error_de_procesamiento",
    }).where(eq(mailWebhookEventsTable.id, result.id));
  }
  return true;
}

async function claimQueued(): Promise<string | null> {
  return db.transaction(async tx => {
    const [row] = await tx.select({ message: mailMessagesTable.id }).from(mailMessagesTable)
      .innerJoin(mailThreadsTable, eq(mailThreadsTable.id, mailMessagesTable.threadId))
      .innerJoin(schoolYearsTable, and(eq(schoolYearsTable.id, mailMessagesTable.schoolYearId),
        eq(schoolYearsTable.centerId, mailMessagesTable.centerId), eq(schoolYearsTable.active, true), isNull(schoolYearsTable.closedAt)))
      .innerJoin(mailSettingsTable, and(eq(mailSettingsTable.centerId, mailMessagesTable.centerId), eq(mailSettingsTable.sendEnabled, true)))
      .where(and(inArray(mailMessagesTable.status, ["en_cola", "programado"]),
        or(isNull(mailMessagesTable.retryAt), lte(mailMessagesTable.retryAt, new Date())),
        or(isNull(mailMessagesTable.scheduledAt), lte(mailMessagesTable.scheduledAt, new Date()))))
      .orderBy(mailMessagesTable.createdAt).limit(1).for("update", { of: mailMessagesTable, skipLocked: true });
    if (!row) return null;
    await tx.update(mailMessagesTable).set({
      status: "enviando", attempts: sql`${mailMessagesTable.attempts} + 1`,
      lastError: null, revision: sql`${mailMessagesTable.revision} + 1`,
    }).where(and(eq(mailMessagesTable.id, row.message), inArray(mailMessagesTable.status, ["en_cola", "programado"])));
    return row.message;
  });
}

async function runOnce(): Promise<void> {
  if (activeRun) return;
  activeRun = true;
  try {
    for (let i = 0; i < 5 && resendConfigured(); i++) {
      if (!(await processOneWebhook())) break;
    }
    if (!mailSendEnabled() || !resendConfigured()) return;
    for (let i = 0; i < 5; i++) {
      const id = await claimQueued();
      if (!id) break;
      try { await sendQueuedMessage(id); }
      catch (error) {
        const code = error instanceof Error ? error.message.slice(0, 80) : "MAIL_WORKER_ERROR";
        await db.update(mailMessagesTable).set({
          status: "fallido", retryAt: null, lastError: code,
        }).where(and(eq(mailMessagesTable.id, id), eq(mailMessagesTable.status, "enviando")));
        logger.error({ code, messageId: id }, "Mail queue item failed");
      }
    }
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 100) : "MAIL_WORKER_ERROR";
    logger.error({ code }, "Mail worker iteration failed");
  } finally { activeRun = false; }
}

export function startMailWorker(): void {
  if (workerStarted) return;
  workerStarted = true;
  const timer = setInterval(() => { void runOnce(); }, 5000);
  timer.unref();
}


import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Router, type RequestHandler, type Response } from "express";
import {
  auditLogsTable, db, mailAttachmentsTable,
  mailContactsTable, mailMessagesTable, mailSettingsTable, mailTemplatesTable,
  mailThreadsTable, mailWebhookEventsTable, schoolYearsTable, usersTable,
} from "@workspace/db";
import {
  AssignMailThreadBody, CreateMailContactBody, CreateMailDraftBody,
  CreateMailTemplateBody, ReplyToMailThreadBody, UpdateAdminMailSettingsBody, UpdateMailContactBody, UpdateMailDraftBody, UpdateMailTemplateBody,
} from "@workspace/api-zod";
import { requireAuth, requireCsrf, type AuthContext } from "../lib/auth";
import { privateMailDirectory, storedAttachments } from "../lib/mail-worker";
import { scanWithClamAv } from "../lib/clamav";
import { loadActiveSchoolYear, loadCaptureActor, type CaptureActor } from "../lib/capture-scope";
import { checkResendDomain, mailSendEnabled, resendConfigured, resendFromAddress, verifyResendSignature } from "../lib/mail-provider";
import { logger } from "../lib/logger";

const router = Router();
const SENDER_ALIASES = new Set(["innovacion", "ciclope", "proyectos"]);
const CLASSIFICATIONS = new Set(["obligatoria", "organizativa", "informativa", "difusion"]);
const SEGMENTS = new Set(["direccion", "jefatura", "profesorado", "empresa", "coordinacion_c1", "centro", "familia", "otro"]);

class MailFailure extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type MailIdentity = { auth: AuthContext; actor: CaptureActor };
type MailContext = MailIdentity & { year: NonNullable<Awaited<ReturnType<typeof loadActiveSchoolYear>>> };
type MailRequest = Parameters<RequestHandler>[0];
type MailResponse = Response & { locals: { auth?: AuthContext } };
type PinnedFile = { documentId: string; title: string; storageKey: string; version: number; sha256: string; originalName: string; mediaType: string; sizeBytes: number };

function routeId(req: MailRequest, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function manager(actor: CaptureActor): boolean {
  return ["admin_tecnico", "c2_innovacion", "equipo_directivo"].includes(actor.role);
}
function editor(actor: CaptureActor): boolean {
  return manager(actor);
}
function approver(actor: CaptureActor): boolean {
  return actor.role === "admin_tecnico" || actor.role === "equipo_directivo";
}
function needTechnicalAdmin(context: MailIdentity): void {
  if (context.actor.role !== "admin_tecnico") throw new MailFailure(403, "La configuración del proveedor corresponde a administración técnica.");
}
function responseError(res: Response, error: unknown): void {
  if (error instanceof MailFailure) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  const value = error as { code?: string; cause?: { code?: string } };
  const code = value?.cause?.code ?? value?.code ?? "";
  if (code === "23505") {
    res.status(409).json({ error: "Ya existe un registro con esos datos en este curso." });
    return;
  }
  if (String(code).startsWith("COURSE_")) {
    res.status(409).json({ error: "El curso está cerrado. Actualiza la vista; el expediente histórico no se puede modificar." });
    return;
  }
  logger.error({ code: String(code).slice(0, 80) }, "Communications request failed");
  res.status(500).json({ error: "No se pudo completar la operación de comunicaciones." });
}
function endpoint(fn: (req: MailRequest, res: MailResponse) => Promise<void>): RequestHandler {
  return async (req, res, next) => {
    try { await fn(req, res as MailResponse); } catch (error) { responseError(res, error); }
  };
}
async function getIdentity(res: MailResponse): Promise<MailIdentity> {
  const auth = res.locals.auth;
  if (!auth) throw new MailFailure(401, "Inicia sesión para acceder a comunicaciones.");
  const actor = await loadCaptureActor(auth.user.id);
  if (!actor) throw new MailFailure(403, "La cuenta no tiene acceso a un centro activo.");
  return { auth, actor };
}
async function getContext(res: MailResponse): Promise<MailContext> {
  const identity = await getIdentity(res);
  const actor = identity.actor;
  const year = await loadActiveSchoolYear(actor.centerId);
  if (!year) throw new MailFailure(409, "No hay un curso activo para la bandeja de comunicaciones.");
  return { ...identity, year };
}
function needManager(context: MailContext): void {
  if (!manager(context.actor)) throw new MailFailure(403, "Esta bandeja institucional no está autorizada para tu perfil.");
}
function needEditor(context: MailContext): void {
  if (!editor(context.actor)) throw new MailFailure(403, "La gestión de contactos y borradores corresponde al C2.");
}
function needApprover(context: MailContext): void {
  if (!approver(context.actor)) throw new MailFailure(403, "Se requiere aprobación del equipo directivo o administración técnica.");
}
async function currentSettings(centerId: string) {
  const [existing] = await db.select().from(mailSettingsTable).where(eq(mailSettingsTable.centerId, centerId));
  if (existing) return existing;
  const [created] = await db.insert(mailSettingsTable).values({ centerId }).onConflictDoNothing().returning();
  if (created) return created;
  const [raced] = await db.select().from(mailSettingsTable).where(eq(mailSettingsTable.centerId, centerId));
  if (!raced) throw new Error("MAIL_SETTINGS_INIT_FAILED");
  return raced;
}
function providerView(): { keyConfigured: boolean; webhookConfigured: boolean; deploymentEnabled: boolean; domain: string; domainVerified: boolean; domainStatus: string; records: Array<{ type: string; name: string; value: string; status: string; priority?: number | null }> } {
  return {
    keyConfigured: resendConfigured(), webhookConfigured: Boolean(process.env.RESEND_WEBHOOK_SECRET),
    deploymentEnabled: mailSendEnabled(), domain: "iesmmg.org", domainVerified: false,
    domainStatus: resendConfigured() ? "pendiente_de_comprobar" : "sin_clave_privada",
    records: [],
  };
}
function emailSettingsView(settings: typeof mailSettingsTable.$inferSelect, centerId: string) {
  return {
    centerId, sendEnabled: settings.sendEnabled, revision: settings.revision, senderAlias: settings.senderAlias,
    replyTo: settings.replyTo, sendApprovalRequired: true as const,
  };
}
function publicContact(row: typeof mailContactsTable.$inferSelect) {
  return {
    id: row.id, email: row.email, displayName: row.displayName, segment: row.segment,
    professionalFamily: row.professionalFamily, institution: row.institution,
    authorizationNote: row.authorizationNote, optOut: row.optOut, active: row.active,
  };
}
function publicTemplate(row: typeof mailTemplatesTable.$inferSelect) {
  return { id: row.id, name: row.name, subject: row.subject, body: row.body, classification: row.classification, updatedAt: row.updatedAt.toISOString() };
}
function publicAttachments(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(raw => {
    const item = raw as Record<string, unknown>;
    return {
      ...(typeof item.id === "string" ? { id: item.id } : {}),
      ...(typeof item.documentId === "string" ? { documentId: item.documentId } : {}),
      ...(typeof item.title === "string" ? { title: item.title } : {}),
      filename: typeof item.filename === "string" ? item.filename : typeof item.originalName === "string" ? item.originalName : "adjunto",
      mediaType: typeof item.mediaType === "string" ? item.mediaType : "application/octet-stream",
      sizeBytes: typeof item.sizeBytes === "number" ? item.sizeBytes : 0,
      sha256: typeof item.sha256 === "string" ? item.sha256 : "",
      status: typeof item.scanStatus === "string" ? item.scanStatus : "limpio",
    };
  });
}
function publicMessage(row: typeof mailMessagesTable.$inferSelect) {
  return {
    id: row.id, direction: row.direction, status: row.status, sender: row.sender,
    recipient: row.recipient, senderName: row.senderName, cc: row.cc, replyTo: row.replyTo,
    subject: row.subject, bodyText: row.bodyText, classification: row.classification,
    approvedBy: row.approvedBy, approvedAt: row.approvedAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null, deliveredAt: row.deliveredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(), revision: row.revision, attempts: row.attempts,
    lastError: row.lastError, attachments: publicAttachments(row.attachmentSnapshot),
    createdBy: row.createdBy,
  };
}
async function assertThreadAccess(context: MailContext, threadId: string) {
  const [thread] = await db.select().from(mailThreadsTable).where(and(
    eq(mailThreadsTable.id, threadId), eq(mailThreadsTable.centerId, context.actor.centerId),
    eq(mailThreadsTable.schoolYearId, context.year.id),
  ));
  if (!thread) throw new MailFailure(404, "No se encontró el hilo autorizado.");
  if (!manager(context.actor) && thread.assignedTo !== context.actor.id && thread.createdBy !== context.actor.id)
    throw new MailFailure(404, "No se encontró el hilo autorizado.");
  return thread;
}
async function getThreadSummary(thread: typeof mailThreadsTable.$inferSelect) {
  const [contact] = thread.contactId ? await db.select().from(mailContactsTable).where(eq(mailContactsTable.id, thread.contactId)) : [];
  const [last] = await db.select().from(mailMessagesTable).where(eq(mailMessagesTable.threadId, thread.id))
    .orderBy(desc(mailMessagesTable.createdAt)).limit(1);
  return {
    id: thread.id, subject: thread.subject, topic: thread.topic, priority: thread.priority,
    folder: thread.folder, assignedTo: thread.assignedTo,
    contactName: contact?.displayName ?? last?.senderName ?? last?.sender ?? last?.recipient ?? "Contacto externo",
    contactEmail: contact?.email ?? last?.sender ?? last?.recipient ?? "",
    updatedAt: thread.updatedAt.toISOString(), revision: thread.revision, lastStatus: last?.status ?? "sin_mensajes",
    preview: (last?.bodyText ?? "").slice(0, 180),
  };
}
async function recordAudit(context: MailIdentity, action: string, type: string, id: string, details: Record<string, unknown> = {}) {
  await db.insert(auditLogsTable).values({
    userId: context.actor.id, action, entityType: type, entityId: id, details,
  });
}

router.post("/webhooks/resend", endpoint(async (req, res) => {
  const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
  const valid = verifyResendSignature({
    rawBody, id: req.header("svix-id"), timestamp: req.header("svix-timestamp"),
    signature: req.header("svix-signature"), secret: process.env.RESEND_WEBHOOK_SECRET,
  });
  if (!valid) throw new MailFailure(process.env.RESEND_WEBHOOK_SECRET ? 401 : 503, "No se pudo autenticar el webhook de Resend.");
  const payload = req.body as { type?: unknown; data?: Record<string, unknown> };
  if (typeof payload?.type !== "string" || !/^email\.(received|delivered|bounced|complained|failed)$/.test(payload.type) || !payload.data)
    throw new MailFailure(400, "El tipo de evento Resend no está admitido.");
  const providerMessageId = payload.data.email_id ?? payload.data.id;
  const cleanId = typeof providerMessageId === "string" && providerMessageId.length <= 200 ? providerMessageId : null;
  const eventId = req.header("svix-id")!;
  const hash = createHash("sha256").update(rawBody!).digest("hex");
  const [created] = await db.insert(mailWebhookEventsTable).values({
    providerEventId: eventId, eventType: payload.type, providerMessageId: cleanId, payloadHash: hash,
  }).onConflictDoNothing().returning({ id: mailWebhookEventsTable.id });
  res.status(200).json({ received: true, duplicate: !created });
}));

router.get("/mail/overview", requireAuth, endpoint(async (_req, res) => {
  const context = await getContext(res);
  const settings = await currentSettings(context.actor.centerId);
  const allThreads = await db.select().from(mailThreadsTable).where(and(
    eq(mailThreadsTable.centerId, context.actor.centerId), eq(mailThreadsTable.schoolYearId, context.year.id),
  )).orderBy(desc(mailThreadsTable.updatedAt)).limit(100);
  const visibleThreads = allThreads.filter(t => manager(context.actor) || t.assignedTo === context.actor.id || t.createdBy === context.actor.id);
  const [contacts, templates] = manager(context.actor) ? await Promise.all([
    db.select().from(mailContactsTable).where(and(eq(mailContactsTable.centerId, context.actor.centerId), eq(mailContactsTable.schoolYearId, context.year.id))).orderBy(mailContactsTable.displayName),
    db.select().from(mailTemplatesTable).where(and(eq(mailTemplatesTable.centerId, context.actor.centerId), eq(mailTemplatesTable.schoolYearId, context.year.id))).orderBy(mailTemplatesTable.name),
  ]) : [[], []];
  res.json({
    yearLabel: context.year.label, canManage: editor(context.actor), canApprove: approver(context.actor),
    settings: emailSettingsView(settings, context.actor.centerId), provider: providerView(),
    contacts: contacts.map(publicContact), templates: templates.map(publicTemplate),
    threads: await Promise.all(visibleThreads.map(getThreadSummary)),
  });
}));

router.get("/mail/threads/:threadId", requireAuth, endpoint(async (req, res) => {
  const context = await getContext(res);
  const thread = await assertThreadAccess(context, routeId(req, "threadId"));
  const messages = await db.select().from(mailMessagesTable).where(eq(mailMessagesTable.threadId, thread.id)).orderBy(mailMessagesTable.createdAt);
  const messageIds = messages.map(m => m.id);
  const attachments = messageIds.length ? await db.select().from(mailAttachmentsTable).where(inArray(mailAttachmentsTable.messageId, messageIds)) : [];
  await recordAudit(context, "mail.thread.read", "mail_thread", thread.id);
  res.json({
    thread: await getThreadSummary(thread),
    messages: messages.map(message => ({
      ...publicMessage(message),
      attachments: [
        ...publicAttachments(message.attachmentSnapshot),
        ...attachments.filter(a => a.messageId === message.id).map(publicAttachments).flat(),
      ],
    })),
  });
}));

router.post("/mail/threads/:threadId/reply", requireAuth, requireCsrf, endpoint(async (req, res) => {
  const context = await getContext(res);
  const parsed = ReplyToMailThreadBody.safeParse(req.body);
  if (!parsed.success || !CLASSIFICATIONS.has(parsed.data?.classification))
    throw new MailFailure(400, "La respuesta no cumple los límites o contiene datos no válidos.");
  const thread = await assertThreadAccess(context, routeId(req, "threadId"));
  if (!manager(context.actor) && thread.assignedTo !== context.actor.id)
    throw new MailFailure(403, "Solo el equipo de gestión o la persona asignada pueden responder en este hilo.");
  if (thread.folder === "archivada" || thread.folder === "spam") throw new MailFailure(409, "Recupera el hilo antes de responder.");
  const [contact] = thread.contactId ? await db.select().from(mailContactsTable).where(and(
    eq(mailContactsTable.id, thread.contactId), eq(mailContactsTable.centerId, context.actor.centerId),
    eq(mailContactsTable.schoolYearId, context.year.id), eq(mailContactsTable.active, true),
  )) : [];
  if (!contact) throw new MailFailure(409, "Asocia primero un contacto autorizado para poder responder a este hilo.");
  const [latestIncoming] = await db.select({ sender: mailMessagesTable.sender }).from(mailMessagesTable).where(and(
    eq(mailMessagesTable.threadId, thread.id), eq(mailMessagesTable.direction, "entrante"),
  )).orderBy(desc(mailMessagesTable.createdAt)).limit(1);
  if (latestIncoming && latestIncoming.sender.trim().toLowerCase() !== contact.emailKey)
    throw new MailFailure(409, "El remitente más reciente no coincide con el contacto autorizado. Revisa y actualiza la agenda antes de responder.");
  if (parsed.data.classification !== "obligatoria" && contact.optOut)
    throw new MailFailure(409, "El contacto ha solicitado no recibir comunicaciones no obligatorias.");
  let attachments: PinnedFile[];
  try { attachments = await storedAttachments(parsed.data.attachmentDocumentIds, context.year.id, context.actor.centerId); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("MAIL_ATTACHMENT_"))
      throw new MailFailure(400, "Los adjuntos deben ser versiones vigentes aprobadas y limpias, de un tipo admitido y menores de 10 MB.");
    throw error;
  }
  const settings = await currentSettings(context.actor.centerId);
  const [message] = await db.insert(mailMessagesTable).values({
    centerId: context.actor.centerId, schoolYearId: context.year.id, threadId: thread.id,
    contactId: contact.id, direction: "saliente", status: "borrador",
    sender: resendFromAddress(settings.senderAlias), replyTo: settings.replyTo, recipient: contact.email,
    subject: /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`,
    bodyText: parsed.data.bodyText.trim(), classification: parsed.data.classification,
    attachmentSnapshot: attachments, createdBy: context.actor.id,
    eventMetadata: { individualDelivery: true, replyToExistingThread: true },
  }).returning();
  await db.update(mailThreadsTable).set({
    folder: "borradores", revision: thread.revision + 1, updatedAt: new Date(),
  }).where(and(eq(mailThreadsTable.id, thread.id), eq(mailThreadsTable.revision, thread.revision)));
  await recordAudit(context, "mail.thread.reply.draft", "mail_message", message.id);
  res.status(201).json(publicMessage(message));
}));

router.get("/admin/mail/provider-status", requireAuth, endpoint(async (_req, res) => {
  const context = await getIdentity(res); needTechnicalAdmin(context);
  const settings = await currentSettings(context.actor.centerId);
  res.json({
    settings: emailSettingsView(settings, context.actor.centerId), provider: providerView(),
    lastDomainCheck: settings.lastDomainCheck?.toISOString() ?? null,
    lastDomainStatus: settings.lastDomainStatus,
    domainRecords: settings.domainRecords,
  });
}));

router.post("/admin/mail/provider-status/verify", requireAuth, requireCsrf, endpoint(async (_req, res) => {
  const context = await getIdentity(res); needTechnicalAdmin(context);
  const settings = await currentSettings(context.actor.centerId);
  let domain;
  try { domain = await checkResendDomain(); }
  catch { throw new MailFailure(503, "Resend no está disponible o no se pudo consultar su estado. No se modificó el DNS."); }
  const [updated] = await db.update(mailSettingsTable).set({
    revision: settings.revision + 1, lastDomainStatus: domain.status,
    lastDomainCheck: new Date(), domainRecords: domain.records, updatedBy: context.actor.id, updatedAt: new Date(),
  }).where(and(eq(mailSettingsTable.id, settings.id), eq(mailSettingsTable.revision, settings.revision))).returning();
  if (!updated) throw new MailFailure(409, "La configuración cambió en otra sesión. Vuelve a consultar.");
  const [fresh] = await db.select().from(mailSettingsTable).where(eq(mailSettingsTable.id, settings.id));
  res.json({
    settings: emailSettingsView(fresh, context.actor.centerId), provider: { ...providerView(), domainVerified: domain.verified, domainStatus: domain.status, records: domain.records },
    lastDomainCheck: fresh.lastDomainCheck?.toISOString() ?? null,
    lastDomainStatus: fresh.lastDomainStatus, domainRecords: fresh.domainRecords,
  });
}));

router.put("/admin/mail/settings", requireAuth, requireCsrf, endpoint(async (req, res) => {
  const context = await getIdentity(res); needTechnicalAdmin(context);
  const parsed = UpdateAdminMailSettingsBody.safeParse(req.body);
  if (!parsed.success) throw new MailFailure(400, "La configuración de comunicaciones no es válida.");
  const input = parsed.data;
  if (!SENDER_ALIASES.has(input.senderAlias) || !/^[a-z][a-z0-9._-]{0,40}@buzon\.iesmmg\.org$/i.test(input.replyTo))
    throw new MailFailure(400, "El remitente o el Reply-To no pertenecen a los alias institucionales admitidos.");
  const existing = await currentSettings(context.actor.centerId);
  if (existing.revision !== input.expectedRevision) throw new MailFailure(409, "La configuración cambió. Actualiza la página.");
  let status = existing.lastDomainStatus;
  let records = existing.domainRecords;
  let lastDomainCheck = existing.lastDomainCheck;
  if (input.sendEnabled) {
    if (!mailSendEnabled() || !resendConfigured())
      throw new MailFailure(409, "El envío sigue desactivado por la configuración segura del servidor.");
    let check;
    try { check = await checkResendDomain(); }
    catch { throw new MailFailure(503, "No se pudo comprobar iesmmg.org en Resend."); }
    status = check.status; records = check.records; lastDomainCheck = new Date();
    if (!check.verified) throw new MailFailure(409, "No se puede activar el envío: Resend aún no confirma iesmmg.org. El DNS no se ha modificado.");
  }
  const [updated] = await db.update(mailSettingsTable).set({
    revision: existing.revision + 1, sendEnabled: input.sendEnabled,
    senderAlias: input.senderAlias, replyTo: input.replyTo,
    sendApprovalRequired: true, lastDomainStatus: status, domainRecords: records,
    lastDomainCheck, updatedBy: context.actor.id, updatedAt: new Date(),
  }).where(and(eq(mailSettingsTable.id, existing.id), eq(mailSettingsTable.revision, input.expectedRevision))).returning();
  if (!updated) throw new MailFailure(409, "La configuración cambió en otra sesión. Actualiza la página.");
  await recordAudit(context, "mail.settings.update", "mail_settings", updated.id, { sendEnabled: updated.sendEnabled, senderAlias: updated.senderAlias });
  const [fresh] = await db.select().from(mailSettingsTable).where(eq(mailSettingsTable.id, updated.id));
  res.json({
    settings: emailSettingsView(fresh, context.actor.centerId), provider: providerView(),
    lastDomainCheck: fresh.lastDomainCheck?.toISOString() ?? null,
    lastDomainStatus: fresh.lastDomainStatus, domainRecords: fresh.domainRecords,
  });
}));

router.post("/mail/contacts", requireAuth, requireCsrf, endpoint(async (req, res) => {
  const context = await getContext(res); needEditor(context);
  const parsed = CreateMailContactBody.safeParse(req.body);
  if (!parsed.success) throw new MailFailure(400, "Los datos del contacto no son válidos.");
  const input = parsed.data;
  const email = input.email.trim().toLowerCase();
  if (!SEGMENTS.has(input.segment) || !email.includes("@") || input.authorizationNote.trim().length < 4)
    throw new MailFailure(400, "Registra el segmento y la base institucional antes de guardar el contacto.");
  const [row] = await db.insert(mailContactsTable).values({
    centerId: context.actor.centerId, schoolYearId: context.year.id,
    email, emailKey: email, displayName: input.displayName.trim(), segment: input.segment,
    professionalFamily: input.professionalFamily?.trim() || null, institution: input.institution?.trim() || null,
    authorizationNote: input.authorizationNote.trim(), optOut: input.optOut, active: input.active, createdBy: context.actor.id,
  }).onConflictDoNothing().returning();
  if (!row) throw new MailFailure(409, "Ya existe este correo en la agenda del curso.");
  await recordAudit(context, "mail.contact.create", "mail_contact", row.id, { segment: row.segment });
  res.status(201).json(publicContact(row));
}));

router.patch("/mail/contacts/:contactId", requireAuth, requireCsrf, endpoint(async (req, res) => {
  const context = await getContext(res); needEditor(context);
  const parsed = UpdateMailContactBody.safeParse(req.body);
  if (!parsed.success) throw new MailFailure(400, "Los datos del contacto no son válidos.");
  const input = parsed.data; const email = input.email.trim().toLowerCase();
  if (!SEGMENTS.has(input.segment) || input.authorizationNote.trim().length < 4)
    throw new MailFailure(400, "El contacto necesita segmento y referencia de autorización.");
  const [row] = await db.update(mailContactsTable).set({
    email, emailKey: email, displayName: input.displayName.trim(), segment: input.segment,
    professionalFamily: input.professionalFamily?.trim() || null, institution: input.institution?.trim() || null,
    authorizationNote: input.authorizationNote.trim(), optOut: input.optOut, active: input.active, updatedAt: new Date(),
  }).where(and(eq(mailContactsTable.id, routeId(req, "contactId")), eq(mailContactsTable.centerId, context.actor.centerId),
    eq(mailContactsTable.schoolYearId, context.year.id))).returning();
  if (!row) throw new MailFailure(404, "No se encontró el contacto de este centro y curso.");
  await recordAudit(context, "mail.contact.update", "mail_contact", row.id, { optOut: row.optOut, active: row.active });
  res.json(publicContact(row));
}));

router.post("/mail/templates", requireAuth, requireCsrf, endpoint(async (req, res) => {
  const context = await getContext(res); needEditor(context);
  const parsed = CreateMailTemplateBody.safeParse(req.body);
  if (!parsed.success || !CLASSIFICATIONS.has(parsed.data?.classification)) throw new MailFailure(400, "La plantilla no cumple los límites de tamaño o clasificación.");
  const input = parsed.data;
  const [row] = await db.insert(mailTemplatesTable).values({
    centerId: context.actor.centerId, schoolYearId: context.year.id, createdBy: context.actor.id,
    name: input.name.trim(), subject: input.subject.trim(), body: input.body, classification: input.classification,
  }).returning();
  await recordAudit(context, "mail.template.create", "mail_template", row.id);
  res.status(201).json(publicTemplate(row));
}));

router.patch("/mail/templates/:templateId", requireAuth, requireCsrf, endpoint(async (req, res) => {
  const context = await getContext(res); needEditor(context);
  const parsed = UpdateMailTemplateBody.safeParse(req.body);
  if (!parsed.success || !CLASSIFICATIONS.has(parsed.data?.classification)) throw new MailFailure(400, "La plantilla no cumple los límites de tamaño o clasificación.");
  const input = parsed.data;
  const [row] = await db.update(mailTemplatesTable).set({
    name: input.name.trim(), subject: input.subject.trim(), body: input.body, classification: input.classification, updatedAt: new Date(),
  }).where(and(eq(mailTemplatesTable.id, routeId(req, "templateId")), eq(mailTemplatesTable.centerId, context.actor.centerId),
    eq(mailTemplatesTable.schoolYearId, context.year.id))).returning();
  if (!row) throw new MailFailure(404, "No se encontró la plantilla de este centro y curso.");
  await recordAudit(context, "mail.template.update", "mail_template", row.id);
  res.json(publicTemplate(row));
}));

router.post("/mail/drafts", requireAuth, requireCsrf, endpoint(async (req, res) => {
  const context = await getContext(res); needEditor(context);
  const parsed = CreateMailDraftBody.safeParse(req.body);
  if (!parsed.success || !CLASSIFICATIONS.has(parsed.data?.classification)) throw new MailFailure(400, "El borrador supera los límites o contiene datos no válidos.");
  const input = parsed.data;
  const ids = [...new Set(input.recipientContactIds)];
  if (!ids.length || ids.length > 50) throw new MailFailure(400, "Selecciona entre 1 y 50 destinatarios autorizados.");
  const contacts = await db.select().from(mailContactsTable).where(and(
    eq(mailContactsTable.centerId, context.actor.centerId), eq(mailContactsTable.schoolYearId, context.year.id),
    inArray(mailContactsTable.id, ids), eq(mailContactsTable.active, true),
  ));
  if (contacts.length !== ids.length) throw new MailFailure(400, "Incluye únicamente contactos activos del centro y curso.");
  if (input.classification !== "obligatoria" && contacts.some(c => c.optOut))
    throw new MailFailure(409, "Alguno de los destinatarios ha solicitado no recibir comunicaciones no obligatorias.");
  if (input.templateId && !(await db.select({ id: mailTemplatesTable.id }).from(mailTemplatesTable).where(and(
    eq(mailTemplatesTable.id, input.templateId), eq(mailTemplatesTable.centerId, context.actor.centerId),
    eq(mailTemplatesTable.schoolYearId, context.year.id),
  ))).length) throw new MailFailure(400, "La plantilla no pertenece al curso activo.");
  let attachments: PinnedFile[];
  try { attachments = await storedAttachments(input.attachmentDocumentIds, context.year.id, context.actor.centerId); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("MAIL_ATTACHMENT_"))
      throw new MailFailure(400, "Solo se pueden adjuntar versiones vigentes aprobadas, limpias, seguras y menores de 10 MB.");
    throw error;
  }
  const settings = await currentSettings(context.actor.centerId);
  const created: typeof mailMessagesTable.$inferSelect[] = [];
  for (const contact of contacts) {
    const conversationKey = randomUUID();
    const threadId = randomUUID();
    await db.transaction(async tx => {
      const [thread] = await tx.insert(mailThreadsTable).values({
        id: threadId, centerId: context.actor.centerId, schoolYearId: context.year.id,
        contactId: contact.id, conversationKey, replyToken: randomUUID(), subject: input.subject.trim(),
        folder: "borradores", createdBy: context.actor.id,
      }).returning();
      const [message] = await tx.insert(mailMessagesTable).values({
        centerId: context.actor.centerId, schoolYearId: context.year.id, threadId: thread.id,
        contactId: contact.id, direction: "saliente", status: "borrador",
        sender: resendFromAddress(settings.senderAlias), replyTo: settings.replyTo, recipient: contact.email, subject: input.subject.trim(),
        bodyText: input.bodyText.trim(), classification: input.classification,
        attachmentSnapshot: attachments, createdBy: context.actor.id,
        eventMetadata: { ...(input.templateId ? { templateId: input.templateId } : {}), individualDelivery: true },
      }).returning();
      created.push(message);
    });
  }
  await recordAudit(context, "mail.draft.create", "mail_message_batch", created[0]!.threadId, { recipientCount: created.length });
  res.status(201).json({ messages: created.map(publicMessage) });
}));

router.patch("/mail/drafts/:messageId", requireAuth, requireCsrf, endpoint(async (req, res) => {
  const context = await getContext(res);
  const parsed = UpdateMailDraftBody.safeParse(req.body);
  if (!parsed.success || !CLASSIFICATIONS.has(parsed.data?.classification))
    throw new MailFailure(400, "El borrador no cumple los límites o contiene datos no válidos.");
  const { message, thread } = await ownedDraft(context, routeId(req, "messageId"));
  const ownDraft = message.createdBy === context.actor.id;
  if (message.status !== "borrador" || (!ownDraft && context.actor.role !== "admin_tecnico"))
    throw new MailFailure(403, "Solo puedes editar tus borradores pendientes; el administrador técnico puede corregir borradores del centro.");
  if (parsed.data.expectedRevision !== message.revision)
    throw new MailFailure(409, "El borrador cambió. Actualiza la vista antes de editarlo.");
  const [contact] = message.contactId ? await db.select().from(mailContactsTable).where(and(
    eq(mailContactsTable.id, message.contactId), eq(mailContactsTable.centerId, context.actor.centerId),
    eq(mailContactsTable.schoolYearId, context.year.id), eq(mailContactsTable.active, true),
  )) : [];
  if (!contact) throw new MailFailure(409, "El destinatario ya no está activo en esta agenda.");
  if (parsed.data.classification !== "obligatoria" && contact.optOut)
    throw new MailFailure(409, "El contacto ha solicitado no recibir comunicaciones no obligatorias.");
  let attachments: PinnedFile[];
  try { attachments = await storedAttachments(parsed.data.attachmentDocumentIds, context.year.id, context.actor.centerId); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("MAIL_ATTACHMENT_"))
      throw new MailFailure(400, "Los adjuntos deben ser versiones vigentes aprobadas y limpias, de un tipo admitido y menores de 10 MB.");
    throw error;
  }
  const settings = await currentSettings(context.actor.centerId);
  const [updated] = await db.update(mailMessagesTable).set({
    subject: parsed.data.subject.trim(), bodyText: parsed.data.bodyText.trim(),
    classification: parsed.data.classification, attachmentSnapshot: attachments,
    sender: resendFromAddress(settings.senderAlias), replyTo: settings.replyTo,
    revision: message.revision + 1,
  }).where(and(eq(mailMessagesTable.id, message.id), eq(mailMessagesTable.status, "borrador"),
    eq(mailMessagesTable.revision, parsed.data.expectedRevision))).returning();
  if (!updated) throw new MailFailure(409, "El borrador ya fue actualizado por otra sesión.");
  await db.update(mailThreadsTable).set({
    subject: updated.subject, revision: thread.revision + 1, updatedAt: new Date(),
  }).where(and(eq(mailThreadsTable.id, thread.id), eq(mailThreadsTable.revision, thread.revision)));
  await recordAudit(context, "mail.draft.update", "mail_message", message.id);
  res.json(publicMessage(updated));
}));

async function ownedDraft(context: MailContext, messageId: string) {
  const [message] = await db.select().from(mailMessagesTable).where(and(
    eq(mailMessagesTable.id, messageId), eq(mailMessagesTable.centerId, context.actor.centerId),
    eq(mailMessagesTable.schoolYearId, context.year.id), eq(mailMessagesTable.direction, "saliente"),
  ));
  if (!message) throw new MailFailure(404, "No se encontró el mensaje.");
  const [thread] = await db.select().from(mailThreadsTable).where(and(eq(mailThreadsTable.id, message.threadId), eq(mailThreadsTable.centerId, context.actor.centerId)));
  if (!manager(context.actor) && thread?.assignedTo !== context.actor.id && message.createdBy !== context.actor.id)
    throw new MailFailure(404, "No se encontró el mensaje autorizado.");
  return { message, thread: thread! };
}

router.post("/mail/drafts/:messageId/submit", requireAuth, requireCsrf, endpoint(async (req, res) => {
  const context = await getContext(res);
  const { message } = await ownedDraft(context, routeId(req, "messageId"));
  if (!editor(context.actor) && message.createdBy !== context.actor.id) throw new MailFailure(403, "No puedes enviar este borrador a revisión.");
  const [updated] = await db.update(mailMessagesTable).set({ status: "revision", revision: message.revision + 1 })
    .where(and(eq(mailMessagesTable.id, message.id), eq(mailMessagesTable.revision, message.revision), eq(mailMessagesTable.status, "borrador"))).returning();
  if (!updated) throw new MailFailure(409, "El borrador ha cambiado de estado.");
  await db.update(mailThreadsTable).set({ folder: "revision_humana", updatedAt: new Date() }).where(eq(mailThreadsTable.id, message.threadId));
  await recordAudit(context, "mail.draft.submit", "mail_message", message.id);
  res.json(publicMessage(updated));
}));

router.post("/mail/drafts/:messageId/approve", requireAuth, requireCsrf, endpoint(async (req, res) => {
  const context = await getContext(res); needApprover(context);
  const { message } = await ownedDraft(context, routeId(req, "messageId"));
  if (message.status !== "revision" || message.createdBy === context.actor.id)
    throw new MailFailure(409, "La aprobación requiere otro revisor competente; no se puede aprobar el propio borrador.");
  const [updated] = await db.update(mailMessagesTable).set({
    status: "aprobado", approvedBy: context.actor.id, approvedAt: new Date(), revision: message.revision + 1,
  }).where(and(eq(mailMessagesTable.id, message.id), eq(mailMessagesTable.status, "revision"),
    eq(mailMessagesTable.revision, message.revision), sql`${mailMessagesTable.createdBy} <> ${context.actor.id}`)).returning();
  if (!updated) throw new MailFailure(409, "El borrador ya cambió o fue revisado en otra sesión.");
  await recordAudit(context, "mail.draft.approve", "mail_message", message.id, { approvedBy: context.actor.id });
  res.json(publicMessage(updated));
}));

router.post("/mail/drafts/:messageId/send", requireAuth, requireCsrf, endpoint(async (req, res) => {
  const context = await getContext(res);
  const { message, thread } = await ownedDraft(context, routeId(req, "messageId"));
  if (message.status !== "aprobado" || !message.approvedBy) throw new MailFailure(409, "Solo se encolan mensajes aprobados por otra persona competente.");
  const body = req.body as { expectedRevision?: unknown };
  if (body.expectedRevision !== message.revision) throw new MailFailure(409, "El mensaje ha cambiado; actualiza su estado.");
  if (thread.folder === "archivada" || thread.folder === "spam") throw new MailFailure(409, "No se envía un hilo archivado o marcado como spam.");
  const [updated] = await db.update(mailMessagesTable).set({
    status: "en_cola", revision: message.revision + 1, retryAt: new Date(),
  }).where(and(eq(mailMessagesTable.id, message.id), eq(mailMessagesTable.status, "aprobado"),
    eq(mailMessagesTable.revision, message.revision))).returning();
  if (!updated) throw new MailFailure(409, "El mensaje ya se ha puesto en cola.");
  await db.update(mailThreadsTable).set({ folder: "programadas", updatedAt: new Date() }).where(eq(mailThreadsTable.id, thread.id));
  await recordAudit(context, "mail.draft.queue", "mail_message", message.id);
  res.json({ ...publicMessage(updated), queued: true, deliveryClaimed: false });
}));

router.post("/mail/threads/:threadId/assign", requireAuth, requireCsrf, endpoint(async (req, res) => {
  const context = await getContext(res); needManager(context);
  const parsed = AssignMailThreadBody.safeParse(req.body);
  if (!parsed.success) throw new MailFailure(400, "Selecciona una cuenta activa del curso.");
  const thread = await assertThreadAccess(context, routeId(req, "threadId"));
  const [assigned] = await db.select().from(usersTable).where(and(
    eq(usersTable.id, parsed.data.userId), eq(usersTable.centerId, context.actor.centerId), eq(usersTable.active, true),
  ));
  if (!assigned) throw new MailFailure(400, "La persona asignada debe pertenecer al centro y tener cuenta activa.");
  const [updated] = await db.update(mailThreadsTable).set({ assignedTo: assigned.id, revision: thread.revision + 1, updatedAt: new Date() })
    .where(and(eq(mailThreadsTable.id, thread.id), eq(mailThreadsTable.centerId, context.actor.centerId))).returning();
  await recordAudit(context, "mail.thread.assign", "mail_thread", thread.id, { assignedTo: assigned.id });
  res.json(await getThreadSummary(updated));
}));

router.post("/mail/threads/:threadId/action", requireAuth, requireCsrf, endpoint(async (req, res) => {
  const context = await getContext(res);
  const thread = await assertThreadAccess(context, routeId(req, "threadId"));
  const body = req.body as { action?: unknown };
  if (!["archivar", "recuperar", "revisar"].includes(String(body.action))) throw new MailFailure(400, "La acción del hilo no está admitida.");
  if (body.action !== "revisar" && !manager(context.actor)) throw new MailFailure(403, "Solo C2, dirección o administración técnica pueden archivar un hilo.");
  const folder = body.action === "archivar" ? "archivada" : body.action === "recuperar" ? "entrada" : "revision_humana";
  const [updated] = await db.update(mailThreadsTable).set({ folder, revision: thread.revision + 1, updatedAt: new Date() })
    .where(and(eq(mailThreadsTable.id, thread.id), eq(mailThreadsTable.updatedAt, thread.updatedAt))).returning();
  if (!updated) throw new MailFailure(409, "El hilo cambió en otra sesión.");
  await recordAudit(context, `mail.thread.${String(body.action)}`, "mail_thread", thread.id);
  res.json(await getThreadSummary(updated));
}));

async function scopedInboundAttachment(context: MailContext, attachmentId: string) {
  const [attachment] = await db.select().from(mailAttachmentsTable).where(and(
    eq(mailAttachmentsTable.id, attachmentId), eq(mailAttachmentsTable.centerId, context.actor.centerId),
    eq(mailAttachmentsTable.schoolYearId, context.year.id),
  ));
  if (!attachment) throw new MailFailure(404, "No se encontró el adjunto de este curso.");
  const [message] = await db.select().from(mailMessagesTable).where(eq(mailMessagesTable.id, attachment.messageId));
  if (!message) throw new MailFailure(404, "No se encontró el mensaje.");
  await assertThreadAccess(context, message.threadId);
  return attachment;
}

router.post("/mail/attachments/:attachmentId/approve", requireAuth, requireCsrf, endpoint(async (req, res) => {
  const context = await getContext(res); needManager(context);
  const attachment = await scopedInboundAttachment(context, routeId(req, "attachmentId"));
  if (attachment.scanStatus !== "limpio" || !/^[0-9a-f-]{36}$/i.test(attachment.storageKey))
    throw new MailFailure(409, "El archivo no ha pasado un análisis antivirus disponible y completo.");
  const data = await readFile(path.join(privateMailDirectory, attachment.storageKey)).catch(() => null);
  if (!data || data.length !== attachment.sizeBytes || createHash("sha256").update(data).digest("hex") !== attachment.sha256)
    throw new MailFailure(409, "No se pudo validar la integridad del archivo privado.");
  const scan = await scanWithClamAv(data);
  if (scan !== "limpio") {
    await db.update(mailAttachmentsTable).set({ scanStatus: scan, reviewedBy: null, reviewedAt: null })
      .where(eq(mailAttachmentsTable.id, attachment.id));
    throw new MailFailure(409, "El antivirus no confirma un resultado limpio; el archivo sigue en cuarentena.");
  }
  const [updated] = await db.update(mailAttachmentsTable).set({
    reviewedBy: context.actor.id, reviewedAt: new Date(),
  }).where(and(eq(mailAttachmentsTable.id, attachment.id), eq(mailAttachmentsTable.scanStatus, "limpio"))).returning();
  await recordAudit(context, "mail.attachment.approve", "mail_attachment", attachment.id);
  res.json({ id: updated.id, filename: updated.filename, sizeBytes: updated.sizeBytes, scanStatus: updated.scanStatus, reviewedAt: updated.reviewedAt?.toISOString() ?? null });
}));

router.get("/mail/attachments/:attachmentId/download", requireAuth, endpoint(async (req, res) => {
  const context = await getContext(res);
  const attachment = await scopedInboundAttachment(context, routeId(req, "attachmentId"));
  if (attachment.scanStatus !== "limpio" || !attachment.reviewedBy || !attachment.reviewedAt ||
      !/^[0-9a-f-]{36}$/i.test(attachment.storageKey))
    throw new MailFailure(403, "El adjunto permanece en cuarentena hasta superar el análisis y la revisión humana.");
  const data = await readFile(path.join(privateMailDirectory, attachment.storageKey)).catch(() => null);
  if (!data || data.length !== attachment.sizeBytes || createHash("sha256").update(data).digest("hex") !== attachment.sha256)
    throw new MailFailure(409, "No se pudo validar la integridad del archivo privado.");
  if (await scanWithClamAv(data) !== "limpio") {
    await db.update(mailAttachmentsTable).set({ scanStatus: "no_disponible", reviewedBy: null, reviewedAt: null })
      .where(eq(mailAttachmentsTable.id, attachment.id));
    throw new MailFailure(409, "El archivo no pudo superar la nueva inspección antivirus.");
  }
  await recordAudit(context, "mail.attachment.download", "mail_attachment", attachment.id);
  res.set({
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  }).send(data);
}));

export default router;

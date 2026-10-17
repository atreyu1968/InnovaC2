import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { raw, Router, type RequestHandler, type ErrorRequestHandler } from "express";
import {
  db, auditLogsTable, schoolYearsTable, schoolYearAssignmentsTable, usersTable, documentsTable, documentVersionsTable,
  ciclopePoliciesTable as policies, ciclopeMeetingsTable as meetings, ciclopeVersionsTable as versions,
  ciclopeTasksTable as tasks, ciclopeNoticesTable as notices,
  mailContactsTable, mailMessagesTable, mailThreadsTable,
} from "@workspace/db";
import {
  CreateCiclopeMeetingBody, UpdateCiclopeMeetingBody, ActCiclopeMeetingBody,
  UpdateCiclopePolicyBody, ActCiclopeTaskBody,
} from "@workspace/api-zod";
import { requireAuth, requireCsrf, type AuthContext } from "../lib/auth";
import { loadCaptureActor, loadActiveSchoolYear, type CaptureActor } from "../lib/capture-scope";
import { exportCiclopeDocument } from "../lib/ciclope-exports";
import { resendFromAddress } from "../lib/mail-provider";
import { AIProviderError, draftMeetingMinutes, transcribeMeetingAudio } from "../lib/ai-provider";

type ParsedInput = ReturnType<typeof CreateCiclopeMeetingBody.parse>;
type Input = Omit<ParsedInput, "startsAt" | "endsAt" | "participants" | "agreements"> & {
  startsAt: string; endsAt: string;
  participants: (Omit<ParsedInput["participants"][number], "appointedOn"> & { appointedOn: string | null; name?: string; email?: string; professionalFamily?: string | null })[];
  agreements: (Omit<ParsedInput["agreements"][number], "dueDate"> & { dueDate: string; responsibleName?: string })[];
};
type Row = typeof meetings.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Scope = { actor: CaptureActor; year: { id: string; label: string }; manage: boolean; approve: boolean };
type Content = {
  data: Input; approvalRequested: boolean; approvedPolicyRevision: number | null;
  contributions: string[]; validatedBy?: string; validatedAt?: string; announcedAt?: string;
  transcription?: {
    text: string;
    source: "in_person" | "online" | "upload";
    consentedAt: string;
    completedAt: string;
  };
};
class Fault extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (status: number, message: string): never => { throw new Fault(status, message); };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const router = Router();
const getContent = (row: Row) => row.content as Content;
const dto = (row: Row) => ({ id: row.id, revision: row.revision, state: row.state, ...getContent(row) });
const visible = (s: Scope, row: Row) => s.manage || s.approve || getContent(row).data.participants.some(p => p.userId === s.actor.id);
const defaults = { revision: 0, requireInstitutionalApproval: true, authorizedInternalChannel: false };
const scope: RequestHandler = async (_req, res, next) => {
  const actor = await loadCaptureActor((res.locals.auth as AuthContext).user.id);
  if (!actor) { res.status(403).json({ error: "Sin asignación autorizada en el curso." }); return; }
  const year = await loadActiveSchoolYear(actor.centerId);
  if (!year) { res.status(409).json({ error: "No hay un curso activo. Los expedientes cerrados se consultan en Cursos académicos." }); return; }
  const assignments = await db.select().from(schoolYearAssignmentsTable).where(eq(schoolYearAssignmentsTable.schoolYearId, year.id));
  const annualRole = assignments.length ? assignments.find(a => a.userId === actor.id)?.role : actor.role;
  const admin = actor.role === "admin_tecnico";
  res.locals.ciclope = {
    actor, year,
    manage: admin || (actor.role === "c2_innovacion" && annualRole === "c2_innovacion"),
    approve: admin || (actor.role === "equipo_directivo" && annualRole === "equipo_directivo"),
  } satisfies Scope;
  res.setHeader("Cache-Control", "private, no-store");
  next();
};
router.use("/ciclope", requireAuth, scope);
async function transaction<T>(s: Scope, fn: (tx: Tx) => Promise<T>) {
  return db.transaction(async tx => {
    const [year] = await tx.select().from(schoolYearsTable).where(eq(schoolYearsTable.id, s.year.id)).for("update");
    if (!year?.active || year.closedAt) fail(409, "El curso se ha cerrado. No se admite modificar el expediente.");
    const result = await fn(tx);
    await tx.insert(auditLogsTable).values({
      userId: s.actor.id, action: "ciclope.write", entityType: "school_year", entityId: s.year.id,
      details: { actorRole: s.actor.role, schoolYearId: s.year.id },
    });
    return result;
  });
}
async function policy(tx: Tx | typeof db, s: Scope) {
  const [row] = await tx.select().from(policies).where(eq(policies.schoolYearId, s.year.id));
  return row ?? defaults;
}
async function meeting(tx: Tx | typeof db, s: Scope, id: string, lock = false) {
  if (!uuid.test(id)) return fail(400, "Identificador no válido.");
  const query = tx.select().from(meetings).where(and(eq(meetings.id, id), eq(meetings.centerId, s.actor.centerId), eq(meetings.schoolYearId, s.year.id)));
  const [row] = await (lock ? query.for("update") : query);
  if (!row || !visible(s, row)) return fail(404, "No se encontró una reunión autorizada.");
  return row;
}
async function version(tx: Tx, s: Scope, row: Row) {
  const [saved] = await tx.insert(versions).values({
    schoolYearId: s.year.id, meetingId: row.id, revision: row.revision, content: dto(row), createdBy: s.actor.id,
  }).returning();
  await tx.insert(auditLogsTable).values({
    userId: s.actor.id, action: "ciclope.revision", entityType: "ciclope_meeting", entityId: row.id,
    details: { revision: row.revision, state: row.state, sourceVersionId: saved!.id },
  });
  return saved!;
}
async function validate(tx: Tx, s: Scope, raw: ParsedInput, old?: Row) {
  const input = JSON.parse(JSON.stringify(raw)) as Input;
  input.participants = input.participants.map(p => ({ ...p, appointedOn: p.appointedOn ? new Date(p.appointedOn).toISOString().slice(0, 10) : null }));
  input.agreements = input.agreements.map(a => ({ ...a, dueDate: new Date(a.dueDate).toISOString().slice(0, 10) }));
  const start = new Date(input.startsAt), end = new Date(input.endsAt);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || +end <= +start) fail(400, "El final debe ser posterior al inicio.");
  const ids = input.participants.map(p => p.userId);
  if (new Set(ids).size !== ids.length) fail(400, "No se puede duplicar una persona en la composición.");
  const people = await tx.select().from(usersTable).where(and(eq(usersTable.centerId, s.actor.centerId), eq(usersTable.active, true)));
  const assigned = await tx.select().from(schoolYearAssignmentsTable).where(eq(schoolYearAssignmentsTable.schoolYearId, s.year.id));
  const valid = new Set(people.filter(p => !assigned.length || p.role === "admin_tecnico" || assigned.some(a => a.userId === p.id)).map(p => p.id));
  const refs = [...ids, ...input.validatorUserIds, ...input.agreements.map(a => a.responsibleUserId), ...[input.chairUserId, input.secretaryUserId].filter((x): x is string => Boolean(x))];
  if (refs.some(id => !valid.has(id))) fail(400, "Todas las personas deben estar activas y asignadas al curso del centro.");
  input.participants = input.participants.map(p => {
    const person = people.find(x => x.id === p.userId)!;
    const prior = old && old.state !== "programada" ? getContent(old).data.participants.find(x => x.userId === p.userId) : undefined;
    return { ...p, name: prior?.name ?? person.name, email: prior?.email ?? person.email, professionalFamily: prior?.professionalFamily ?? person.professionalFamily };
  });
  input.agreements = input.agreements.map(a => ({
    ...a, responsibleName: people.find(p => p.id === a.responsibleUserId)!.name,
    remindersEnabled: false, // A minute cannot subscribe another account to reminders.
  }));
  if ([input.chairUserId, input.secretaryUserId, ...input.validatorUserIds].some(id => id && !ids.includes(id)))
    fail(400, "Presidencia, secretaría y validadores deben figurar en la composición.");
  if (input.participants.some(p => p.appointedOn && !/^\d{4}-\d{2}-\d{2}$/.test(p.appointedOn))) fail(400, "Fecha de participación no válida.");
  if (input.agreements.some(a => !/^\d{4}-\d{2}-\d{2}$/.test(a.dueDate))) fail(400, "Cada acuerdo necesita un plazo válido.");
  if (input.participants.some(p => p.attendance !== "pendiente") && (!old || !["celebrada", "acta_borrador"].includes(old.state)))
    fail(409, "No se atribuye asistencia antes de registrar la celebración.");
  if (!old || old.state === "programada") {
    const others = await tx.select().from(meetings).where(eq(meetings.schoolYearId, s.year.id));
    const overlap = others.find(r => r.id !== old?.id && r.state !== "cancelada" && +r.startsAt < +end && +r.endsAt > +start &&
      getContent(r).data.participants.some(p => ids.includes(p.userId)));
    if (overlap) fail(409, "Hay un solapamiento con otra reunión para las personas participantes.");
  }
  // Attachments are approved, clean, center-visible versions, not arbitrary storage paths.
  input.pinnedAttachments = old && old.state !== "programada" ? getContent(old).data.pinnedAttachments ?? [] : [];
  for (const id of old && old.state !== "programada" ? [] : input.attachmentIds) {
    const [doc] = await tx.select().from(documentsTable).where(and(eq(documentsTable.id, id), eq(documentsTable.schoolYearId, s.year.id)));
    if (!doc || doc.accessScope !== "center" || doc.status !== "aprobado") fail(400, "Adjunta únicamente documentos aprobados y compartidos con el centro.");
    const [v] = await tx.select().from(documentVersionsTable).where(and(eq(documentVersionsTable.documentId, id), eq(documentVersionsTable.version, doc.currentVersion))).limit(1);
    if (!v || v.scanStatus !== "limpio") fail(400, "El adjunto debe contar con una versión limpia.");
    input.pinnedAttachments.push({ documentId: id, title: doc.title, versionId: v.id, version: v.version, sha256: v.sha256, originalName: v.originalName, sizeBytes: v.sizeBytes });
  }
  return { ...input, startsAt: start.toISOString(), endsAt: end.toISOString() };
}
router.get("/ciclope", async (_req, res) => {
  const s = res.locals.ciclope as Scope;
  const all = await db.select().from(meetings).where(eq(meetings.schoolYearId, s.year.id)).orderBy(meetings.startsAt);
  const rows = all.filter(r => visible(s, r));
  const ids = rows.map(r => r.id);
  const allPeople = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, professionalFamily: usersTable.professionalFamily })
    .from(usersTable).where(and(eq(usersTable.centerId, s.actor.centerId), eq(usersTable.active, true)));
  const permittedIds = new Set([s.actor.id, ...rows.flatMap(r => getContent(r).data.participants.map(p => p.userId))]);
  const taskRows = ids.length ? await db.select().from(tasks).where(inArray(tasks.meetingId, ids)) : [];
  const noticeRows = await db.select().from(notices).where(and(eq(notices.schoolYearId, s.year.id), eq(notices.recipientUserId, s.actor.id))).orderBy(desc(notices.createdAt));
  res.json({
    schoolYearId: s.year.id, schoolYearLabel: s.year.label, canManage: s.manage, canApprove: s.approve, minimumMeetings: 4,
    policy: await policy(db, s), people: allPeople.filter(p => s.manage || s.approve || permittedIds.has(p.id)),
    meetings: rows.map(dto), tasks: taskRows.filter(t => s.manage || s.approve || t.responsibleUserId === s.actor.id), notices: noticeRows,
  });
});
router.put("/ciclope/policy", requireCsrf, async (req, res) => {
  const s = res.locals.ciclope as Scope;
  if (!s.approve) return fail(403, "La autorización del canal y el refrendo corresponden al equipo directivo.");
  const parsed = UpdateCiclopePolicyBody.safeParse(req.body);
  if (!parsed.success) return fail(400, "Política no válida.");
  await transaction(s, async tx => {
    const current = await policy(tx, s);
    if (current.revision !== parsed.data.expectedRevision) fail(409, "La política ha cambiado. Recarga los datos.");
    const data = { requireInstitutionalApproval: parsed.data.requireInstitutionalApproval, authorizedInternalChannel: parsed.data.authorizedInternalChannel, revision: current.revision + 1 };
    if (current.revision) await tx.update(policies).set(data).where(eq(policies.schoolYearId, s.year.id));
    else await tx.insert(policies).values({ ...data, centerId: s.actor.centerId, schoolYearId: s.year.id });
  });
  res.json({ success: true });
});
router.post("/ciclope/meetings", requireCsrf, async (req, res) => {
  const s = res.locals.ciclope as Scope;
  if (!s.manage) return fail(403, "Solo C2 y administración técnica preparan el expediente.");
  const parsed = CreateCiclopeMeetingBody.safeParse(req.body);
  if (!parsed.success) return fail(400, "Revisa los campos de la reunión.");
  const saved = await transaction(s, async tx => {
    const input = await validate(tx, s, parsed.data);
    const [row] = await tx.insert(meetings).values({
      centerId: s.actor.centerId, schoolYearId: s.year.id, kind: input.kind, title: input.title,
      startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), createdBy: s.actor.id,
      content: { data: input, approvalRequested: false, approvedPolicyRevision: null, contributions: [] },
    }).returning();
    await version(tx, s, row!); return row!;
  });
  res.status(201).json(dto(saved));
});
router.put("/ciclope/meetings/:meetingId", requireCsrf, async (req, res) => {
  const s = res.locals.ciclope as Scope;
  if (!s.manage) return fail(403, "Solo C2 y administración técnica editan la documentación.");
  const parsed = UpdateCiclopeMeetingBody.safeParse(req.body);
  if (!parsed.success) return fail(400, "Revisa los campos de la reunión.");
  const saved = await transaction(s, async tx => {
    const row = await meeting(tx, s, String(req.params.meetingId), true);
    if (row.revision !== parsed.data.expectedRevision) fail(409, "La reunión cambió. Recarga antes de guardar.");
    if (!["programada", "celebrada", "acta_borrador"].includes(row.state)) fail(409, "La convocatoria emitida y el acta validada no se sobrescriben.");
    const input = await validate(tx, s, parsed.data, row);
    if (row.state !== "programada") {
      const before = getContent(row).data;
      const immutable = (v: Input) => ({ ...v, notes: "", agreements: [], pinnedAttachments: [], expectedRevision: 0, participants: v.participants.map(p => ({ ...p, attendance: "pendiente" })) });
      if (!isDeepStrictEqual(immutable(before), immutable(input))) fail(409, "Después de convocar solo se pueden documentar asistencia, desarrollo y acuerdos.");
    }
    const [updated] = await tx.update(meetings).set({
      kind: input.kind, title: input.title, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt),
      revision: row.revision + 1, updatedAt: new Date(), content: {
        ...getContent(row), data: input,
        ...(row.state === "programada" ? { approvalRequested: false, approvedPolicyRevision: null } : {}),
      },
    }).where(eq(meetings.id, row.id)).returning();
    await version(tx, s, updated!); return updated!;
  });
  res.json(dto(saved));
});
router.post(
  "/ciclope/meetings/:meetingId/transcription",
  requireCsrf,
  raw({ type: ["audio/*", "application/octet-stream"], limit: "50mb" }),
  async (req, res) => {
    const s = res.locals.ciclope as Scope;
    if (!s.manage) return fail(403, "Solo C2 y administración técnica pueden preparar el acta.");
    if (req.get("x-recording-consent") !== "true") return fail(400, "Confirma el consentimiento antes de enviar la grabación.");
    const source = req.get("x-recording-source");
    if (!["in_person", "online", "upload"].includes(source ?? "")) return fail(400, "Indica el origen de la grabación.");
    const mediaType = (req.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const extensions: Record<string, string> = {
      "audio/webm": "webm", "audio/wav": "wav", "audio/x-wav": "wav",
      "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a",
      "audio/ogg": "ogg", "audio/flac": "flac", "application/octet-stream": "bin",
    };
    if (!extensions[mediaType]) return fail(415, "Formato de audio no admitido.");
    const audio = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!audio.length) return fail(400, "La grabación está vacía.");
    const meetingId = String(req.params.meetingId);
    const before = await meeting(db, s, meetingId);
    if (!["celebrada", "acta_borrador"].includes(before.state)) {
      return fail(409, "Solo se puede transcribir una reunión celebrada o con acta en borrador.");
    }
    if (getContent(before).data.notes.trim() && req.get("x-replace-draft") !== "true") {
      return fail(409, "El borrador actual contiene notas. Confirma expresamente que quieres sustituirlo.");
    }
    try {
      const consentedAt = new Date().toISOString();
      const transcript = await transcribeMeetingAudio({
        centerId: s.actor.centerId,
        audio,
        fileName: `meeting-recording.${extensions[mediaType]}`,
        mediaType,
      });
      const draft = await draftMeetingMinutes({
        centerId: s.actor.centerId,
        meetingTitle: before.title,
        meetingDate: before.startsAt.toISOString(),
        transcript,
      });
      const completedAt = new Date().toISOString();
      const saved = await transaction(s, async (tx) => {
        const current = await meeting(tx, s, meetingId, true);
        if (current.revision !== before.revision) fail(409, "La reunión cambió mientras se preparaba el borrador. Recarga e inténtalo de nuevo.");
        if (!["celebrada", "acta_borrador"].includes(current.state)) fail(409, "La reunión ya no admite una transcripción.");
        const content = structuredClone(getContent(current));
        const updatedContent: Content = {
          ...content,
          data: { ...content.data, notes: draft },
          transcription: {
            text: transcript,
            source: source as "in_person" | "online" | "upload",
            consentedAt,
            completedAt,
          },
        };
        const [updated] = await tx.update(meetings).set({
          state: "acta_borrador",
          revision: current.revision + 1,
          updatedAt: new Date(),
          content: updatedContent,
        }).where(eq(meetings.id, current.id)).returning();
        await version(tx, s, updated!);
        await tx.insert(auditLogsTable).values({
          userId: s.actor.id,
          action: "ciclope.ai_transcription",
          entityType: "ciclope_meeting",
          entityId: current.id,
          details: { source, consentedAt, transcriptCharacters: transcript.length, audioBytes: audio.length },
        });
        return updated!;
      });
      res.json(dto(saved));
    } catch (error) {
      if (error instanceof AIProviderError) return fail(error.status, error.message);
      throw error;
    } finally {
      audio.fill(0);
    }
  },
);
router.post("/ciclope/meetings/:meetingId/action", requireCsrf, async (req, res) => {
  const s = res.locals.ciclope as Scope;
  const parsed = ActCiclopeMeetingBody.safeParse(req.body);
  if (!parsed.success) return fail(400, "Acción no válida.");
  await transaction(s, async tx => {
    const row = await meeting(tx, s, String(req.params.meetingId), true), c = structuredClone(getContent(row));
    if (row.revision !== parsed.data.expectedRevision) fail(409, "La reunión cambió. Recarga los datos.");
    const a = parsed.data.action;
    const institutional = a === "aprobar_convocatoria" || a === "validar_acta";
    if (institutional && !s.approve) fail(403, "Se requiere validación institucional competente.");
    if (!institutional && a !== "aportar" && !s.manage) fail(403, "Solo C2 y administración técnica gestionan esta operación.");
    let state = row.state;
    const p = await policy(tx, s);
    if (a === "aportar") {
      if (state !== "programada" || !parsed.data.text?.trim()) fail(409, "Las propuestas se reciben antes de emitir la convocatoria.");
      c.contributions.push(`${s.actor.id}: ${parsed.data.text!.trim()}`);
    } else if (a === "solicitar_refrendo") {
      if (state !== "programada") fail(409, "La convocatoria ya no es un borrador.");
      c.approvalRequested = true;
    } else if (a === "aprobar_convocatoria") {
      if (state !== "programada" || !c.approvalRequested) fail(409, "Debe existir una propuesta de convocatoria pendiente.");
      c.approvedPolicyRevision = p.revision;
    } else if (a === "convocar") {
      if (state !== "programada") fail(409, "Solo se puede convocar una reunión programada.");
      if (row.kind === "ciclope" && !p.authorizedInternalChannel) fail(409, "El centro no ha autorizado la bandeja interna como canal institucional.");
      if (row.kind === "ciclope" && p.requireInstitutionalApproval && c.approvedPolicyRevision !== p.revision) fail(409, "Pendiente de refrendo institucional con la política vigente.");
      if (!c.data.participants.length || !c.data.agenda.length || !c.data.location.trim() ||
        (row.kind === "ciclope" && (!c.data.chairUserId || !c.data.secretaryUserId || !c.data.validatorUserIds.length)) ||
        (row.kind === "red_c1" && !c.data.externalSender.trim()))
        fail(400, "Completa composición, presidencia, secretaría, validadores, lugar y orden del día.");
      if (row.kind === "ciclope") {
        for (const participant of c.data.participants) await tx.insert(notices).values({
          schoolYearId: s.year.id, meetingId: row.id, recipientUserId: participant.userId, title: `Convocatoria: ${row.title}`,
        });
        const participantEmails = c.data.participants.map(person => person.email?.trim().toLocaleLowerCase("en-US") ?? "");
        if (participantEmails.some(email => !email)) fail(409, "Cada participante necesita un correo de cuenta para preparar el borrador institucional.");
        const recipients = [...new Set(participantEmails)];
        const dateText = new Date(c.data.startsAt).toLocaleString("es-ES", { dateStyle: "full", timeStyle: "short", timeZone: "Atlantic/Canary" });
        const bodyText = [
          "Convocatoria de sesión CICLOPE",
          "",
          c.data.title,
          `Fecha y hora: ${dateText}`,
          `Lugar o enlace: ${c.data.location}`,
          `Finalidad: ${c.data.purpose}`,
          "",
          "Orden del día:",
          ...c.data.agenda.map((item, index) => `${index + 1}. ${item}`),
          "",
          "Este borrador se ha preparado a partir de la convocatoria refrendada. Requiere una aprobación institucional adicional antes de incorporarse a la cola de correo; todavía no se ha enviado.",
        ].join("\n");
        const authorizedContacts = await tx.select().from(mailContactsTable).where(and(
          eq(mailContactsTable.centerId, s.actor.centerId),
          eq(mailContactsTable.schoolYearId, s.year.id),
          inArray(mailContactsTable.emailKey, recipients),
          eq(mailContactsTable.active, true),
        ));
        if (authorizedContacts.length !== recipients.length ||
            authorizedContacts.some(contact => contact.optOut || contact.authorizationNote.trim().length < 4)) {
          fail(409, "Registra y autoriza a todas las personas de la convocatoria en la agenda del curso antes de preparar el borrador.");
        }
        const linkedThreads: string[] = [];
        for (const contact of authorizedContacts) {
          const conversationKey = `ciclope:${row.id}:${contact.id}`;
          const [thread] = await tx.insert(mailThreadsTable).values({
            centerId: s.actor.centerId,
            schoolYearId: s.year.id,
            contactId: contact.id,
            conversationKey,
            replyToken: randomUUID(),
            subject: `Convocatoria CICLOPE: ${row.title}`,
            topic: "ciclope",
            folder: "borradores",
            createdBy: s.actor.id,
          }).onConflictDoNothing().returning({ id: mailThreadsTable.id });
          if (!thread) continue;
          await tx.insert(mailMessagesTable).values({
            centerId: s.actor.centerId,
            schoolYearId: s.year.id,
            threadId: thread.id,
            contactId: contact.id,
            direction: "saliente",
            status: "borrador",
            sender: resendFromAddress("ciclope"),
            recipient: contact.email,
            replyTo: "ciclope@buzon.iesmmg.org",
            subject: `Convocatoria CICLOPE: ${row.title}`,
            bodyText,
            classification: "organizativa",
            createdBy: s.actor.id,
            eventMetadata: {
              source: "ciclope",
              ciclopeMeetingId: row.id,
              ciclopeRevision: row.revision + 1,
              approvedPolicyRevision: c.approvedPolicyRevision,
            },
          });
          linkedThreads.push(thread.id);
        }
        await tx.insert(auditLogsTable).values({
          userId: s.actor.id, action: "mail.ciclope.draft.create", entityType: "ciclope_meeting",
          entityId: row.id, details: { threadIds: linkedThreads, recipientCount: linkedThreads.length, approvedPolicyRevision: c.approvedPolicyRevision },
        });
      }
      c.announcedAt = new Date().toISOString(); state = "convocada";
    } else if (a === "celebrar") {
      if (state !== "convocada" || +row.endsAt > Date.now()) fail(409, "Solo una reunión convocada y finalizada puede registrarse como celebrada.");
      state = "celebrada";
    } else if (a === "preparar_acta") {
      if (state !== "celebrada" || !c.data.notes.trim()) fail(409, "Registra la celebración y el desarrollo antes de preparar el acta.");
      state = "acta_borrador";
    } else if (a === "validar_acta") {
      if (state !== "acta_borrador") fail(409, "Solo un borrador puede validarse.");
      if (s.actor.role !== "admin_tecnico" && !c.data.validatorUserIds.includes(s.actor.id)) fail(403, "La persona no está designada como validadora del acta.");
      if (c.data.participants.some(x => x.attendance === "pendiente")) fail(409, "La asistencia debe revisarse expresamente.");
      state = "acta_validada"; c.validatedBy = s.actor.id; c.validatedAt = new Date().toISOString();
    } else if (a === "cancelar") {
      if (!["programada", "convocada"].includes(state) || !parsed.data.text?.trim()) fail(409, "Indica el motivo; no se cancela una reunión ya celebrada.");
      state = "cancelada"; c.contributions.push(`Cancelación: ${parsed.data.text}`);
    }
    const [saved] = await tx.update(meetings).set({ state, content: c, revision: row.revision + 1, updatedAt: new Date() }).where(eq(meetings.id, row.id)).returning();
    const v = await version(tx, s, saved!);
    if (a === "validar_acta") for (const agreement of c.data.agreements) await tx.insert(tasks).values({
      schoolYearId: s.year.id, meetingId: row.id, sourceVersionId: v.id, ...agreement,
    });
  });
  res.json({ success: true });
});
router.get("/ciclope/meetings/:meetingId/versions", async (req, res) => {
  const s = res.locals.ciclope as Scope, row = await meeting(db, s, String(req.params.meetingId));
  res.json(await db.select().from(versions).where(eq(versions.meetingId, row.id)).orderBy(desc(versions.revision)));
});
router.post("/ciclope/tasks/:taskId/action", requireCsrf, async (req, res) => {
  const s = res.locals.ciclope as Scope;
  const parsed = ActCiclopeTaskBody.safeParse(req.body);
  if (!parsed.success || !uuid.test(String(req.params.taskId))) return fail(400, "Acción de tarea no válida.");
  await transaction(s, async tx => {
    const [task] = await tx.select().from(tasks).where(and(eq(tasks.id, String(req.params.taskId)), eq(tasks.schoolYearId, s.year.id))).for("update");
    if (!task) fail(404, "No se encontró la tarea.");
    if (task.responsibleUserId !== s.actor.id && !s.manage) fail(403, "La tarea corresponde a otra persona.");
    const action = parsed.data.action;
    if (action === "activar_recordatorios" || action === "desactivar_recordatorios") {
      if (task.responsibleUserId !== s.actor.id) fail(403, "Solo la persona responsable decide sus preferencias.");
      await tx.update(tasks).set({ remindersEnabled: action === "activar_recordatorios" }).where(eq(tasks.id, task.id));
    } else if (action === "recordar") {
      if (!task.remindersEnabled || task.completedAt) fail(409, "El responsable no admite recordatorios o la tarea está completada.");
      await tx.insert(notices).values({ schoolYearId: s.year.id, meetingId: task.meetingId, recipientUserId: task.responsibleUserId, title: `Recordatorio: ${task.title} · plazo ${task.dueDate}` });
    } else await tx.update(tasks).set({ completedAt: action === "completar" ? new Date() : null }).where(eq(tasks.id, task.id));
    await tx.insert(auditLogsTable).values({ userId: s.actor.id, action: `ciclope.task.${action}`, entityType: "ciclope_task", entityId: task.id, details: { recipientUserId: task.responsibleUserId } });
  });
  res.json({ success: true });
});
router.get("/ciclope/meetings/:meetingId/export/:document/:revision/:format", async (req, res) => {
  const s = res.locals.ciclope as Scope, row = await meeting(db, s, String(req.params.meetingId));
  const n = Number(req.params.revision), format = String(req.params.format), kind = String(req.params.document);
  if (!Number.isInteger(n) || !["pdf", "docx"].includes(format) || !["convocatoria", "acta"].includes(kind)) return fail(400, "Documento, revisión o formato no válidos.");
  const [v] = await db.select().from(versions).where(and(eq(versions.meetingId, row.id), eq(versions.revision, n)));
  if (!v) return fail(404, "No existe esa revisión.");
  const original = v.content as ReturnType<typeof dto>;
  if (kind === "acta" && !["acta_borrador", "acta_validada"].includes(original.state)) return fail(409, "La revisión no contiene un acta.");
  const bytes = await exportCiclopeDocument(original, kind, format, s.year.label);
  res.setHeader("Content-Type", format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="CICLOPE-${kind}-${row.id}-r${n}.${format}"`);
  res.setHeader("X-Content-SHA256", createHash("sha256").update(bytes).digest("hex"));
  res.send(bytes);
});
router.use(((error, _req, res, next) => {
  if (error instanceof Fault) res.status(error.status).json({ error: error.message });
  else next(error);
}) satisfies ErrorRequestHandler);
export default router;

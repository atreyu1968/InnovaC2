import { Router, type Request, type Response } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  db, learningSpacesTable, spaceReservationsTable, spaceVersionsTable,
  activitiesTable, schoolYearsTable, auditLogsTable,
} from "@workspace/db";
import { UpdateLearningSpaceBody, CreateSpaceReservationBody, UpdateSpaceReservationBody } from "@workspace/api-zod";
import { requireAuth, requireCsrf, type AuthContext } from "../lib/auth";
import { loadCaptureActor, loadActiveSchoolYear, loadCatalogPayload, canReadActivity, sameFamily, type CaptureActor } from "../lib/capture-scope";
import { hasCoordinationAccess } from "../lib/role-access";
import { logger } from "../lib/logger";

const router = Router();
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Booking = typeof spaceReservationsTable.$inferSelect;
type Scope = { actor: CaptureActor; year: { id: string; label: string }; manager: boolean; families: string[] };
class Failure extends Error { constructor(readonly status: number, message: string) { super(message); } }
function reject(status: number, message: string): never { throw new Failure(status, message); }
const param = (req: Request, name: string) => {
  const id = String(req.params[name]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) reject(400, "Identificador no válido.");
  return id;
};
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try { await fn(req, res); }
    catch (error) {
      if (error instanceof Failure) { res.status(error.status).json({ error: error.message }); return; }
      const underlying = (error as { cause?: unknown })?.cause ?? error;
      const code = (underlying as { code?: string })?.code;
      if (code === "23P01") { res.status(409).json({ error: "El espacio ya está ocupado en ese horario. Revisa las reservas." }); return; }
      if (code === "23505") { res.status(409).json({ error: "El registro ya existe. Actualiza la vista." }); return; }
      if (code === "23514") { res.status(409).json({ error: "El curso está cerrado o la referencia no pertenece a este expediente." }); return; }
      logger.error({ code }, "Learning spaces request failed");
      res.status(500).json({ error: "No se pudo completar la operación de espacios." });
    }
  };
}
async function scope(res: Response): Promise<Scope> {
  const auth = (res.locals as { auth: AuthContext }).auth;
  const actor = await loadCaptureActor(auth.user.id);
  if (!actor) reject(403, "No tienes una asignación activa en este centro y curso.");
  const year = await loadActiveSchoolYear(actor.centerId);
  if (!year) reject(404, "No hay un curso activo. Las reservas anteriores no se trasladan al nuevo curso.");
  const catalog = await loadCatalogPayload() as { familias_profesionales?: unknown } | null;
  const families = Array.isArray(catalog?.familias_profesionales)
    ? catalog.familias_profesionales.filter((value): value is string => typeof value === "string") : [];
  return { actor, year, manager: hasCoordinationAccess(actor.role), families };
}
function canBook(s: Scope) {
  if (["consulta_c1", "consulta_auditora"].includes(s.actor.role)) reject(403, "Tu perfil es de consulta.");
}
function visible(s: Scope, row: Booking) {
  return s.manager || s.actor.role === "equipo_directivo" || row.createdBy === s.actor.id ||
    (["jefatura_departamento", "coordinacion_red"].includes(s.actor.role) && sameFamily(s.actor.professionalFamily, row.professionalFamily));
}
function editable(s: Scope, row: Booking) {
  return !["consulta_c1", "consulta_auditora"].includes(s.actor.role) && (s.manager || row.createdBy === s.actor.id);
}
function spaceDto(row: typeof learningSpacesTable.$inferSelect) {
  return {
    id: row.id, kind: row.kind, name: row.name, purpose: row.purpose,
    referenceSchedule: row.referenceSchedule, responsibles: row.responsibles,
    resources: row.resources, services: row.services, revision: row.revision, expectedRevision: row.revision,
  };
}
function bookingDto(s: Scope, row: Booking) {
  const detail = visible(s, row);
  return {
    id: row.id, title: detail ? row.title : "Espacio reservado",
    spaceKinds: row.spaceKinds, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(),
    professionalFamily: detail ? row.professionalFamily : "Reserva de otra familia",
    groupLabel: detail ? row.groupLabel : "", notes: detail ? row.notes : "",
    status: row.status, activityId: detail ? row.activityId : null, revision: row.revision,
    expectedRevision: row.revision, canEdit: editable(s, row), detailsVisible: detail,
  };
}
async function overview(s: Scope) {
  const [spaces, bookings, activities] = await Promise.all([
    db.select().from(learningSpacesTable).where(and(eq(learningSpacesTable.centerId, s.actor.centerId), eq(learningSpacesTable.schoolYearId, s.year.id))).orderBy(asc(learningSpacesTable.kind)),
    db.select().from(spaceReservationsTable).where(and(eq(spaceReservationsTable.centerId, s.actor.centerId), eq(spaceReservationsTable.schoolYearId, s.year.id))).orderBy(asc(spaceReservationsTable.startsAt)),
    db.select().from(activitiesTable).where(and(eq(activitiesTable.centerId, s.actor.centerId), eq(activitiesTable.schoolYearId, s.year.id))).orderBy(desc(activitiesTable.activityDate)),
  ]);
  return {
    schoolYearId: s.year.id, schoolYear: s.year.label, canManage: s.manager, actorFamily: s.actor.professionalFamily,
    families: s.families, spaces: spaces.map(spaceDto), reservations: bookings.map((row) => bookingDto(s, row)),
    activities: activities.filter((row) => row.status !== "descartada" && canReadActivity(s.actor, row)).map((row) => ({
      id: row.id, title: row.title, professionalFamily: row.professionalFamily, activityDate: row.activityDate, status: row.status,
    })),
  };
}
async function lockYear(tx: Tx, s: Scope) {
  const [year] = await tx.select().from(schoolYearsTable).where(and(
    eq(schoolYearsTable.id, s.year.id), eq(schoolYearsTable.centerId, s.actor.centerId),
  )).for("update");
  if (!year?.active || year.closedAt) reject(409, "El curso ya no está activo. No se han guardado cambios.");
}
async function version(tx: Tx, s: Scope, entityId: string, entityType: string, revision: number, content: Record<string, unknown>) {
  await tx.insert(spaceVersionsTable).values({
    centerId: s.actor.centerId, schoolYearId: s.year.id, entityId, entityType, revision, content, createdBy: s.actor.id,
  });
  await tx.insert(auditLogsTable).values({
    userId: s.actor.id, action: `spaces.${entityType}.save`, entityType, entityId,
    details: { schoolYearId: s.year.id, revision },
  });
}
const canaryDate = (date: Date) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: "Atlantic/Canary", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

router.get("/spaces", requireAuth, handle(async (_req, res) => { res.json(await overview(await scope(res))); }));
router.post("/spaces", requireAuth, requireCsrf, handle(async (_req, res) => {
  const s = await scope(res);
  if (!s.manager) reject(403, "Solo C2 y administración técnica pueden configurar los espacios.");
  await db.transaction(async (tx) => {
    await lockYear(tx, s);
    const existing = await tx.select().from(learningSpacesTable).where(eq(learningSpacesTable.schoolYearId, s.year.id));
    if (existing.length) reject(409, "Las fichas ya están inicializadas. No se han sustituido sus datos.");
    for (const kind of ["ateca", "fablab"]) {
      const [row] = await tx.insert(learningSpacesTable).values({
        centerId: s.actor.centerId, schoolYearId: s.year.id, kind,
        name: kind === "ateca" ? "Aula ATECA" : "FABLab", updatedBy: s.actor.id,
      }).returning();
      await version(tx, s, row.id, "space", row.revision, spaceDto(row));
    }
  });
  res.status(201).json(await overview(s));
}));
router.put("/spaces/:spaceId", requireAuth, requireCsrf, handle(async (req, res) => {
  const s = await scope(res), id = param(req, "spaceId");
  if (!s.manager) reject(403, "Solo C2 y administración técnica pueden editar las fichas.");
  const parsed = UpdateLearningSpaceBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.name.trim()) reject(400, "Revisa los campos de la ficha.");
  const { expectedRevision, ...input } = parsed.data;
  const result = await db.transaction(async (tx) => {
    await lockYear(tx, s);
    const [current] = await tx.select().from(learningSpacesTable).where(and(eq(learningSpacesTable.id, id), eq(learningSpacesTable.schoolYearId, s.year.id))).for("update");
    if (!current) reject(404, "Espacio no disponible en este curso.");
    if (current.revision !== expectedRevision) reject(409, "La ficha cambió en otra sesión. Conserva tus cambios y recarga antes de guardar.");
    const [saved] = await tx.update(learningSpacesTable).set({
      ...input, name: input.name.trim(), revision: current.revision + 1, updatedBy: s.actor.id, updatedAt: new Date(),
    }).where(eq(learningSpacesTable.id, id)).returning();
    await version(tx, s, id, "space", saved.revision, spaceDto(saved));
    return spaceDto(saved);
  });
  res.json(result);
}));

async function saveBooking(req: Request, res: Response, id?: string) {
  const s = await scope(res);
  canBook(s);
  const parsed = (id ? UpdateSpaceReservationBody : CreateSpaceReservationBody).safeParse(req.body);
  if (!parsed.success) reject(400, "Revisa los datos de la reserva y las fechas.");
  const { expectedRevision, ...input } = parsed.data;
  if (!input.title.trim() || !s.families.includes(input.professionalFamily)) reject(400, "Indica un título y una familia del catálogo oficial.");
  const startsAt = new Date(input.startsAt), endsAt = new Date(input.endsAt);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > 86_400_000) reject(400, "La reserva debe tener una duración mayor que cero y de hasta 24 horas.");
  const [first, last] = s.year.label.split("-");
  if (canaryDate(startsAt) < `${first}-09-01` || canaryDate(startsAt) >= `${last}-09-01` || canaryDate(new Date(endsAt.getTime() - 1)) >= `${last}-09-01`) reject(400, "Las fechas deben pertenecer al curso activo (septiembre a agosto, horario de Canarias).");
  if (new Set(input.spaceKinds).size !== input.spaceKinds.length) reject(400, "Selecciona cada espacio una sola vez.");
  if (input.status === "cancelada" && !input.notes.trim()) reject(400, "Indica el motivo de cancelación en las notas.");
  if (input.status === "realizado" && (!input.activityId || endsAt.getTime() > Date.now())) reject(400, "Un uso realizado exige una actuación vinculada y que haya terminado el horario previsto.");
  const saved = await db.transaction(async (tx) => {
    await lockYear(tx, s);
    let current: Booking | undefined;
    if (id) {
      [current] = await tx.select().from(spaceReservationsTable).where(and(eq(spaceReservationsTable.id, id), eq(spaceReservationsTable.schoolYearId, s.year.id))).for("update");
      if (!current) reject(404, "Reserva no disponible en este curso.");
      if (!editable(s, current)) reject(403, "Solo puedes editar tus reservas.");
      if (current.revision !== expectedRevision) reject(409, "La reserva cambió en otra sesión. Conserva tus datos y recarga.");
    } else if (expectedRevision !== 0 || input.status !== "reservada") reject(400, "Las reservas nuevas comienzan en estado reservado y revisión cero.");
    if (!s.manager && !sameFamily(s.actor.professionalFamily, input.professionalFamily)) {
      // An existing owner's past family cannot be reused after an annual reassignment.
      reject(403, "Solo puedes reservar con tu familia profesional del curso activo.");
    }
    if (input.activityId) {
      const [activity] = await tx.select().from(activitiesTable).where(and(
        eq(activitiesTable.id, input.activityId), eq(activitiesTable.centerId, s.actor.centerId), eq(activitiesTable.schoolYearId, s.year.id),
      ));
      if (!activity || !canReadActivity(s.actor, activity) || activity.status === "descartada") reject(400, "La actuación no está disponible para tu perfil en este curso.");
      if (!sameFamily(activity.professionalFamily, input.professionalFamily) || activity.activityDate !== canaryDate(startsAt)) reject(400, "La actuación debe corresponder a la misma familia y fecha del uso.");
      if (input.status === "realizado" && (activity.status !== "validada" || !activity.confirmedBy)) reject(409, "Para documentar el uso, la actuación debe estar confirmada y validada. La reserva no demuestra su realización.");
    }
    const values = {
      ...input, title: input.title.trim(), startsAt, endsAt,
      revision: (current?.revision ?? 0) + 1, updatedAt: new Date(),
    };
    const [row] = current
      ? await tx.update(spaceReservationsTable).set(values).where(eq(spaceReservationsTable.id, current.id)).returning()
      : await tx.insert(spaceReservationsTable).values({ ...values, centerId: s.actor.centerId, schoolYearId: s.year.id, createdBy: s.actor.id }).returning();
    await version(tx, s, row.id, "reservation", row.revision, bookingDto(s, row));
    return row;
  });
  res.status(id ? 200 : 201).json(bookingDto(s, saved));
}
router.post("/space-reservations", requireAuth, requireCsrf, handle(async (req, res) => { await saveBooking(req, res); }));
router.put("/space-reservations/:reservationId", requireAuth, requireCsrf, handle(async (req, res) => { await saveBooking(req, res, param(req, "reservationId")); }));
router.get("/space-records/:entityId/versions", requireAuth, handle(async (req, res) => {
  const s = await scope(res), id = param(req, "entityId");
  const [space] = await db.select().from(learningSpacesTable).where(and(eq(learningSpacesTable.id, id), eq(learningSpacesTable.schoolYearId, s.year.id)));
  if (!space) {
    const [booking] = await db.select().from(spaceReservationsTable).where(and(eq(spaceReservationsTable.id, id), eq(spaceReservationsTable.schoolYearId, s.year.id)));
    if (!booking || !visible(s, booking)) reject(404, "Historial no disponible.");
  }
  const rows = await db.select().from(spaceVersionsTable).where(and(eq(spaceVersionsTable.entityId, id), eq(spaceVersionsTable.schoolYearId, s.year.id))).orderBy(desc(spaceVersionsTable.revision));
  res.json(rows.map((row) => ({ id: row.id, revision: row.revision, createdAt: row.createdAt.toISOString(), summary: JSON.stringify(row.content, null, 2) })));
}));
export default router;

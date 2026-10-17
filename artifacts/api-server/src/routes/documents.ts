import { createHash, randomUUID } from "node:crypto";
import { hasCoordinationAccess } from "../lib/role-access";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import {
  activitiesTable,
  activityIndicatorLinksTable,
  db,
  documentAccessGrantsTable,
  documentVersionsTable,
  documentsTable,
  evidencesTable,
  evidenceLinksTable,
  picIndicatorTargetsTable,
  usersTable,
} from "@workspace/db";
import {
  ApproveDocumentBody,
  GetDocumentResponse,
  LinkDocumentEvidenceBody,
  SetDocumentAccessBody,
  UploadDocumentQueryParams,
  type Document as ApiDocument,
} from "@workspace/api-zod";
import {
  canReadActivity,
  canReadDocument,
  loadActiveSchoolYear,
  loadCaptureActor,
  loadCurrentPlan,
  recordCaptureAudit,
  sameFamily,
} from "../lib/capture-scope";
import { scanWithClamAv } from "../lib/clamav";
import { dataDirectory } from "../lib/storage";
import { requireAuth, requireCsrf, requirePermission, type AuthContext } from "../lib/auth";

const router = Router();
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const DOCUMENT_DIRECTORY = path.join(dataDirectory, "documents");

const fileTypes = {
  ".pdf": {
    mediaType: "application/pdf",
    accepts: (data: Buffer) => data.subarray(0, 5).toString("ascii") === "%PDF-",
  },
  ".docx": {
    mediaType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    accepts: (data: Buffer) => isZip(data),
  },
  ".odt": {
    mediaType: "application/vnd.oasis.opendocument.text",
    accepts: (data: Buffer) => isZip(data),
  },
  ".xlsx": {
    mediaType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    accepts: (data: Buffer) => isZip(data),
  },
  ".csv": {
    mediaType: "text/csv",
    accepts: (data: Buffer) => isPlainText(data),
  },
  ".txt": {
    mediaType: "text/plain",
    accepts: (data: Buffer) => isPlainText(data),
  },
  ".png": {
    mediaType: "image/png",
    accepts: (data: Buffer) =>
      data.length >= 8 &&
      data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  ".jpg": {
    mediaType: "image/jpeg",
    accepts: (data: Buffer) => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
  },
  ".jpeg": {
    mediaType: "image/jpeg",
    accepts: (data: Buffer) => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
  },
  ".zip": {
    mediaType: "application/zip",
    accepts: (data: Buffer) => isZip(data),
  },
} as const;

function isZip(data: Buffer): boolean {
  return (
    data.length >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    ((data[2] === 0x03 && data[3] === 0x04) ||
      (data[2] === 0x05 && data[3] === 0x06) ||
      (data[2] === 0x07 && data[3] === 0x08))
  );
}

function isPlainText(data: Buffer): boolean {
  if (data.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(data);
    return true;
  } catch {
    return false;
  }
}

function safeFileName(value: string): string | null {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  const name = path.win32.basename(path.basename(decoded)).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!name || name.length > 255 || name === "." || name === "..") return null;
  return name;
}

async function readRequestBytes(req: Request): Promise<Buffer | null> {
  const lengthHeader = req.headers["content-length"];
  if (typeof lengthHeader === "string" && Number(lengthHeader) > MAX_DOCUMENT_BYTES) {
    return null;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_DOCUMENT_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      continue;
    }
    if (!tooLarge) chunks.push(bytes);
  }
  if (tooLarge || size === 0) return null;
  return Buffer.concat(chunks, size);
}

function fileDescriptor(fileName: string, data: Buffer) {
  const extension = path.extname(fileName).toLowerCase() as keyof typeof fileTypes;
  const type = fileTypes[extension];
  if (!type || !type.accepts(data)) return null;
  return { extension, ...type };
}

function authContext(res: Response): AuthContext {
  return res.locals.auth as AuthContext;
}

async function getDocumentRow(documentId: string, centerId: string) {
  const [row] = await db
    .select()
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.id, documentId),
        eq(documentsTable.centerId, centerId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function documentView(
  document: typeof documentsTable.$inferSelect,
): Promise<ApiDocument | null> {
  const [version] = await db
    .select()
    .from(documentVersionsTable)
    .where(
      and(
        eq(documentVersionsTable.documentId, document.id),
        eq(documentVersionsTable.version, document.currentVersion),
      ),
    )
    .limit(1);
  if (!version) return null;
  return {
    id: document.id,
    title: document.title,
    category: document.category,
    professionalFamily: document.professionalFamily,
    accessScope: document.accessScope as ApiDocument["accessScope"],
    status: document.status as ApiDocument["status"],
    revision: document.revision,
    currentVersion: document.currentVersion,
    latestFileName: version.originalName,
    latestMediaType: version.mediaType,
    sizeBytes: version.sizeBytes,
    sha256: version.sha256,
    scanStatus: version.scanStatus as ApiDocument["scanStatus"],
    createdBy: document.createdBy,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

async function validateActivityLink(
  actorId: string,
  centerId: string,
  schoolYearId: string,
  activityId?: string,
): Promise<typeof activitiesTable.$inferSelect | null> {
  if (!activityId) return null;
  const actor = await loadCaptureActor(actorId);
  if (!actor) return null;
  const [activity] = await db
    .select()
    .from(activitiesTable)
    .where(
      and(
        eq(activitiesTable.id, activityId),
        eq(activitiesTable.centerId, centerId),
        eq(activitiesTable.schoolYearId, schoolYearId),
      ),
    )
    .limit(1);
  if (!activity || !canReadActivity(actor, activity)) return null;
  return activity;
}

async function getMatchingDuplicate(
  centerId: string,
  schoolYearId: string,
  sha256: string,
  category: string,
  family: string | null,
  accessScope: string,
  actorId: string,
) {
  const rows = await db
    .select({ document: documentsTable, version: documentVersionsTable })
    .from(documentVersionsTable)
    .innerJoin(
      documentsTable,
      eq(documentVersionsTable.documentId, documentsTable.id),
    )
    .where(
      and(
        eq(documentsTable.centerId, centerId),
        eq(documentsTable.schoolYearId, schoolYearId),
        eq(documentVersionsTable.sha256, sha256),
        eq(documentsTable.category, category),
        eq(documentsTable.accessScope, accessScope),
      ),
    )
    .orderBy(desc(documentVersionsTable.version));
  for (const row of rows) {
    if (row.document.professionalFamily !== family) continue;
    const actor = await loadCaptureActor(actorId);
    if (actor && (await canReadDocument(actor, row.document))) return row;
  }
  return null;
}

async function linkEvidence(
  evidenceId: string,
  activityId: string | null,
  planId: string | null,
  indicatorCode: string | null,
  userId: string,
  note = "",
) {
  const [existing] = await db
    .select({ id: evidenceLinksTable.id })
    .from(evidenceLinksTable)
    .where(
      and(
        eq(evidenceLinksTable.evidenceId, evidenceId),
        activityId
          ? eq(evidenceLinksTable.activityId, activityId)
          : isNull(evidenceLinksTable.activityId),
        planId
          ? eq(evidenceLinksTable.planId, planId)
          : isNull(evidenceLinksTable.planId),
        indicatorCode
          ? eq(evidenceLinksTable.indicatorCode, indicatorCode)
          : isNull(evidenceLinksTable.indicatorCode),
      ),
    )
    .limit(1);
  if (existing) return;
  await db.insert(evidenceLinksTable).values({
    evidenceId,
    activityId,
    planId,
    indicatorCode,
    linkedBy: userId,
    note,
  });
}

async function validateIndicatorLink(
  planId: string | null,
  indicatorCode: string | null,
): Promise<{ actionCode: string } | null> {
  if (!indicatorCode || !planId) return null;
  const [target] = await db
    .select({ actionCode: picIndicatorTargetsTable.actionCode })
    .from(picIndicatorTargetsTable)
    .where(
      and(
        eq(picIndicatorTargetsTable.planId, planId),
        eq(picIndicatorTargetsTable.indicatorId, indicatorCode),
      ),
    )
    .limit(1);
  return target ?? null;
}

router.get(
  "/documents",
  requireAuth,
  requirePermission("documents.read"),
  async (_req, res) => {
    const actor = await loadCaptureActor(authContext(res).user.id);
    if (!actor) {
      res.status(401).json({ error: "La cuenta actual ya no está disponible." });
      return;
    }
    const year = await loadActiveSchoolYear(actor.centerId);
    if (!year) {
      res.status(409).json({ error: "El centro no tiene un curso activo." });
      return;
    }
    const rows = await db
      .select()
      .from(documentsTable)
      .where(
        and(
          eq(documentsTable.centerId, actor.centerId),
          eq(documentsTable.schoolYearId, year.id),
        ),
      )
      .orderBy(desc(documentsTable.updatedAt))
      .limit(200);
    const visible: ApiDocument[] = [];
    for (const row of rows) {
      if (!(await canReadDocument(actor, row))) continue;
      const view = await documentView(row);
      if (view) visible.push(view);
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.json(visible);
  },
);

router.post(
  "/documents",
  requireAuth,
  requireCsrf,
  requirePermission("documents.write"),
  async (req, res) => {
    const parsedQuery = UploadDocumentQueryParams.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(400).json({ error: "Los metadatos del documento no son válidos." });
      return;
    }
    const fileName = safeFileName(parsedQuery.data.fileName);
    if (!fileName) {
      res.status(400).json({ error: "El nombre del archivo no es válido." });
      return;
    }
    const data = await readRequestBytes(req);
    if (!data) {
      res.status(413).json({ error: `El archivo debe tener entre 1 byte y ${MAX_DOCUMENT_BYTES} bytes.` });
      return;
    }
    const descriptor = fileDescriptor(fileName, data);
    if (!descriptor) {
      res.status(400).json({ error: "El formato no está permitido o la firma del archivo no coincide." });
      return;
    }
    const context = authContext(res);
    const actor = await loadCaptureActor(context.user.id);
    if (!actor) {
      res.status(401).json({ error: "La cuenta actual ya no está disponible." });
      return;
    }
    const year = await loadActiveSchoolYear(actor.centerId);
    const plan = year ? await loadCurrentPlan(actor.centerId, year.id) : null;
    if (!year) {
      res.status(409).json({ error: "El centro no tiene un curso activo." });
      return;
    }
    const family = parsedQuery.data.professionalFamily ?? actor.professionalFamily;
    if (
      parsedQuery.data.accessScope === "center" &&
      !hasCoordinationAccess(actor.role)
    ) {
      res.status(403).json({ error: "Solo C2 puede publicar documentos para todo el centro." });
      return;
    }
    if (parsedQuery.data.accessScope === "family" && !family) {
      res.status(400).json({ error: "Asigna una familia profesional para compartir este documento." });
      return;
    }
    if (
      !hasCoordinationAccess(actor.role) &&
      family &&
      !sameFamily(actor.professionalFamily, family)
    ) {
      res.status(403).json({ error: "No puedes almacenar documentos de otra familia." });
      return;
    }
    if (parsedQuery.data.accessScope === "restricted" && !hasCoordinationAccess(actor.role) && !family) {
      // Restricted documents remain visible to their uploader even without a family.
    }
    const linkedActivity = await validateActivityLink(
      actor.id,
      actor.centerId,
      year.id,
      parsedQuery.data.activityId,
    );
    if (parsedQuery.data.activityId && !linkedActivity) {
      res.status(404).json({ error: "No se encontró la actuación en tu ámbito." });
      return;
    }
    const indicator = parsedQuery.data.indicatorCode
      ? await validateIndicatorLink(plan?.id ?? null, parsedQuery.data.indicatorCode)
      : null;
    if (parsedQuery.data.indicatorCode && !indicator) {
      res.status(400).json({ error: "El indicador no está seleccionado en el PIC activo." });
      return;
    }
    if (parsedQuery.data.indicatorCode && !linkedActivity) {
      res.status(400).json({ error: "Vincula el indicador a una actuación." });
      return;
    }
    const sha256 = createHash("sha256").update(data).digest("hex");
    const duplicate = await getMatchingDuplicate(
      actor.centerId,
      year.id,
      sha256,
      parsedQuery.data.category,
      family ?? null,
      parsedQuery.data.accessScope,
      actor.id,
    );
    if (duplicate) {
      const [evidence] = await db
        .select({ id: evidencesTable.id })
        .from(evidencesTable)
        .where(eq(evidencesTable.documentVersionId, duplicate.version.id))
        .limit(1);
      if (evidence) {
        await linkEvidence(
          evidence.id,
          linkedActivity?.id ?? null,
          indicator ? plan!.id : null,
          parsedQuery.data.indicatorCode ?? null,
          actor.id,
          "Documento repetido; se reutiliza la evidencia existente.",
        );
        if (linkedActivity && indicator) {
          await db
            .insert(activityIndicatorLinksTable)
            .values({
              activityId: linkedActivity.id,
              planId: plan!.id,
              actionCode: indicator.actionCode,
              indicatorCode: parsedQuery.data.indicatorCode!,
              linkedBy: actor.id,
            })
            .onConflictDoNothing();
        }
      }
      const view = await documentView(duplicate.document);
      if (!view) {
        res.status(500).json({ error: "No se pudo recuperar el documento existente." });
        return;
      }
      await recordCaptureAudit(req, actor.id, "document.deduplicated", "document", view.id, {
        sha256,
        linkedActivityId: linkedActivity?.id ?? null,
      });
      res.status(201).json(view);
      return;
    }
    const scanStatus = await scanWithClamAv(data);
    if (scanStatus === "infectado") {
      await recordCaptureAudit(req, actor.id, "document.upload.rejected_infected", "file", sha256);
      res.status(422).json({ error: "El análisis antivirus detectó contenido malicioso; el archivo no se ha guardado." });
      return;
    }

    const documentId = randomUUID();
    await mkdir(DOCUMENT_DIRECTORY, { recursive: true, mode: 0o700 });
    const storageKey = randomUUID();
    const absolutePath = path.join(DOCUMENT_DIRECTORY, storageKey);
    await writeFile(absolutePath, data, { flag: "wx", mode: 0o600 });
    try {
      const document = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(documentsTable)
          .values({
            id: documentId,
            centerId: actor.centerId,
            schoolYearId: year.id,
            title: parsedQuery.data.title.trim(),
            category: parsedQuery.data.category,
            professionalFamily: family ?? null,
            accessScope: parsedQuery.data.accessScope,
            status: "pendiente_revision",
            createdBy: actor.id,
          })
          .returning();
        const [version] = await tx
          .insert(documentVersionsTable)
          .values({
            documentId,
            version: 1,
            originalName: fileName,
            mediaType: descriptor.mediaType,
            sizeBytes: data.length,
            sha256,
            storageKey,
            scanStatus,
            uploadedBy: actor.id,
          })
          .returning();
        const [evidence] = await tx
          .insert(evidencesTable)
          .values({
            documentVersionId: version.id,
            capturedBy: actor.id,
            status: scanStatus === "limpio" ? "pendiente_validacion" : "pendiente_antivirus",
          })
          .returning({ id: evidencesTable.id });
        if (linkedActivity) {
          await tx.insert(evidenceLinksTable).values({
            evidenceId: evidence.id,
            activityId: linkedActivity.id,
            planId: indicator ? plan!.id : null,
            indicatorCode: parsedQuery.data.indicatorCode ?? null,
            linkedBy: actor.id,
          });
        }
        if (linkedActivity && indicator) {
          await tx
            .insert(activityIndicatorLinksTable)
            .values({
              activityId: linkedActivity.id,
              planId: plan!.id,
              actionCode: indicator.actionCode,
              indicatorCode: parsedQuery.data.indicatorCode!,
              linkedBy: actor.id,
            })
            .onConflictDoNothing();
        }
        return created;
      });
      const view = await documentView(document);
      if (!view) {
        res.status(500).json({ error: "No se pudo recuperar el documento guardado." });
        return;
      }
      await recordCaptureAudit(req, actor.id, "document.uploaded", "document", document.id, {
        version: 1,
        sha256,
        sizeBytes: data.length,
        scanStatus,
        activityId: linkedActivity?.id ?? null,
      });
      res.status(201).json(view);
    } catch (error) {
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }
  },
);

router.get(
  "/documents/:documentId",
  requireAuth,
  requirePermission("documents.read"),
  async (req, res) => {
    const actor = await loadCaptureActor(authContext(res).user.id);
    const document = actor
      ? await getDocumentRow(req.params.documentId as string, actor.centerId)
      : null;
    if (!actor || !document || !(await canReadDocument(actor, document))) {
      res.status(404).json({ error: "No se encontró el documento en tu ámbito." });
      return;
    }
    const documentSummary = await documentView(document);
    const versions = await db
      .select({
        version: documentVersionsTable.version,
        originalName: documentVersionsTable.originalName,
        mediaType: documentVersionsTable.mediaType,
        sizeBytes: documentVersionsTable.sizeBytes,
        sha256: documentVersionsTable.sha256,
        scanStatus: documentVersionsTable.scanStatus,
        uploadedBy: documentVersionsTable.uploadedBy,
        createdAt: documentVersionsTable.createdAt,
      })
      .from(documentVersionsTable)
      .where(eq(documentVersionsTable.documentId, document.id))
      .orderBy(desc(documentVersionsTable.version));
    const parsed = GetDocumentResponse.safeParse({
      document: documentSummary,
      versions,
    });
    if (!parsed.success) {
      res.status(500).json({ error: "El documento guardado no coincide con el contrato API." });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.json(parsed.data);
  },
);

router.post(
  "/documents/:documentId/versions",
  requireAuth,
  requireCsrf,
  requirePermission("documents.write"),
  async (req, res) => {
    const actor = await loadCaptureActor(authContext(res).user.id);
    const document = actor
      ? await getDocumentRow(req.params.documentId as string, actor.centerId)
      : null;
    if (!actor || !document || !(await canReadDocument(actor, document))) {
      res.status(404).json({ error: "No se encontró el documento en tu ámbito." });
      return;
    }
    if (
      !hasCoordinationAccess(actor.role) &&
      document.createdBy !== actor.id &&
      !sameFamily(actor.professionalFamily, document.professionalFamily)
    ) {
      res.status(403).json({ error: "No puedes crear versiones de este documento." });
      return;
    }
    const [currentFile] = await db
      .select({ originalName: documentVersionsTable.originalName })
      .from(documentVersionsTable)
      .where(
        and(
          eq(documentVersionsTable.documentId, document.id),
          eq(documentVersionsTable.version, document.currentVersion),
        ),
      )
      .limit(1);
    const fileName = safeFileName(req.get("x-file-name") ?? currentFile?.originalName ?? "");
    if (!fileName) {
      res.status(400).json({ error: "El nombre del archivo de la nueva versión no es válido." });
      return;
    }
    const data = await readRequestBytes(req);
    if (!data) {
      res.status(413).json({ error: `El archivo debe tener entre 1 byte y ${MAX_DOCUMENT_BYTES} bytes.` });
      return;
    }
    const descriptor = fileDescriptor(fileName, data);
    if (!descriptor) {
      res.status(400).json({ error: "El formato no está permitido o la firma del archivo no coincide." });
      return;
    }
    const sha256 = createHash("sha256").update(data).digest("hex");
    const [duplicate] = await db
      .select({ id: documentVersionsTable.id })
      .from(documentVersionsTable)
      .where(
        and(
          eq(documentVersionsTable.documentId, document.id),
          eq(documentVersionsTable.sha256, sha256),
        ),
      )
      .limit(1);
    if (duplicate) {
      res.status(409).json({ error: "Ese contenido ya existe como una versión anterior." });
      return;
    }
    const scanStatus = await scanWithClamAv(data);
    if (scanStatus === "infectado") {
      await recordCaptureAudit(req, actor.id, "document.version.rejected_infected", "document", document.id, { sha256 });
      res.status(422).json({ error: "El análisis antivirus detectó contenido malicioso; la versión no se ha guardado." });
      return;
    }
    const storageKey = randomUUID();
    await mkdir(DOCUMENT_DIRECTORY, { recursive: true, mode: 0o700 });
    const absolutePath = path.join(DOCUMENT_DIRECTORY, storageKey);
    await writeFile(absolutePath, data, { flag: "wx", mode: 0o600 });
    try {
      const updated = await db.transaction(async (tx) => {
        const [saved] = await tx
          .update(documentsTable)
          .set({
            currentVersion: document.currentVersion + 1,
            revision: document.revision + 1,
            status: "pendiente_revision",
            approvedBy: null,
            approvedAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(documentsTable.id, document.id),
              eq(documentsTable.currentVersion, document.currentVersion),
              eq(documentsTable.revision, document.revision),
            ),
          )
          .returning();
        if (!saved) return null;
        const [version] = await tx
          .insert(documentVersionsTable)
          .values({
            documentId: document.id,
            version: saved.currentVersion,
            originalName: fileName,
            mediaType: descriptor.mediaType,
            sizeBytes: data.length,
            sha256,
            storageKey,
            scanStatus,
            uploadedBy: actor.id,
          })
          .returning();
        await tx.insert(evidencesTable).values({
          documentVersionId: version.id,
          capturedBy: actor.id,
          status: scanStatus === "limpio" ? "pendiente_validacion" : "pendiente_antivirus",
        });
        return saved;
      });
      if (!updated) {
        await unlink(absolutePath).catch(() => undefined);
        res.status(409).json({ error: "Otra persona añadió una versión; recarga el documento." });
        return;
      }
      await recordCaptureAudit(req, actor.id, "document.version.added", "document", document.id, {
        version: updated.currentVersion,
        sha256,
        scanStatus,
      });
      const view = await documentView(updated);
      res.status(201).json(view);
    } catch (error) {
      await unlink(absolutePath).catch(() => undefined);
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      ) {
        res.status(409).json({ error: "La versión o su contenido ya existe." });
        return;
      }
      throw error;
    }
  },
);

router.post(
  "/documents/:documentId/approve",
  requireAuth,
  requireCsrf,
  requirePermission("documents.approve"),
  async (req, res) => {
    const parsed = ApproveDocumentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "La revisión del documento no es válida." });
      return;
    }
    const actor = await loadCaptureActor(authContext(res).user.id);
    const document = actor
      ? await getDocumentRow(req.params.documentId as string, actor.centerId)
      : null;
    if (!actor || !hasCoordinationAccess(actor.role) || !document) {
      res.status(404).json({ error: "No se encontró el documento." });
      return;
    }
    if (document.revision !== parsed.data.expectedRevision) {
      res.status(409).json({ error: "El documento cambió; recarga antes de aprobar." });
      return;
    }
    const [version] = await db
      .select()
      .from(documentVersionsTable)
      .where(
        and(
          eq(documentVersionsTable.documentId, document.id),
          eq(documentVersionsTable.version, document.currentVersion),
        ),
      )
      .limit(1);
    if (!version || version.scanStatus !== "limpio") {
      res.status(409).json({ error: "No se puede aprobar: la versión no tiene un análisis antivirus limpio." });
      return;
    }
    const [updated] = await db
      .update(documentsTable)
      .set({
        status: "aprobado",
        revision: document.revision + 1,
        approvedBy: actor.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(documentsTable.id, document.id),
          eq(documentsTable.revision, parsed.data.expectedRevision),
        ),
      )
      .returning();
    if (!updated) {
      res.status(409).json({ error: "El documento cambió durante la aprobación." });
      return;
    }
    await db
      .update(evidencesTable)
      .set({ status: "validada" })
      .where(
        eq(
          evidencesTable.documentVersionId,
          version.id,
        ),
      );
    await recordCaptureAudit(req, actor.id, "document.approved", "document", document.id, {
      version: document.currentVersion,
      sha256: version.sha256,
    });
    res.json(await documentView(updated));
  },
);

router.post(
  "/documents/:documentId/access",
  requireAuth,
  requireCsrf,
  requirePermission("documents.share"),
  async (req, res) => {
    const parsed = SetDocumentAccessBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Los datos del permiso no son válidos." });
      return;
    }
    const actor = await loadCaptureActor(authContext(res).user.id);
    const document = actor
      ? await getDocumentRow(req.params.documentId as string, actor.centerId)
      : null;
    if (!actor || !hasCoordinationAccess(actor.role) || !document) {
      res.status(404).json({ error: "No se encontró el documento." });
      return;
    }
    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.id, parsed.data.userId),
          eq(usersTable.centerId, actor.centerId),
          eq(usersTable.active, true),
        ),
      )
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "La cuenta no está activa en este centro." });
      return;
    }
    const [grant] = await db
      .select()
      .from(documentAccessGrantsTable)
      .where(
        and(
          eq(documentAccessGrantsTable.documentId, document.id),
          eq(documentAccessGrantsTable.userId, user.id),
        ),
      )
      .limit(1);
    if (grant) {
      await db
        .update(documentAccessGrantsTable)
        .set({
          revokedAt: parsed.data.granted ? null : new Date(),
          grantedBy: parsed.data.granted ? actor.id : grant.grantedBy,
          grantedAt: parsed.data.granted ? new Date() : grant.grantedAt,
        })
        .where(eq(documentAccessGrantsTable.id, grant.id));
    } else if (parsed.data.granted) {
      await db.insert(documentAccessGrantsTable).values({
        documentId: document.id,
        userId: user.id,
        grantedBy: actor.id,
      });
    }
    await recordCaptureAudit(req, actor.id, "document.access.changed", "document", document.id, {
      userId: user.id,
      granted: parsed.data.granted,
    });
    res.json({ success: true });
  },
);

router.post(
  "/documents/:documentId/links",
  requireAuth,
  requireCsrf,
  requirePermission("documents.write"),
  async (req, res) => {
    const parsed = LinkDocumentEvidenceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Los datos del vínculo de evidencia no son válidos." });
      return;
    }
    const actor = await loadCaptureActor(authContext(res).user.id);
    const document = actor
      ? await getDocumentRow(req.params.documentId as string, actor.centerId)
      : null;
    if (!actor || !document || !(await canReadDocument(actor, document))) {
      res.status(404).json({ error: "No se encontró el documento en tu ámbito." });
      return;
    }
    const year = await loadActiveSchoolYear(actor.centerId);
    const activity = year
      ? await validateActivityLink(
          actor.id,
          actor.centerId,
          year.id,
          parsed.data.activityId,
        )
      : null;
    if (!activity) {
      res.status(404).json({ error: "No se encontró la actuación en tu ámbito." });
      return;
    }
    const plan = year ? await loadCurrentPlan(actor.centerId, year.id) : null;
    const indicator = parsed.data.indicatorCode
      ? await validateIndicatorLink(plan?.id ?? null, parsed.data.indicatorCode)
      : null;
    if (parsed.data.indicatorCode && !indicator) {
      res.status(400).json({ error: "El indicador no está seleccionado en el PIC activo." });
      return;
    }
    const [version] = await db
      .select()
      .from(documentVersionsTable)
      .where(
        and(
          eq(documentVersionsTable.documentId, document.id),
          eq(documentVersionsTable.version, document.currentVersion),
        ),
      )
      .limit(1);
    const [evidence] = version
      ? await db
          .select()
          .from(evidencesTable)
          .where(eq(evidencesTable.documentVersionId, version.id))
          .limit(1)
      : [];
    if (!evidence) {
      res.status(404).json({ error: "No se encontró la evidencia del documento." });
      return;
    }
    await linkEvidence(
      evidence.id,
      activity.id,
      indicator ? plan!.id : null,
      parsed.data.indicatorCode ?? null,
      actor.id,
      parsed.data.note ?? "",
    );
    if (indicator && plan) {
      await db
        .insert(activityIndicatorLinksTable)
        .values({
          activityId: activity.id,
          planId: plan.id,
          actionCode: indicator.actionCode,
          indicatorCode: parsed.data.indicatorCode!,
          linkedBy: actor.id,
        })
        .onConflictDoNothing();
    }
    await recordCaptureAudit(req, actor.id, "evidence.linked", "document", document.id, {
      activityId: activity.id,
      indicatorCode: parsed.data.indicatorCode ?? null,
    });
    res.status(201).json({ success: true });
  },
);

router.get(
  "/documents/:documentId/versions/:version/content",
  requireAuth,
  requirePermission("documents.read"),
  async (req, res) => {
    const actor = await loadCaptureActor(authContext(res).user.id);
    const document = actor
      ? await getDocumentRow(req.params.documentId as string, actor.centerId)
      : null;
    const versionNumber = Number(req.params.version);
    if (
      !actor ||
      !document ||
      !(await canReadDocument(actor, document)) ||
      !Number.isInteger(versionNumber) ||
      versionNumber < 1
    ) {
      res.status(404).json({ error: "No se encontró la versión solicitada." });
      return;
    }
    const [version] = await db
      .select()
      .from(documentVersionsTable)
      .where(
        and(
          eq(documentVersionsTable.documentId, document.id),
          eq(documentVersionsTable.version, versionNumber),
        ),
      )
      .limit(1);
    if (!version) {
      res.status(404).json({ error: "No se encontró la versión solicitada." });
      return;
    }
    if (version.scanStatus !== "limpio") {
      res.status(409).json({ error: "El archivo está en cuarentena hasta que el análisis antivirus sea limpio." });
      return;
    }
    const absolutePath = path.join(DOCUMENT_DIRECTORY, version.storageKey);
    try {
      await access(absolutePath);
    } catch {
      res.status(404).json({ error: "El contenido del archivo no está disponible." });
      return;
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.download(absolutePath, version.originalName);
  },
);

export default router;

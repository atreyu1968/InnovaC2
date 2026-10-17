import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  centersTable,
  picPlansTable,
  picProjectsTable,
  schoolYearsTable,
  usersTable,
} from "./innova";

export const activitiesTable = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    centerId: uuid("center_id")
      .notNull()
      .references(() => centersTable.id, { onDelete: "cascade" }),
    schoolYearId: uuid("school_year_id")
      .notNull()
      .references(() => schoolYearsTable.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    activityDate: date("activity_date", { mode: "string" }),
    professionalFamily: text("professional_family").notNull(),
    projectId: uuid("project_id").references(() => picProjectsTable.id, {
      onDelete: "set null",
    }),
    responsibleUserId: uuid("responsible_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    fingerprint: text("fingerprint").notNull(),
    status: text("status").notNull().default("pendiente_responsable"),
    informationStatus: text("information_status").notNull().default("en_revision"),
    revision: integer("revision").notNull().default(1),
    confirmedBy: uuid("confirmed_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    validatedBy: uuid("validated_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("activities_center_year_fingerprint_uq").on(
      table.centerId,
      table.schoolYearId,
      table.fingerprint,
    ),
    index("activities_center_year_status_idx").on(
      table.centerId,
      table.schoolYearId,
      table.status,
    ),
    index("activities_family_date_idx").on(
      table.centerId,
      table.professionalFamily,
      table.activityDate,
    ),
    index("activities_responsible_idx").on(table.responsibleUserId, table.status),
    index("activities_revision_positive_idx").on(table.revision),
  ],
);

export const activityVersionsTable = pgTable(
  "activity_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activitiesTable.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    createdBy: uuid("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("activity_versions_activity_revision_uq").on(
      table.activityId,
      table.revision,
    ),
    index("activity_versions_created_idx").on(table.activityId, table.createdAt),
  ],
);

export const activitySourcesTable = pgTable(
  "activity_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activitiesTable.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceReference: text("source_reference"),
    sourceLabel: text("source_label").notNull(),
    sourceFingerprint: text("source_fingerprint").notNull(),
    createdBy: uuid("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("activity_sources_activity_fingerprint_uq").on(
      table.activityId,
      table.sourceFingerprint,
    ),
    index("activity_sources_activity_idx").on(table.activityId),
  ],
);

export const activityPeopleTable = pgTable(
  "activity_people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activitiesTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    displayName: text("display_name").notNull(),
    participationRole: text("participation_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("activity_people_activity_idx").on(table.activityId),
    index("activity_people_user_idx").on(table.userId),
  ],
);

export const activityIndicatorLinksTable = pgTable(
  "activity_indicator_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activitiesTable.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => picPlansTable.id, { onDelete: "cascade" }),
    actionCode: text("action_code").notNull(),
    indicatorCode: text("indicator_code").notNull(),
    linkedBy: uuid("linked_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("activity_indicator_links_activity_plan_code_uq").on(
      table.activityId,
      table.planId,
      table.indicatorCode,
    ),
    index("activity_indicator_links_plan_code_idx").on(
      table.planId,
      table.indicatorCode,
    ),
  ],
);

export const documentsTable = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    centerId: uuid("center_id")
      .notNull()
      .references(() => centersTable.id, { onDelete: "cascade" }),
    schoolYearId: uuid("school_year_id")
      .notNull()
      .references(() => schoolYearsTable.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    category: text("category").notNull().default("evidencia"),
    professionalFamily: text("professional_family"),
    accessScope: text("access_scope").notNull().default("family"),
    status: text("status").notNull().default("pendiente_revision"),
    revision: integer("revision").notNull().default(1),
    currentVersion: integer("current_version").notNull().default(1),
    createdBy: uuid("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    approvedBy: uuid("approved_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("documents_center_year_status_idx").on(
      table.centerId,
      table.schoolYearId,
      table.status,
    ),
    index("documents_family_idx").on(table.centerId, table.professionalFamily),
    index("documents_creator_idx").on(table.createdBy, table.createdAt),
  ],
);

export const documentAccessGrantsTable = pgTable(
  "document_access_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documentsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    grantedBy: uuid("granted_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("document_access_grants_document_user_uq").on(
      table.documentId,
      table.userId,
    ),
    index("document_access_grants_user_idx").on(table.userId, table.revokedAt),
  ],
);

export const documentVersionsTable = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documentsTable.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    originalName: text("original_name").notNull(),
    mediaType: text("media_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    scanStatus: text("scan_status").notNull().default("no_configurado"),
    uploadedBy: uuid("uploaded_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("document_versions_document_version_uq").on(
      table.documentId,
      table.version,
    ),
    uniqueIndex("document_versions_document_hash_uq").on(
      table.documentId,
      table.sha256,
    ),
    uniqueIndex("document_versions_storage_key_uq").on(table.storageKey),
    index("document_versions_hash_idx").on(table.sha256),
  ],
);

export const evidencesTable = pgTable(
  "evidences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .unique()
      .references(() => documentVersionsTable.id, { onDelete: "restrict" }),
    description: text("description").notNull().default(""),
    capturedBy: uuid("captured_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: text("status").notNull().default("pendiente_validacion"),
  },
  (table) => [index("evidences_status_idx").on(table.status, table.capturedAt)],
);

export const evidenceLinksTable = pgTable(
  "evidence_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidencesTable.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id").references(() => activitiesTable.id, {
      onDelete: "cascade",
    }),
    planId: uuid("plan_id").references(() => picPlansTable.id, {
      onDelete: "cascade",
    }),
    indicatorCode: text("indicator_code"),
    linkedBy: uuid("linked_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("evidence_links_activity_idx").on(table.activityId),
    index("evidence_links_indicator_idx").on(
      table.planId,
      table.indicatorCode,
    ),
    uniqueIndex("evidence_links_unique_scope_uq")
      .on(table.evidenceId, table.activityId, table.planId, table.indicatorCode)
      .where(sql`${table.activityId} IS NOT NULL OR ${table.planId} IS NOT NULL`),
  ],
);

export const informationRequestsTable = pgTable(
  "information_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    centerId: uuid("center_id")
      .notNull()
      .references(() => centersTable.id, { onDelete: "cascade" }),
    schoolYearId: uuid("school_year_id")
      .notNull()
      .references(() => schoolYearsTable.id, { onDelete: "restrict" }),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    requestedFields: jsonb("requested_fields").$type<string[]>().notNull(),
    reason: text("reason").notNull(),
    requestKey: text("request_key").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: text("status").notNull().default("solicitada"),
    revision: integer("revision").notNull().default(1),
    createdBy: uuid("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("information_requests_open_dedupe_uq")
      .on(table.centerId, table.schoolYearId, table.requestKey)
      .where(sql`${table.status} = 'solicitada'`),
    index("information_requests_recipient_status_idx").on(
      table.recipientUserId,
      table.status,
      table.dueAt,
    ),
    index("information_requests_subject_idx").on(table.subjectType, table.subjectId),
  ],
);

export const informationResponsesTable = pgTable(
  "information_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => informationRequestsTable.id, { onDelete: "cascade" }),
    responderId: uuid("responder_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    responseStatus: text("response_status").notNull(),
    answers: jsonb("answers").$type<Record<string, unknown>>().notNull(),
    comment: text("comment").notNull().default(""),
    validatedBy: uuid("validated_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("information_responses_request_idx").on(table.requestId, table.createdAt),
  ],
);

export const indicatorObservationsTable = pgTable(
  "indicator_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => picPlansTable.id, { onDelete: "cascade" }),
    indicatorCode: text("indicator_code").notNull(),
    period: text("period").notNull(),
    revision: integer("revision").notNull(),
    value: jsonb("value").$type<number | boolean>().notNull(),
    numerator: numeric("numerator", { mode: "number" }),
    denominator: numeric("denominator", { mode: "number" }),
    method: text("method").notNull(),
    formula: text("formula").notNull(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull(),
    sourceActivityCount: integer("source_activity_count").notNull().default(0),
    assessment: text("assessment").notNull(),
    createdBy: uuid("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    validatedBy: uuid("validated_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("indicator_observations_plan_code_period_revision_uq").on(
      table.planId,
      table.indicatorCode,
      table.period,
      table.revision,
    ),
    index("indicator_observations_latest_idx").on(
      table.planId,
      table.indicatorCode,
      table.createdAt,
    ),
  ],
);

import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", [
  "admin_tecnico",
  "c2_innovacion",
  "equipo_directivo",
  "coordinacion_red",
  "jefatura_departamento",
  "profesorado",
  "consulta_c1",
  "consulta_auditora",
]);

export const centersTable = pgTable("centers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const schoolYearsTable = pgTable(
  "school_years",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    centerId: uuid("center_id")
      .notNull()
      .references(() => centersTable.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("school_years_center_label_uq").on(table.centerId, table.label),
    index("school_years_active_idx").on(table.centerId, table.active),
  ],
);

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    centerId: uuid("center_id")
      .notNull()
      .references(() => centersTable.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_lower_uq").on(table.email),
    index("users_center_role_idx").on(table.centerId, table.role),
  ],
);

export const rolePermissionsTable = pgTable(
  "role_permissions",
  {
    role: userRoleEnum("role").notNull(),
    permission: text("permission").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.role, table.permission] }),
    index("role_permissions_permission_idx").on(table.permission),
  ],
);

export const authSessionsTable = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    csrfHash: text("csrf_hash").notNull(),
    csrfTokenCiphertext: text("csrf_token_ciphertext").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_sessions_token_hash_uq").on(table.tokenHash),
    index("auth_sessions_user_id_idx").on(table.userId),
    index("auth_sessions_expiration_idx").on(table.expiresAt),
  ],
);

export const authLoginAttemptsTable = pgTable(
  "auth_login_attempts",
  {
    key: text("key").primaryKey(),
    attemptCount: integer("attempt_count").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("auth_login_attempts_lock_idx").on(table.lockedUntil)],
);

export const picCatalogsTable = pgTable(
  "pic_catalogs",
  {
    id: uuid("row_id").primaryKey().defaultRandom(),
    catalogId: text("catalog_id").notNull(),
    version: text("version").notNull(),
    state: text("state").notNull(),
    sourceHash: text("source_hash").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    active: boolean("active").notNull().default(false),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("pic_catalogs_catalog_version_uq").on(
      table.catalogId,
      table.version,
    ),
    index("pic_catalogs_active_idx").on(table.active),
  ],
);

export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_logs_user_created_idx").on(table.userId, table.createdAt),
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
  ],
);

export const picPlansTable = pgTable(
  "pic_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    centerId: uuid("center_id")
      .notNull()
      .references(() => centersTable.id, { onDelete: "cascade" }),
    schoolYearId: uuid("school_year_id")
      .notNull()
      .references(() => schoolYearsTable.id, { onDelete: "cascade" }),
    catalogRowId: uuid("catalog_row_id")
      .notNull()
      .references(() => picCatalogsTable.id, { onDelete: "restrict" }),
    catalogVersion: text("catalog_version").notNull(),
    status: text("status").notNull().default("draft"),
    revision: integer("revision").notNull().default(1),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    updatedBy: uuid("updated_by").references(() => usersTable.id, {
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
    uniqueIndex("pic_plans_center_year_uq").on(table.centerId, table.schoolYearId),
    index("pic_plans_status_idx").on(table.status),
  ],
);

export const picDafoTable = pgTable(
  "pic_dafo",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => picPlansTable.id, { onDelete: "cascade" }),
    quadrant: text("quadrant").notNull(),
    position: integer("position").notNull(),
    category: text("category").notNull(),
    situation: text("situation").notNull(),
    customDetail: text("custom_detail"),
  },
  (table) => [
    uniqueIndex("pic_dafo_plan_position_uq").on(
      table.planId,
      table.quadrant,
      table.position,
    ),
    index("pic_dafo_plan_quadrant_idx").on(table.planId, table.quadrant),
  ],
);

export const picProjectsTable = pgTable(
  "pic_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => picPlansTable.id, { onDelete: "cascade" }),
    promoter: text("promoter").notNull(),
    name: text("name").notNull(),
    centerCoordinates: boolean("center_coordinates").notNull().default(false),
    coordinatingFamily: text("coordinating_family").notNull(),
    coordinatorName: text("coordinator_name").notNull(),
    coordinatorEmail: text("coordinator_email").notNull(),
    includedInPic: boolean("included_in_pic").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("pic_projects_plan_idx").on(table.planId),
    index("pic_projects_selected_idx").on(table.planId, table.includedInPic),
  ],
);

export const picActionSelectionsTable = pgTable(
  "pic_action_selections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => picPlansTable.id, { onDelete: "cascade" }),
    actionCode: text("action_code").notNull(),
    objectiveCode: text("objective_code").notNull(),
  },
  (table) => [
    uniqueIndex("pic_action_selections_plan_code_uq").on(
      table.planId,
      table.actionCode,
    ),
    index("pic_action_selections_objective_idx").on(
      table.planId,
      table.objectiveCode,
    ),
  ],
);

export const picIndicatorTargetsTable = pgTable(
  "pic_indicator_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => picPlansTable.id, { onDelete: "cascade" }),
    actionCode: text("action_code").notNull(),
    indicatorId: text("indicator_id").notNull(),
    unit: text("unit").notNull(),
    targetValue: jsonb("target_value").$type<number | boolean>().notNull(),
    riskValue: jsonb("risk_value").$type<number | boolean>().notNull(),
    updatedBy: uuid("updated_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("pic_indicator_targets_plan_id_uq").on(
      table.planId,
      table.indicatorId,
    ),
  ],
);

export const picCustomActionsTable = pgTable(
  "pic_custom_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => picPlansTable.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    objectiveCode: text("objective_code").notNull(),
    title: text("title").notNull(),
    indicatorLabel: text("indicator_label").notNull(),
    unit: text("unit").notNull(),
    targetValue: jsonb("target_value").$type<number | boolean>().notNull(),
    riskValue: jsonb("risk_value").$type<number | boolean>().notNull(),
  },
  (table) => [
    uniqueIndex("pic_custom_actions_plan_position_uq").on(
      table.planId,
      table.position,
    ),
  ],
);

export const picOdsLinksTable = pgTable(
  "pic_ods_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => picPlansTable.id, { onDelete: "cascade" }),
    agenda: text("agenda").notNull(),
    odsCode: text("ods_code").notNull(),
    objectiveCodes: jsonb("objective_codes").$type<string[]>().notNull(),
  },
  (table) => [
    uniqueIndex("pic_ods_links_plan_agenda_code_uq").on(
      table.planId,
      table.agenda,
      table.odsCode,
    ),
  ],
);

export const picCiclopeMembersTable = pgTable(
  "pic_ciclope_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => picPlansTable.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    professionalFamily: text("professional_family").notNull(),
  },
  (table) => [
    uniqueIndex("pic_ciclope_members_plan_position_uq").on(
      table.planId,
      table.position,
    ),
  ],
);

export const picCalendarMeetingsTable = pgTable(
  "pic_calendar_meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => picPlansTable.id, { onDelete: "cascade" }),
    meetingType: text("meeting_type").notNull(),
    position: integer("position").notNull(),
    scheduledDate: date("scheduled_date", { mode: "string" }).notNull(),
  },
  (table) => [
    uniqueIndex("pic_calendar_meetings_plan_type_position_uq").on(
      table.planId,
      table.meetingType,
      table.position,
    ),
  ],
);

export const picSnapshotsTable = pgTable(
  "pic_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => picPlansTable.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    planRevision: integer("plan_revision").notNull(),
    reason: text("reason").notNull(),
    sourceHash: text("source_hash").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    validation: jsonb("validation").$type<Record<string, unknown>>().notNull(),
    createdBy: uuid("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("pic_snapshots_plan_version_uq").on(table.planId, table.version),
  ],
);

export const picSubmissionRecordsTable = pgTable(
  "pic_submission_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => picPlansTable.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => picSnapshotsTable.id, { onDelete: "restrict" }),
    submissionDate: date("submission_date", { mode: "string" }).notNull(),
    externalIdentifier: text("external_identifier"),
    evidenceFileName: text("evidence_file_name").notNull(),
    evidenceMimeType: text("evidence_mime_type").notNull(),
    evidenceSha256: text("evidence_sha256").notNull(),
    evidenceStorageKey: text("evidence_storage_key").notNull(),
    recordedBy: uuid("recorded_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("pic_submission_records_plan_idx").on(table.planId)],
);

export type Center = typeof centersTable.$inferSelect;
export type SchoolYear = typeof schoolYearsTable.$inferSelect;
export type User = typeof usersTable.$inferSelect;
export type AuthSession = typeof authSessionsTable.$inferSelect;
export type PicCatalog = typeof picCatalogsTable.$inferSelect;
export type PicPlan = typeof picPlansTable.$inferSelect;

import {
  date,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { centersTable, picPlansTable, schoolYearsTable, usersTable } from "./innova";
import { documentVersionsTable, documentsTable } from "./capture";

export const picFollowupReportsTable = pgTable(
  "pic_followup_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    centerId: uuid("center_id").notNull().references(() => centersTable.id, { onDelete: "cascade" }),
    schoolYearId: uuid("school_year_id").notNull().references(() => schoolYearsTable.id, { onDelete: "restrict" }),
    planId: uuid("plan_id").notNull().references(() => picPlansTable.id, { onDelete: "restrict" }),
    reportType: text("report_type").notNull(),
    revision: integer("revision").notNull().default(1),
    status: text("status").notNull().default("borrador"),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    updatedBy: uuid("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pic_followup_reports_plan_type_uq").on(table.planId, table.reportType),
    index("pic_followup_reports_year_type_idx").on(table.schoolYearId, table.reportType),
  ],
);

export const picFollowupSnapshotsTable = pgTable(
  "pic_followup_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id").notNull().references(() => picFollowupReportsTable.id, { onDelete: "restrict" }),
    centerId: uuid("center_id").notNull().references(() => centersTable.id, { onDelete: "cascade" }),
    schoolYearId: uuid("school_year_id").notNull().references(() => schoolYearsTable.id, { onDelete: "restrict" }),
    planId: uuid("plan_id").notNull().references(() => picPlansTable.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    reportRevision: integer("report_revision").notNull(),
    reason: text("reason").notNull(),
    sourceHash: text("source_hash").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    validation: jsonb("validation").$type<Record<string, unknown>>().notNull(),
    createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pic_followup_snapshots_report_version_uq").on(table.reportId, table.version),
    index("pic_followup_snapshots_year_type_idx").on(table.schoolYearId, table.createdAt),
  ],
);

export const picFollowupDeliveriesTable = pgTable(
  "pic_followup_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id").notNull().references(() => picFollowupReportsTable.id, { onDelete: "restrict" }),
    snapshotId: uuid("snapshot_id").notNull().references(() => picFollowupSnapshotsTable.id, { onDelete: "restrict" }),
    centerId: uuid("center_id").notNull().references(() => centersTable.id, { onDelete: "cascade" }),
    schoolYearId: uuid("school_year_id").notNull().references(() => schoolYearsTable.id, { onDelete: "restrict" }),
    planId: uuid("plan_id").notNull().references(() => picPlansTable.id, { onDelete: "restrict" }),
    deliveryDate: date("delivery_date", { mode: "string" }).notNull(),
    externalIdentifier: text("external_identifier"),
    proofDocumentId: uuid("proof_document_id").notNull().references(() => documentsTable.id, { onDelete: "restrict" }),
    proofVersionId: uuid("proof_version_id").notNull().references(() => documentVersionsTable.id, { onDelete: "restrict" }),
    proofFileName: text("proof_file_name").notNull(),
    proofSha256: text("proof_sha256").notNull(),
    personConfirmed: boolean("person_confirmed").notNull().default(false),
    confirmation: text("confirmation").notNull(),
    recordedBy: uuid("recorded_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("pic_followup_deliveries_report_idx").on(table.reportId, table.createdAt),
    uniqueIndex("pic_followup_deliveries_snapshot_uq").on(table.snapshotId),
  ],
);

export type PicFollowupReport = typeof picFollowupReportsTable.$inferSelect;
export type PicFollowupSnapshot = typeof picFollowupSnapshotsTable.$inferSelect;
export type PicFollowupDelivery = typeof picFollowupDeliveriesTable.$inferSelect;

import { pgTable, uuid, text, jsonb, integer, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { centersTable, schoolYearsTable, usersTable } from "./innova";

export const ciclopePoliciesTable = pgTable("ciclope_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolYearId: uuid("school_year_id").notNull().unique().references(() => schoolYearsTable.id),
  centerId: uuid("center_id").notNull().references(() => centersTable.id),
  requireInstitutionalApproval: boolean("require_institutional_approval").notNull().default(true),
  authorizedInternalChannel: boolean("authorized_internal_channel").notNull().default(false),
  revision: integer("revision").notNull().default(1),
});
export const ciclopeMeetingsTable = pgTable("ciclope_meetings", {
  id: uuid("id").primaryKey().defaultRandom(),
  centerId: uuid("center_id").notNull().references(() => centersTable.id),
  schoolYearId: uuid("school_year_id").notNull().references(() => schoolYearsTable.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  state: text("state").notNull().default("programada"),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  revision: integer("revision").notNull().default(1),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const ciclopeVersionsTable = pgTable("ciclope_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolYearId: uuid("school_year_id").notNull().references(() => schoolYearsTable.id),
  meetingId: uuid("meeting_id").notNull().references(() => ciclopeMeetingsTable.id),
  revision: integer("revision").notNull(),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("ciclope_version_revision_uq").on(t.meetingId, t.revision)]);
export const ciclopeTasksTable = pgTable("ciclope_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolYearId: uuid("school_year_id").notNull().references(() => schoolYearsTable.id),
  meetingId: uuid("meeting_id").notNull().references(() => ciclopeMeetingsTable.id),
  sourceVersionId: uuid("source_version_id").notNull().references(() => ciclopeVersionsTable.id),
  title: text("title").notNull(),
  responsibleUserId: uuid("responsible_user_id").notNull().references(() => usersTable.id),
  dueDate: text("due_date").notNull(),
  remindersEnabled: boolean("reminders_enabled").notNull().default(false),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
export const ciclopeNoticesTable = pgTable("ciclope_notices", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolYearId: uuid("school_year_id").notNull().references(() => schoolYearsTable.id),
  meetingId: uuid("meeting_id").notNull().references(() => ciclopeMeetingsTable.id),
  recipientUserId: uuid("recipient_user_id").notNull().references(() => usersTable.id),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, uniqueIndex, jsonb, check, index } from "drizzle-orm/pg-core";
import { centersTable, schoolYearsTable, usersTable } from "./innova";
import { activitiesTable } from "./capture";

export const learningSpacesTable = pgTable("learning_spaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  centerId: uuid("center_id").notNull().references(() => centersTable.id),
  schoolYearId: uuid("school_year_id").notNull().references(() => schoolYearsTable.id),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  purpose: text("purpose").notNull().default(""),
  referenceSchedule: text("reference_schedule").notNull().default(""),
  responsibles: text("responsibles").notNull().default(""),
  resources: text("resources").notNull().default(""),
  services: text("services").notNull().default(""),
  revision: integer("revision").notNull().default(1),
  updatedBy: uuid("updated_by").notNull().references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("learning_spaces_year_kind_uq").on(table.schoolYearId, table.kind),
  check("learning_spaces_kind_check", sql`${table.kind} IN ('ateca','fablab')`),
]);

export const spaceReservationsTable = pgTable("space_reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  centerId: uuid("center_id").notNull().references(() => centersTable.id),
  schoolYearId: uuid("school_year_id").notNull().references(() => schoolYearsTable.id),
  title: text("title").notNull(),
  spaceKinds: text("space_kinds").array().notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  professionalFamily: text("professional_family").notNull(),
  groupLabel: text("group_label").notNull().default(""),
  status: text("status").notNull().default("reservada"),
  activityId: uuid("activity_id").references(() => activitiesTable.id, { onDelete: "restrict" }),
  notes: text("notes").notNull().default(""),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id),
  revision: integer("revision").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("space_reservations_year_start_idx").on(table.schoolYearId, table.startsAt),
  check("space_reservations_space_kinds_check", sql`cardinality(${table.spaceKinds}) BETWEEN 1 AND 2 AND ${table.spaceKinds} <@ ARRAY['ateca','fablab']::text[] AND (cardinality(${table.spaceKinds})=1 OR ${table.spaceKinds}[1]<>${table.spaceKinds}[2])`),
  check("space_reservations_ends_at_check", sql`${table.endsAt}>${table.startsAt} AND ${table.endsAt}<=${table.startsAt}+interval '24 hours'`),
  check("space_reservations_status_check", sql`${table.status} IN ('reservada','realizado','cancelada')`),
  check("space_reservations_check", sql`${table.status}<>'realizado' OR ${table.activityId} IS NOT NULL`),
]);

export const spaceVersionsTable = pgTable("space_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  centerId: uuid("center_id").notNull().references(() => centersTable.id),
  schoolYearId: uuid("school_year_id").notNull().references(() => schoolYearsTable.id),
  entityId: uuid("entity_id").notNull(),
  entityType: text("entity_type").notNull(),
  revision: integer("revision").notNull(),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("space_versions_entity_revision_uq").on(table.entityId, table.revision),
  check("space_versions_entity_type_check", sql`${table.entityType} IN ('space','reservation')`),
]);

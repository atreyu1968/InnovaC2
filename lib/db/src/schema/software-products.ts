import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { centersTable, schoolYearsTable, usersTable, picProjectsTable } from "./innova";

export const softwareCatalogsTable = pgTable("software_catalogs", {
  id: uuid("id").primaryKey().defaultRandom(),
  centerId: uuid("center_id").notNull().references(() => centersTable.id),
  schoolYearId: uuid("school_year_id").notNull().references(() => schoolYearsTable.id),
  name: text("name").notNull().default("Innovando en FP"),
  description: text("description").notNull().default(""),
  picProjectId: uuid("pic_project_id").references(() => picProjectsTable.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull().default(1),
}, (t) => [uniqueIndex("software_catalogs_year_uq").on(t.schoolYearId)]);
export const softwareProductsTable = pgTable("software_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  centerId: uuid("center_id").notNull().references(() => centersTable.id),
  schoolYearId: uuid("school_year_id").notNull().references(() => schoolYearsTable.id),
  catalogId: uuid("catalog_id").notNull().references(() => softwareCatalogsTable.id),
  productKey: text("product_key"),
  name: text("name").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>[]>().notNull().default([]),
  revision: integer("revision").notNull().default(1),
  updatedBy: uuid("updated_by").notNull().references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("software_products_year_name_uq").on(t.schoolYearId, sql`lower(${t.name})`),
  uniqueIndex("software_products_year_key_uq").on(t.schoolYearId, t.productKey),
]);
export const softwareRecordsTable = pgTable("software_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  centerId: uuid("center_id").notNull().references(() => centersTable.id),
  schoolYearId: uuid("school_year_id").notNull().references(() => schoolYearsTable.id),
  productId: uuid("product_id").notNull().references(() => softwareProductsTable.id),
  kind: text("kind").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>[]>().notNull().default([]),
  source: text("source").notNull().default("manual"),
  sourceKey: text("source_key"),
  supersedesId: uuid("supersedes_id"),
  revision: integer("revision").notNull(),
  createdBy: uuid("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("software_records_product_source_uq").on(t.productId, t.sourceKey)]);
export const softwareVersionsTable = pgTable("software_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  centerId: uuid("center_id").notNull().references(() => centersTable.id),
  schoolYearId: uuid("school_year_id").notNull().references(() => schoolYearsTable.id),
  entityId: uuid("entity_id").notNull(),
  revision: integer("revision").notNull(),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("software_versions_entity_revision_uq").on(t.entityId, t.revision)]);

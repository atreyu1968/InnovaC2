import { pgTable, uuid, text, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { schoolYearsTable, usersTable, userRoleEnum } from "./innova";

// Roles/families are reviewed for each course; account identity remains global.
export const schoolYearAssignmentsTable = pgTable("school_year_assignments", {
  schoolYearId: uuid("school_year_id").notNull().references(() => schoolYearsTable.id, { onDelete: "restrict" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  role: userRoleEnum("role").notNull(),
  professionalFamily: text("professional_family"),
  reviewedBy: uuid("reviewed_by").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.schoolYearId, t.userId] })]);

export const schoolYearSnapshotsTable = pgTable("school_year_snapshots", {
  schoolYearId: uuid("school_year_id").primaryKey().references(() => schoolYearsTable.id, { onDelete: "restrict" }),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  sourceHash: text("source_hash").notNull(),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

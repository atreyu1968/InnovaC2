import { index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Deliberately independent of provider settings and diagnostic content.
export const aiProviderCheckUsageTable = pgTable("ai_provider_check_usage", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  centerId: uuid("center_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  reservedUntil: timestamp("reserved_until", { withTimezone: true }),
}, table => [
  index("ai_provider_check_usage_user_started").on(table.userId, table.startedAt),
  index("ai_provider_check_usage_center_started").on(table.centerId, table.startedAt),
]);

export const insertAIProviderCheckUsageSchema = createInsertSchema(aiProviderCheckUsageTable);
export type InsertAIProviderCheckUsage = z.infer<typeof insertAIProviderCheckUsageSchema>;
export type AIProviderCheckUsage = typeof aiProviderCheckUsageTable.$inferSelect;

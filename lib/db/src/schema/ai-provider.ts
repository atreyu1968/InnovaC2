import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { centersTable, usersTable } from "./innova";

export const aiProviderSettingsTable = pgTable(
  "ai_provider_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    centerId: uuid("center_id")
      .notNull()
      .references(() => centersTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("disabled"),
    baseUrl: text("base_url"),
    transcriptionModel: text("transcription_model"),
    minutesModel: text("minutes_model"),
    apiKeyCiphertext: text("api_key_ciphertext"),
    apiKeyIv: text("api_key_iv"),
    apiKeyTag: text("api_key_tag"),
    externalAuthorizedAt: timestamp("external_authorized_at", { withTimezone: true }),
    externalAuthorizedBy: uuid("external_authorized_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    revision: integer("revision").notNull().default(1),
    updatedBy: uuid("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("ai_provider_settings_center_uq").on(table.centerId)],
);

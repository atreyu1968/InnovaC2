CREATE TABLE "ai_provider_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "center_id" uuid NOT NULL,
  "provider" text DEFAULT 'disabled' NOT NULL,
  "base_url" text,
  "transcription_model" text,
  "minutes_model" text,
  "api_key_ciphertext" text,
  "api_key_iv" text,
  "api_key_tag" text,
  "external_authorized_at" timestamp with time zone,
  "external_authorized_by" uuid,
  "revision" integer DEFAULT 1 NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_provider_settings_mode_check" CHECK ("provider" IN ('disabled', 'local', 'external_authorized'))
);
ALTER TABLE "ai_provider_settings"
  ADD CONSTRAINT "ai_provider_settings_center_fk"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE CASCADE;
ALTER TABLE "ai_provider_settings"
  ADD CONSTRAINT "ai_provider_settings_authorized_by_fk"
  FOREIGN KEY ("external_authorized_by") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "ai_provider_settings"
  ADD CONSTRAINT "ai_provider_settings_updated_by_fk"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "ai_provider_settings_center_uq" ON "ai_provider_settings" USING btree ("center_id");

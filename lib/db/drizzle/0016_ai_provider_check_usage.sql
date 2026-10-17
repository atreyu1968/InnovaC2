CREATE TABLE "ai_provider_check_usage" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "center_id" uuid NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "reserved_until" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "ai_provider_check_usage_user_started" ON "ai_provider_check_usage" ("user_id", "started_at");
--> statement-breakpoint
CREATE INDEX "ai_provider_check_usage_center_started" ON "ai_provider_check_usage" ("center_id", "started_at");

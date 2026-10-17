CREATE TABLE "school_year_assignments" (
	"school_year_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"professional_family" text,
	"reviewed_by" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_year_assignments_school_year_id_user_id_pk" PRIMARY KEY("school_year_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "school_year_snapshots" (
	"school_year_id" uuid PRIMARY KEY NOT NULL,
	"content" jsonb NOT NULL,
	"source_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "school_years" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "school_years" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_years" ADD COLUMN "closed_by" uuid;--> statement-breakpoint
ALTER TABLE "school_years" ADD COLUMN "close_reason" text;--> statement-breakpoint
ALTER TABLE "school_year_assignments" ADD CONSTRAINT "school_year_assignments_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_year_assignments" ADD CONSTRAINT "school_year_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_year_assignments" ADD CONSTRAINT "school_year_assignments_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_year_snapshots" ADD CONSTRAINT "school_year_snapshots_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_year_snapshots" ADD CONSTRAINT "school_year_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
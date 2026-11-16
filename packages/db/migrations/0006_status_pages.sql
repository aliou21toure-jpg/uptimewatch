CREATE TABLE "status_page_monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"status_page_id" uuid NOT NULL,
	"monitor_id" uuid NOT NULL,
	"display_name" varchar(120),
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "status_page_monitors_unique" UNIQUE("status_page_id","monitor_id")
);
--> statement-breakpoint
CREATE TABLE "status_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"slug" varchar(120) NOT NULL,
	"title" varchar(160) NOT NULL,
	"description" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "status_pages_slug_unique" UNIQUE("slug"),
	CONSTRAINT "status_pages_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "status_pages_slug_format" CHECK ("status_pages"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "status_pages_description_length" CHECK (char_length("status_pages"."description") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "status_page_monitors" ADD CONSTRAINT "status_page_monitors_org_id_status_page_id_status_pages_org_id_id_fk" FOREIGN KEY ("org_id","status_page_id") REFERENCES "public"."status_pages"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_page_monitors" ADD CONSTRAINT "status_page_monitors_org_id_monitor_id_monitors_org_id_id_fk" FOREIGN KEY ("org_id","monitor_id") REFERENCES "public"."monitors"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_pages" ADD CONSTRAINT "status_pages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "status_page_monitors_monitor_idx" ON "status_page_monitors" USING btree ("monitor_id");
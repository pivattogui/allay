CREATE TABLE "backup_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"interval_minutes" integer DEFAULT 60 NOT NULL,
	"max_backups" integer DEFAULT 10 NOT NULL,
	"include_logs" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "backup_configs_server_id_unique" UNIQUE("server_id")
);
--> statement-breakpoint
CREATE TABLE "backups" (
	"id" serial PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"filename" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"server_id" text,
	"type" text NOT NULL,
	"message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"version" text NOT NULL,
	"port" integer NOT NULL,
	"ram_min_mb" integer DEFAULT 1024 NOT NULL,
	"ram_max_mb" integer DEFAULT 2048 NOT NULL,
	"java_version" text,
	"directory" text NOT NULL,
	"auto_start" boolean DEFAULT false NOT NULL,
	"auto_restart" boolean DEFAULT false NOT NULL,
	"restart_limit" integer DEFAULT 3 NOT NULL,
	"icon_path" text,
	"jvm_args" text,
	"java_path" text,
	"restart_schedule" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "servers_port_unique" UNIQUE("port")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "backup_configs" ADD CONSTRAINT "backup_configs_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_backups_server_id" ON "backups" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "idx_events_server_id" ON "events" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "idx_events_created_at" ON "events" USING btree ("created_at");
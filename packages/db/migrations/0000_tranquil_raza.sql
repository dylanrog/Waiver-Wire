CREATE TABLE "analysis_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" text NOT NULL,
	"roster_id" uuid,
	"week" integer NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"season" text NOT NULL,
	"sport" text DEFAULT 'nfl' NOT NULL,
	"total_rosters" integer,
	"status" text,
	"scoring_settings" jsonb,
	"roster_positions" jsonb,
	"settings" jsonb,
	"previous_league_id" text,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"position" text,
	"team" text,
	"bye_week" integer,
	"injury_status" text,
	"fantasy_positions" jsonb,
	"status" text,
	"depth_chart_order" integer,
	"news_updated" bigint,
	"raw" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_fetches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"source" text NOT NULL,
	"week" integer,
	"fetched_at" timestamp with time zone NOT NULL,
	"body" text NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rosters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" text NOT NULL,
	"sleeper_roster_id" integer NOT NULL,
	"sleeper_owner_id" text,
	"owner_display_name" text,
	"team_name" text,
	"is_current_user" boolean DEFAULT false NOT NULL,
	"players" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"starters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reserve" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"taxi" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settings" jsonb,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_rankings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"week" integer NOT NULL,
	"position" text NOT NULL,
	"rank" integer NOT NULL,
	"player_id" text NOT NULL,
	"source_excerpt" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unresolved_names" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"week" integer NOT NULL,
	"raw_name" text NOT NULL,
	"position" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_roster_id_rosters_id_fk" FOREIGN KEY ("roster_id") REFERENCES "public"."rosters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rosters" ADD CONSTRAINT "rosters_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_rankings" ADD CONSTRAINT "source_rankings_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "players_position_idx" ON "players" USING btree ("position");--> statement-breakpoint
CREATE INDEX "players_team_idx" ON "players" USING btree ("team");--> statement-breakpoint
CREATE INDEX "raw_fetches_source_week_idx" ON "raw_fetches" USING btree ("source","week","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rosters_league_roster_uq" ON "rosters" USING btree ("league_id","sleeper_roster_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_rankings_snapshot_uq" ON "source_rankings" USING btree ("source","week","position","rank");--> statement-breakpoint
CREATE INDEX "source_rankings_lookup_idx" ON "source_rankings" USING btree ("source","week","position");--> statement-breakpoint
CREATE UNIQUE INDEX "unresolved_names_uq" ON "unresolved_names" USING btree ("source","week","raw_name","position");
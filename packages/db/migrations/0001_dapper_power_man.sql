CREATE TABLE "nfl_games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season" text NOT NULL,
	"week" integer NOT NULL,
	"kickoff" timestamp with time zone NOT NULL,
	"home_team" text NOT NULL,
	"away_team" text NOT NULL,
	"status" text NOT NULL,
	"raw" jsonb,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_projections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" text NOT NULL,
	"season" text NOT NULL,
	"week" integer NOT NULL,
	"scoring" text NOT NULL,
	"points" real,
	"raw" jsonb,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rosters" ADD COLUMN "raw" jsonb;--> statement-breakpoint
ALTER TABLE "platform_projections" ADD CONSTRAINT "platform_projections_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nfl_games_uq" ON "nfl_games" USING btree ("season","week","home_team","away_team");--> statement-breakpoint
CREATE INDEX "nfl_games_week_idx" ON "nfl_games" USING btree ("season","week");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_projections_uq" ON "platform_projections" USING btree ("player_id","season","week","scoring");--> statement-breakpoint
CREATE INDEX "platform_projections_lookup_idx" ON "platform_projections" USING btree ("season","week","scoring");
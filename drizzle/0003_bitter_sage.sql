CREATE TYPE "public"."subscription_plan" AS ENUM('free', 'pro', 'max');--> statement-breakpoint
CREATE TABLE "monthly_usage" (
	"user_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"images" integer DEFAULT 0 NOT NULL,
	"videos" integer DEFAULT 0 NOT NULL,
	"mix_runs" integer DEFAULT 0 NOT NULL,
	"web_searches" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_usage_user_id_period_start_pk" PRIMARY KEY("user_id","period_start"),
	CONSTRAINT "monthly_usage_nonnegative" CHECK ("monthly_usage"."tokens" >= 0 AND "monthly_usage"."images" >= 0 AND "monthly_usage"."videos" >= 0 AND "monthly_usage"."mix_runs" >= 0 AND "monthly_usage"."web_searches" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user_plans" (
	"user_id" text PRIMARY KEY NOT NULL,
	"plan" "subscription_plan" DEFAULT 'free' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monthly_usage" ADD CONSTRAINT "monthly_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_plans" ADD CONSTRAINT "user_plans_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_usage_user_period_idx" ON "monthly_usage" USING btree ("user_id","period_start");
CREATE TYPE "public"."plan_source" AS ENUM('manual', 'stripe');--> statement-breakpoint
ALTER TABLE "user_plans" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_plans" ADD COLUMN "source" "plan_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_plans" ADD COLUMN "external_subscription_id" text;
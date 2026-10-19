ALTER TABLE "monthly_usage" DROP CONSTRAINT "monthly_usage_nonnegative";--> statement-breakpoint
DROP INDEX "monthly_usage_user_period_idx";--> statement-breakpoint
ALTER TABLE "monthly_usage" DROP COLUMN "mix_runs";--> statement-breakpoint
ALTER TABLE "monthly_usage" ADD CONSTRAINT "monthly_usage_nonnegative" CHECK ("monthly_usage"."tokens" >= 0 AND "monthly_usage"."images" >= 0 AND "monthly_usage"."videos" >= 0 AND "monthly_usage"."web_searches" >= 0);
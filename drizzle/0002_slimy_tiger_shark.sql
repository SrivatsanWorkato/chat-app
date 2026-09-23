CREATE TABLE "provider_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"active_provider_id" uuid
);
--> statement-breakpoint
CREATE TABLE "provider_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(60) NOT NULL,
	"base_url" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"api_key_iv" text NOT NULL,
	"api_key_tag" text NOT NULL,
	"brain_model" varchar(300) NOT NULL,
	"blitz_model" varchar(300) NOT NULL,
	"image_model" varchar(300) NOT NULL,
	"fallback_enabled" boolean DEFAULT false NOT NULL,
	"brain_fallback_model" varchar(300) DEFAULT '' NOT NULL,
	"blitz_fallback_model" varchar(300) DEFAULT '' NOT NULL,
	"image_fallback_model" varchar(300) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_preferences" ADD CONSTRAINT "provider_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_preferences" ADD CONSTRAINT "provider_preferences_active_provider_id_provider_profiles_id_fk" FOREIGN KEY ("active_provider_id") REFERENCES "public"."provider_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_profiles_user_id_idx" ON "provider_profiles" USING btree ("user_id");
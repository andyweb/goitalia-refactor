CREATE TABLE IF NOT EXISTS "whatsapp_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "phone_number" text NOT NULL,
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "status" text DEFAULT 'inactive' NOT NULL,
  "interval" text DEFAULT 'monthly' NOT NULL,
  "current_period_end" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wa_subs_company_phone_uq" ON "whatsapp_subscriptions" ("company_id", "phone_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wa_subs_company" ON "whatsapp_subscriptions" ("company_id");

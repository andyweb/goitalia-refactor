CREATE TABLE "whatsapp_contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "phone_number" text NOT NULL,
  "name" text,
  "notes" text,
  "custom_instructions" text,
  "auto_mode" text DEFAULT 'inherit' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wa_contacts_agent_phone" ON "whatsapp_contacts" ("agent_id", "phone_number");
--> statement-breakpoint
CREATE INDEX "idx_wa_contacts_company" ON "whatsapp_contacts" ("company_id");
--> statement-breakpoint
CREATE TABLE "whatsapp_contact_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contact_id" uuid NOT NULL REFERENCES "whatsapp_contacts"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "type" text DEFAULT 'upload' NOT NULL,
  "mime_type" text,
  "size_bytes" integer,
  "drive_url" text,
  "drive_file_id" text,
  "content_text" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_wa_contact_files_contact" ON "whatsapp_contact_files" ("contact_id");
--> statement-breakpoint
CREATE INDEX "idx_wa_contact_files_company" ON "whatsapp_contact_files" ("company_id");

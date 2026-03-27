-- Step 1: Create company_profiles table
CREATE TABLE "company_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  -- Anagrafica
  "ragione_sociale" text,
  "partita_iva" text,
  "codice_fiscale" text,
  "forma_giuridica" text,
  "stato_attivita" text,
  "data_inizio" text,
  "settore" text,
  -- Sede
  "indirizzo" text,
  "citta" text,
  "cap" text,
  "provincia" text,
  "regione" text,
  -- Contatti
  "telefono" text,
  "email" text,
  "whatsapp" text,
  "pec" text,
  "codice_sdi" text,
  "sito_web" text,
  -- Economici
  "dipendenti" text,
  "fatturato" text,
  "patrimonio_netto" text,
  "capitale_sociale" text,
  "totale_attivo" text,
  -- Affidabilita
  "risk_score" text,
  "rating" text,
  "risk_severity" text,
  "credit_limit" text,
  -- Soci
  "soci" text,
  -- Note
  "note" text,
  -- A2A (ex a2a_profiles)
  "slug" text,
  "tags" jsonb DEFAULT '[]'::jsonb,
  "services" jsonb DEFAULT '[]'::jsonb,
  "visibility" text NOT NULL DEFAULT 'hidden',
  "description" text,
  -- Timestamps
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "company_profiles_company_id_key" ON "company_profiles" ("company_id");
--> statement-breakpoint
CREATE INDEX "idx_company_profiles_slug" ON "company_profiles" ("slug");
--> statement-breakpoint
CREATE INDEX "idx_company_profiles_visibility" ON "company_profiles" ("visibility");
--> statement-breakpoint

-- Step 2: Migrate data from ceo_memory.company_info into company_profiles
INSERT INTO "company_profiles" (
  "company_id",
  "ragione_sociale", "partita_iva", "codice_fiscale", "forma_giuridica",
  "stato_attivita", "data_inizio", "settore",
  "indirizzo", "citta", "cap", "provincia", "regione",
  "telefono", "email", "whatsapp", "pec", "codice_sdi", "sito_web",
  "dipendenti", "fatturato", "patrimonio_netto", "capitale_sociale", "totale_attivo",
  "risk_score", "rating", "risk_severity", "credit_limit",
  "soci", "note"
)
SELECT
  cm.company_id,
  cm.company_info->>'ragione_sociale',
  cm.company_info->>'partita_iva',
  cm.company_info->>'codice_fiscale',
  cm.company_info->>'forma_giuridica',
  cm.company_info->>'stato_attivita',
  cm.company_info->>'data_inizio',
  cm.company_info->>'settore',
  cm.company_info->>'indirizzo',
  cm.company_info->>'citta',
  cm.company_info->>'cap',
  cm.company_info->>'provincia',
  cm.company_info->>'regione',
  cm.company_info->>'telefono',
  cm.company_info->>'email',
  cm.company_info->>'whatsapp',
  cm.company_info->>'pec',
  cm.company_info->>'codice_sdi',
  cm.company_info->>'sito_web',
  cm.company_info->>'dipendenti',
  cm.company_info->>'fatturato',
  cm.company_info->>'patrimonio_netto',
  cm.company_info->>'capitale_sociale',
  cm.company_info->>'totale_attivo',
  cm.company_info->>'risk_score',
  cm.company_info->>'rating',
  cm.company_info->>'risk_severity',
  cm.company_info->>'credit_limit',
  cm.company_info->>'soci',
  cm.company_info->>'note'
FROM "ceo_memory" cm
WHERE cm.company_info IS NOT NULL
  AND cm.company_id IN (SELECT id FROM "companies");
--> statement-breakpoint

-- Step 3: Update company_profiles with A2A data (slug, tags, services, visibility, description)
UPDATE "company_profiles" cp SET
  "slug" = ap."slug",
  "tags" = ap."tags",
  "services" = ap."services",
  "visibility" = ap."visibility",
  "description" = COALESCE(ap."description", cp."description")
FROM "a2a_profiles" ap
WHERE ap."company_id" = cp."company_id";
--> statement-breakpoint

-- Step 4: Insert company_profiles for companies that have a2a_profiles but no ceo_memory
INSERT INTO "company_profiles" ("company_id", "slug", "tags", "services", "visibility", "description")
SELECT
  ap."company_id", ap."slug", ap."tags", ap."services", ap."visibility", ap."description"
FROM "a2a_profiles" ap
WHERE ap."company_id" NOT IN (SELECT "company_id" FROM "company_profiles");
--> statement-breakpoint

-- Step 5: Drop a2a_profiles table
DROP TABLE IF EXISTS "a2a_profiles" CASCADE;
--> statement-breakpoint

-- Step 6: Remove company_info column from ceo_memory (keep notes, preferences, onboarding_step)
ALTER TABLE "ceo_memory" DROP COLUMN IF EXISTS "company_info";

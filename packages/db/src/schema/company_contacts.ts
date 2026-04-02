import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const companyContacts = pgTable("company_contacts", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  source: text("source").notNull().default("google"), // google | manual | fic
  sourceId: text("source_id"), // Google People API resourceName
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  company: text("company"),
  jobTitle: text("job_title"),
  photoUrl: text("photo_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("uq_company_contact_source").on(t.companyId, t.source, t.sourceId),
]);

import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { whatsappContacts } from "./whatsapp_contacts.js";

export const whatsappContactFiles = pgTable("whatsapp_contact_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").notNull().references(() => whatsappContacts.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull().default("upload"), // upload | drive_link
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  driveUrl: text("drive_url"),
  driveFileId: text("drive_file_id"),
  contentText: text("content_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  contactIdx: index("idx_wa_contact_files_contact").on(table.contactId),
  companyIdx: index("idx_wa_contact_files_company").on(table.companyId),
}));

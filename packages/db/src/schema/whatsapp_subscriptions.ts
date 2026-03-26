import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const whatsappSubscriptions = pgTable(
  "whatsapp_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    phoneNumber: text("phone_number").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status").notNull().default("inactive"), // active, inactive, past_due, cancelled
    interval: text("interval").notNull().default("monthly"), // monthly, annual
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyPhoneUq: uniqueIndex("wa_subs_company_phone_uq").on(table.companyId, table.phoneNumber),
    companyIdx: index("idx_wa_subs_company").on(table.companyId),
  }),
);

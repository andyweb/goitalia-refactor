import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import { encrypt, decrypt } from "../utils/crypto.js";
import { upsertConnectorAccount, removeConnectorAccount } from "../utils/connector-sync.js";

async function getStripeKey(db: Db, companyId: string): Promise<string | null> {
  const secret = await db.select().from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "stripe_api_key")))
    .then((r) => r[0]);
  if (!secret?.description) return null;
  try { return decrypt(secret.description); } catch { return null; }
}

export function stripeConnectorRoutes(db: Db) {
  const router = Router();

  // GET /stripe/status?companyId=xxx
  router.get("/stripe/status", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }
    const key = await getStripeKey(db, companyId);
    if (!key) { res.json({ connected: false }); return; }
    // Verify key is valid
    try {
      const r = await fetch("https://api.stripe.com/v1/account", {
        headers: { Authorization: "Bearer " + key },
      });
      if (!r.ok) { res.json({ connected: false }); return; }
      const data = await r.json() as { display_name?: string; email?: string; business_profile?: { name?: string } };
      const name = data.business_profile?.name || data.display_name || data.email || "Account Stripe";
      res.json({ connected: true, accountName: name });
    } catch { res.json({ connected: false }); }
  });

  // POST /stripe/connect
  router.post("/stripe/connect", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, apiKey } = req.body as { companyId: string; apiKey: string };
    if (!companyId || !apiKey) { res.status(400).json({ error: "Campi obbligatori mancanti" }); return; }
    if (!apiKey.startsWith("sk_")) { res.status(400).json({ error: "Chiave non valida. Usa la Secret Key (sk_live_ o sk_test_)" }); return; }

    // Verify key
    try {
      const r = await fetch("https://api.stripe.com/v1/account", {
        headers: { Authorization: "Bearer " + apiKey },
      });
      if (!r.ok) { res.status(400).json({ error: "Chiave Stripe non valida o non autorizzata" }); return; }
      const data = await r.json() as { display_name?: string; email?: string; business_profile?: { name?: string } };
      const accountName = data.business_profile?.name || data.display_name || data.email || "Account Stripe";

      // Save encrypted
      const enc = encrypt(apiKey);
      const existing = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "stripe_api_key")))
        .then((r) => r[0]);

      if (existing) {
        await db.update(companySecrets).set({ description: enc, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
      } else {
        await db.insert(companySecrets).values({ companyId, name: "stripe_api_key", description: enc });
      }

      await upsertConnectorAccount(db, companyId, "stripe", "default", accountName);
      res.json({ connected: true, accountName });
    } catch (err) {
      console.error("[stripe-connector] connect error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /stripe/disconnect
  router.post("/stripe/disconnect", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId } = req.body as { companyId: string };
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }

    await db.delete(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "stripe_api_key")));
    await removeConnectorAccount(db, companyId, "stripe", "default");
    res.json({ disconnected: true });
  });

  return router;
}

// Helper exported for chat.ts tool handlers
export async function getStripeApiKey(db: Db, companyId: string): Promise<string | null> {
  return getStripeKey(db, companyId);
}

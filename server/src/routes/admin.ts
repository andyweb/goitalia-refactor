import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companies, agents, connectorAccounts, companyProfiles, customConnectors, whatsappSubscriptions } from "@goitalia/db";
import { eq, sql, ne, count } from "drizzle-orm";

const ADMIN_EMAILS = ["emanuele@unvrslabs.dev", "andreaspurio20@gmail.com"];

export function adminRoutes(db: Db) {
  const router = Router();

  // Middleware: only admin
  const requireAdmin = async (req: any, res: any, next: any) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const user = await db.execute(sql`SELECT email FROM "user" WHERE id = ${actor.userId}`);
    const rows = (user as any).rows || user;
    const ADMIN_USER_IDS = ["nAVU4wn2Chz3WJdcvl6JmoDbBfXJsX5y", "RRJucp2b1t5frH8ezTJKCNWuT1on8n71"];
    if (!rows[0] || (!ADMIN_EMAILS.includes(rows[0].email) && !ADMIN_USER_IDS.includes(actor.userId))) { res.status(403).json({ error: "Accesso negato" }); return; }
    next();
  };

  // GET /admin/stats — overview stats
  router.get("/admin/stats", requireAdmin, async (_req, res) => {
    try {
      const [companiesCount] = await db.select({ count: count() }).from(companies);
      const [agentsCount] = await db.select({ count: count() }).from(agents).where(ne(agents.status, "terminated"));
      const [connectorsCount] = await db.select({ count: count() }).from(connectorAccounts);

      const usersResult = await db.execute(sql`SELECT count(*) as count FROM "user"`);
      const usersRows = (usersResult as any).rows || usersResult;
      const totalUsers = usersRows[0]?.count || 0;

      res.json({
        totalCompanies: companiesCount.count,
        totalUsers: Number(totalUsers),
        totalAgents: agentsCount.count,
        totalConnectors: connectorsCount.count,
      });
    } catch (err) {
      console.error("[admin] stats error:", err);
      res.status(500).json({ error: "Errore" });
    }
  });

  // GET /admin/companies — all companies with details
  router.get("/admin/companies", requireAdmin, async (_req, res) => {
    try {
      const allCompanies = await db.select({
        id: companies.id,
        name: companies.name,
        issuePrefix: companies.issuePrefix,
        createdAt: companies.createdAt,
      }).from(companies);

      // Enrich with profile, agents count, connectors count
      const enriched = await Promise.all(allCompanies.map(async (c) => {
        const profile = await db.select({
          ragioneSociale: companyProfiles.ragioneSociale,
          partitaIva: companyProfiles.partitaIva,
          citta: companyProfiles.citta,
          settore: companyProfiles.settore,
          telefono: companyProfiles.telefono,
          email: companyProfiles.email,
        }).from(companyProfiles).where(eq(companyProfiles.companyId, c.id)).then(r => r[0]);

        const [agentCount] = await db.select({ count: count() }).from(agents)
          .where(eq(agents.companyId, c.id));
        const activeAgents = await db.select({ count: count() }).from(agents)
          .where(sql`${agents.companyId} = ${c.id} AND ${agents.status} != 'terminated'`);

        const connectors = await db.select({
          connectorType: connectorAccounts.connectorType,
          accountLabel: connectorAccounts.accountLabel,
        }).from(connectorAccounts).where(eq(connectorAccounts.companyId, c.id));

        // Users for this company
        const usersResult = await db.execute(
          sql`SELECT u.id, u.email, u.name FROM "user" u JOIN company_memberships cm ON cm.principal_id = u.id WHERE cm.company_id = ${c.id} AND u.email != 'emanuele@unvrslabs.dev'`
        );
        const users = ((usersResult as any).rows || usersResult) as Array<{ id: string; email: string; name: string }>;

        // Subscriptions
        const waSubs = await db.select().from(whatsappSubscriptions)
          .where(eq(whatsappSubscriptions.companyId, c.id));

        const subscriptions: Array<{ service: string; status: string; phone?: string; expiresAt?: string }> = [];
        for (const sub of waSubs) {
          subscriptions.push({
            service: "WhatsApp",
            status: sub.status || "unknown",
            phone: (sub as any).phoneNumber || undefined,
            expiresAt: (sub as any).expiresAt?.toISOString() || undefined,
          });
        }
        // Placeholder for future subscriptions (platform, AI credits, etc.)

        return {
          ...c,
          profile: profile || null,
          agentsTotal: agentCount.count,
          agentsActive: activeAgents[0].count,
          connectors: connectors.map(co => ({ type: co.connectorType, label: co.accountLabel })),
          users,
          subscriptions,
        };
      }));

      res.json(enriched);
    } catch (err) {
      console.error("[admin] companies error:", err);
      res.status(500).json({ error: "Errore" });
    }
  });

  // POST /admin/sacred-rule — modify the sacred A2A priority rule (requires password)
  router.post("/admin/sacred-rule", requireAdmin, async (req, res) => {
    const { password, action, newCompanyId } = req.body;
    if (!password) { res.status(400).json({ error: "Password richiesta" }); return; }

    // Verify password against stored hash
    const rule = await db.execute(sql`SELECT rule_hash, protected_company_id FROM platform_rules WHERE id = 'a2a_priority'`);
    const rows = (rule as any).rows || rule;
    if (!rows[0]) { res.status(404).json({ error: "Regola non trovata" }); return; }

    const inputHash = require("crypto").createHash("sha256").update(password).digest("hex");
    if (inputHash !== rows[0].rule_hash) { res.status(403).json({ error: "Password errata" }); return; }

    if (action === "update" && newCompanyId) {
      await db.execute(sql`UPDATE platform_rules SET protected_company_id = ${newCompanyId} WHERE id = 'a2a_priority'`);
      res.json({ updated: true, companyId: newCompanyId });
    } else if (action === "status") {
      res.json({ companyId: rows[0].protected_company_id, active: true });
    } else {
      res.status(400).json({ error: "Azione non valida" });
    }
  });

  // GET /admin/my-admin-companies — returns company IDs where user is admin_viewer (for hiding from switcher)
  router.get("/admin/my-admin-companies", async (req, res) => {
    const actor = req.actor as { userId?: string } | undefined;
    if (!actor?.userId) { res.json([]); return; }
    try {
      const rows = await db.execute(
        sql`SELECT company_id FROM company_memberships WHERE principal_id = ${actor.userId} AND membership_role = 'admin_viewer'`
      );
      const result = ((rows as any).rows || rows) as Array<{ company_id: string }>;
      res.json(result.map(r => r.company_id));
    } catch { res.json([]); }
  });

  return router;
}

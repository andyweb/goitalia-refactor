import { Router } from "express";
import type { Db } from "@goitalia/db";
import { customConnectors, companySecrets } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import { encrypt, decrypt } from "../utils/crypto.js";
import { upsertConnectorAccount, removeConnectorAccount } from "../utils/connector-sync.js";
import { randomUUID } from "node:crypto";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").substring(0, 30);
}

// Pre-configured CRM templates
const CRM_TEMPLATES: Record<string, {
  name: string; slug: string; baseUrl: string; description: string;
  authType: string; authHeader: string; authPrefix: string;
  actions: any[];
}> = {
  hubspot: {
    name: "HubSpot CRM",
    slug: "hubspot",
    baseUrl: "https://api.hubapi.com",
    description: "CRM HubSpot — contatti, aziende, deal, note",
    authType: "bearer", authHeader: "Authorization", authPrefix: "Bearer",
    actions: [
      { name: "lista_contatti", label: "Lista Contatti", description: "Recupera i contatti dal CRM", method: "GET", path: "/crm/v3/objects/contacts", params: [
        { name: "limit", type: "number", required: false, in: "query", description: "Max risultati (default 10, max 100)" },
        { name: "properties", type: "string", required: false, in: "query", description: "Proprietà da includere (es: email,firstname,lastname,phone)" },
        { name: "after", type: "string", required: false, in: "query", description: "Cursore paginazione" },
      ], body_template: null },
      { name: "cerca_contatto", label: "Cerca Contatto", description: "Cerca un contatto per email, nome o telefono", method: "POST", path: "/crm/v3/objects/contacts/search", params: [
        { name: "email", type: "string", required: false, in: "body", description: "Email da cercare" },
        { name: "nome", type: "string", required: false, in: "body", description: "Nome da cercare" },
      ], body_template: null },
      { name: "crea_contatto", label: "Crea Contatto", description: "Crea un nuovo contatto nel CRM", method: "POST", path: "/crm/v3/objects/contacts", params: [
        { name: "email", type: "string", required: true, in: "body", description: "Email del contatto" },
        { name: "firstname", type: "string", required: false, in: "body", description: "Nome" },
        { name: "lastname", type: "string", required: false, in: "body", description: "Cognome" },
        { name: "phone", type: "string", required: false, in: "body", description: "Telefono" },
        { name: "company", type: "string", required: false, in: "body", description: "Azienda" },
      ], body_template: null },
      { name: "lista_deal", label: "Lista Deal", description: "Recupera le opportunità/deal dal CRM", method: "GET", path: "/crm/v3/objects/deals", params: [
        { name: "limit", type: "number", required: false, in: "query", description: "Max risultati" },
        { name: "properties", type: "string", required: false, in: "query", description: "Proprietà (es: dealname,amount,dealstage,closedate)" },
      ], body_template: null },
      { name: "crea_deal", label: "Crea Deal", description: "Crea una nuova opportunità/deal", method: "POST", path: "/crm/v3/objects/deals", params: [
        { name: "dealname", type: "string", required: true, in: "body", description: "Nome del deal" },
        { name: "amount", type: "string", required: false, in: "body", description: "Importo" },
        { name: "dealstage", type: "string", required: false, in: "body", description: "Fase (appointmentscheduled, qualifiedtobuy, closedwon, closedlost)" },
        { name: "closedate", type: "string", required: false, in: "body", description: "Data chiusura (YYYY-MM-DD)" },
      ], body_template: null },
      { name: "lista_aziende", label: "Lista Aziende", description: "Recupera le aziende dal CRM", method: "GET", path: "/crm/v3/objects/companies", params: [
        { name: "limit", type: "number", required: false, in: "query", description: "Max risultati" },
        { name: "properties", type: "string", required: false, in: "query", description: "Proprietà (es: name,domain,industry,city,phone)" },
      ], body_template: null },
      { name: "crea_azienda", label: "Crea Azienda", description: "Crea una nuova azienda nel CRM", method: "POST", path: "/crm/v3/objects/companies", params: [
        { name: "name", type: "string", required: true, in: "body", description: "Nome azienda" },
        { name: "domain", type: "string", required: false, in: "body", description: "Dominio web" },
        { name: "industry", type: "string", required: false, in: "body", description: "Settore" },
        { name: "city", type: "string", required: false, in: "body", description: "Città" },
        { name: "phone", type: "string", required: false, in: "body", description: "Telefono" },
      ], body_template: null },
      { name: "lista_note", label: "Lista Note", description: "Recupera le note/attività", method: "GET", path: "/crm/v3/objects/notes", params: [
        { name: "limit", type: "number", required: false, in: "query", description: "Max risultati" },
        { name: "properties", type: "string", required: false, in: "query", description: "Proprietà (es: hs_note_body,hs_timestamp)" },
      ], body_template: null },
    ],
  },
  salesforce: {
    name: "Salesforce CRM",
    slug: "salesforce",
    baseUrl: "", // Set by user (instance URL)
    description: "CRM Salesforce — contatti, account, opportunità, task",
    authType: "bearer", authHeader: "Authorization", authPrefix: "Bearer",
    actions: [
      { name: "lista_contatti", label: "Lista Contatti", description: "Recupera i contatti da Salesforce", method: "GET", path: "/services/data/v62.0/query", params: [
        { name: "q", type: "string", required: true, in: "query", description: "Query SOQL (es: SELECT Id,FirstName,LastName,Email,Phone FROM Contact LIMIT 100)" },
      ], body_template: null },
      { name: "cerca_contatto", label: "Cerca Contatto", description: "Cerca contatto per email o nome", method: "GET", path: "/services/data/v62.0/query", params: [
        { name: "q", type: "string", required: true, in: "query", description: "Query SOQL con WHERE (es: SELECT Id,FirstName,LastName,Email FROM Contact WHERE Email='mario@example.com')" },
      ], body_template: null },
      { name: "crea_contatto", label: "Crea Contatto", description: "Crea un nuovo contatto in Salesforce", method: "POST", path: "/services/data/v62.0/sobjects/Contact", params: [
        { name: "FirstName", type: "string", required: false, in: "body", description: "Nome" },
        { name: "LastName", type: "string", required: true, in: "body", description: "Cognome" },
        { name: "Email", type: "string", required: false, in: "body", description: "Email" },
        { name: "Phone", type: "string", required: false, in: "body", description: "Telefono" },
      ], body_template: null },
      { name: "lista_opportunita", label: "Lista Opportunità", description: "Recupera le opportunità", method: "GET", path: "/services/data/v62.0/query", params: [
        { name: "q", type: "string", required: true, in: "query", description: "Query SOQL (es: SELECT Id,Name,Amount,StageName,CloseDate FROM Opportunity LIMIT 100)" },
      ], body_template: null },
      { name: "crea_opportunita", label: "Crea Opportunità", description: "Crea una nuova opportunità", method: "POST", path: "/services/data/v62.0/sobjects/Opportunity", params: [
        { name: "Name", type: "string", required: true, in: "body", description: "Nome opportunità" },
        { name: "Amount", type: "number", required: false, in: "body", description: "Importo" },
        { name: "StageName", type: "string", required: true, in: "body", description: "Fase (Prospecting, Qualification, Closed Won, Closed Lost)" },
        { name: "CloseDate", type: "string", required: true, in: "body", description: "Data chiusura (YYYY-MM-DD)" },
      ], body_template: null },
      { name: "lista_account", label: "Lista Account", description: "Recupera gli account/aziende", method: "GET", path: "/services/data/v62.0/query", params: [
        { name: "q", type: "string", required: true, in: "query", description: "Query SOQL (es: SELECT Id,Name,Industry,Phone,Website FROM Account LIMIT 100)" },
      ], body_template: null },
      { name: "crea_account", label: "Crea Account", description: "Crea un nuovo account/azienda", method: "POST", path: "/services/data/v62.0/sobjects/Account", params: [
        { name: "Name", type: "string", required: true, in: "body", description: "Nome azienda" },
        { name: "Industry", type: "string", required: false, in: "body", description: "Settore" },
        { name: "Phone", type: "string", required: false, in: "body", description: "Telefono" },
        { name: "Website", type: "string", required: false, in: "body", description: "Sito web" },
      ], body_template: null },
      { name: "lista_task", label: "Lista Task", description: "Recupera i task/attività", method: "GET", path: "/services/data/v62.0/query", params: [
        { name: "q", type: "string", required: true, in: "query", description: "Query SOQL (es: SELECT Id,Subject,Status,Priority,ActivityDate FROM Task LIMIT 100)" },
      ], body_template: null },
      { name: "crea_task", label: "Crea Task", description: "Crea un nuovo task", method: "POST", path: "/services/data/v62.0/sobjects/Task", params: [
        { name: "Subject", type: "string", required: true, in: "body", description: "Oggetto del task" },
        { name: "Status", type: "string", required: false, in: "body", description: "Stato (Not Started, In Progress, Completed)" },
        { name: "Priority", type: "string", required: false, in: "body", description: "Priorità (High, Normal, Low)" },
        { name: "ActivityDate", type: "string", required: false, in: "body", description: "Data (YYYY-MM-DD)" },
        { name: "Description", type: "string", required: false, in: "body", description: "Descrizione" },
      ], body_template: null },
    ],
  },
};

function requireAuth(req: any, res: any, companyId: string | undefined): companyId is string {
  const actor = req.actor as { type?: string; userId?: string } | undefined;
  if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return false; }
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return false; }
  return true;
}

function validateUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "Solo URL HTTPS consentiti";
    const blocked = ["localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254", "[::1]"];
    if (blocked.some(h => parsed.hostname === h) || parsed.hostname.startsWith("10.") || parsed.hostname.startsWith("192.168.") || parsed.hostname.startsWith("172.")) {
      return "URL non consentito (rete privata)";
    }
    return null;
  } catch { return "URL non valido"; }
}

export function customConnectorRoutes(db: Db) {
  const router = Router();

  // GET /custom-connectors?companyId=
  router.get("/custom-connectors", async (req, res) => {
    const companyId = req.query.companyId as string;
    if (!requireAuth(req, res, companyId)) return;
    const rows = await db.select().from(customConnectors)
      .where(eq(customConnectors.companyId, companyId));
    res.json(rows);
  });

  // POST /custom-connectors
  router.post("/custom-connectors", async (req, res) => {
    const { companyId, name, baseUrl, apiKey, authType, authHeader, authPrefix, description } = req.body;
    if (!requireAuth(req, res, companyId)) return;
    if (!name || !baseUrl) return res.status(400).json({ error: "name and baseUrl required" });

    const urlError = validateUrl(baseUrl);
    if (urlError) return res.status(400).json({ error: urlError });

    const existing = await db.select({ id: customConnectors.id }).from(customConnectors)
      .where(eq(customConnectors.companyId, companyId));
    if (existing.length >= 10) return res.status(400).json({ error: "Massimo 10 connettori custom per azienda" });

    const slug = slugify(name);
    try {
      const [row] = await db.insert(customConnectors).values({
        companyId, name, slug, baseUrl,
        authType: authType || "bearer",
        authHeader: authHeader || "Authorization",
        authPrefix: authPrefix || "Bearer",
        description: description || null,
        actions: [],
      }).returning();

      if (apiKey) {
        await db.insert(companySecrets).values({
          id: randomUUID(), companyId,
          name: `custom_api_${row.id}`,
          provider: "encrypted",
          description: encrypt(apiKey),
        });
      }

      await upsertConnectorAccount(db, companyId, `custom_${slug}`, row.id, name);
      res.json(row);
    } catch (err: any) {
      if (err.code === "23505") return res.status(409).json({ error: "Connettore con questo nome esiste già" });
      console.error("[custom-connectors] create error:", err);
      res.status(500).json({ error: "Errore creazione connettore" });
    }
  });

  // PUT /custom-connectors/:id
  router.put("/custom-connectors/:id", async (req, res) => {
    const { companyId, name, baseUrl, description, authType, authHeader, authPrefix, actions } = req.body;
    if (!requireAuth(req, res, companyId)) return;

    const connector = await db.select().from(customConnectors)
      .where(and(eq(customConnectors.id, req.params.id), eq(customConnectors.companyId, companyId)))
      .then(r => r[0]);
    if (!connector) return res.status(404).json({ error: "Connettore non trovato" });

    if (baseUrl) {
      const urlError = validateUrl(baseUrl);
      if (urlError) return res.status(400).json({ error: urlError });
    }

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (baseUrl !== undefined) updates.baseUrl = baseUrl;
    if (description !== undefined) updates.description = description;
    if (authType !== undefined) updates.authType = authType;
    if (authHeader !== undefined) updates.authHeader = authHeader;
    if (actions !== undefined) updates.actions = actions;
    if (authPrefix !== undefined) updates.authPrefix = authPrefix;

    const [updated] = await db.update(customConnectors).set(updates)
      .where(eq(customConnectors.id, req.params.id)).returning();
    res.json(updated);
  });

  // DELETE /custom-connectors/:id?companyId=
  router.delete("/custom-connectors/:id", async (req, res) => {
    const companyId = req.query.companyId as string;
    if (!requireAuth(req, res, companyId)) return;

    const connector = await db.select().from(customConnectors)
      .where(and(eq(customConnectors.id, req.params.id), eq(customConnectors.companyId, companyId)))
      .then(r => r[0]);
    if (!connector) return res.status(404).json({ error: "Connettore non trovato" });

    await db.delete(companySecrets).where(and(
      eq(companySecrets.companyId, companyId),
      eq(companySecrets.name, `custom_api_${connector.id}`),
    ));
    await removeConnectorAccount(db, companyId, `custom_${connector.slug}`);
    await db.delete(customConnectors).where(eq(customConnectors.id, connector.id));
    res.json({ deleted: true });
  });

  // POST /custom-connectors/:id/actions
  router.post("/custom-connectors/:id/actions", async (req, res) => {
    const { companyId, name, label, description, method, path, params, body_template } = req.body;
    if (!requireAuth(req, res, companyId)) return;
    if (!name || !method || !path) return res.status(400).json({ error: "name, method, path required" });

    const connector = await db.select().from(customConnectors)
      .where(and(eq(customConnectors.id, req.params.id), eq(customConnectors.companyId, companyId)))
      .then(r => r[0]);
    if (!connector) return res.status(404).json({ error: "Connettore non trovato" });

    const actions = (connector.actions as any[]) || [];
    if (actions.length >= 20) return res.status(400).json({ error: "Massimo 20 azioni per connettore" });

    const actionSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (actions.some((a: any) => a.name === actionSlug)) return res.status(409).json({ error: "Azione con questo nome esiste già" });

    actions.push({
      name: actionSlug, label: label || name, description: description || "",
      method: method.toUpperCase(), path,
      params: params || [], body_template: body_template || null,
    });

    const [updated] = await db.update(customConnectors)
      .set({ actions, updatedAt: new Date() })
      .where(eq(customConnectors.id, connector.id)).returning();
    res.json(updated);
  });

  // DELETE /custom-connectors/:id/actions/:actionName?companyId=
  router.delete("/custom-connectors/:id/actions/:actionName", async (req, res) => {
    const companyId = req.query.companyId as string;
    if (!requireAuth(req, res, companyId)) return;

    const connector = await db.select().from(customConnectors)
      .where(and(eq(customConnectors.id, req.params.id), eq(customConnectors.companyId, companyId)))
      .then(r => r[0]);
    if (!connector) return res.status(404).json({ error: "Connettore non trovato" });

    const actions = ((connector.actions as any[]) || []).filter((a: any) => a.name !== req.params.actionName);
    const [updated] = await db.update(customConnectors)
      .set({ actions, updatedAt: new Date() })
      .where(eq(customConnectors.id, connector.id)).returning();
    res.json(updated);
  });

  // POST /custom-connectors/:id/test
  router.post("/custom-connectors/:id/test", async (req, res) => {
    const { companyId } = req.body;
    if (!requireAuth(req, res, companyId)) return;

    const connector = await db.select().from(customConnectors)
      .where(and(eq(customConnectors.id, req.params.id), eq(customConnectors.companyId, companyId)))
      .then(r => r[0]);
    if (!connector) return res.status(404).json({ error: "Connettore non trovato" });

    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, `custom_api_${connector.id}`)))
      .then(r => r[0]);

    try {
      const headers: Record<string, string> = {};
      if (secret?.description && connector.authType !== "none") {
        const apiKey = decrypt(secret.description);
        headers[connector.authHeader || "Authorization"] = `${connector.authPrefix || "Bearer"} ${apiKey}`.trim();
      }
      const r = await fetch(connector.baseUrl, { headers, signal: AbortSignal.timeout(10000) });
      res.json({ ok: r.ok, status: r.status });
    } catch (err) {
      res.json({ ok: false, error: (err as Error).message });
    }
  });

  // GET /custom-connectors/templates — list available CRM templates
  router.get("/custom-connectors/templates", (_req, res) => {
    res.json(Object.entries(CRM_TEMPLATES).map(([key, t]) => ({
      key, name: t.name, description: t.description,
      actionsCount: t.actions.length,
      needsInstanceUrl: key === "salesforce",
    })));
  });

  // POST /custom-connectors/from-template — create connector from CRM template
  router.post("/custom-connectors/from-template", async (req, res) => {
    const { companyId, templateKey, apiKey, instanceUrl } = req.body;
    if (!requireAuth(req, res, companyId)) return;
    if (!templateKey || !apiKey) return res.status(400).json({ error: "templateKey and apiKey required" });

    const template = CRM_TEMPLATES[templateKey];
    if (!template) return res.status(400).json({ error: "Template non trovato: " + templateKey });

    // Salesforce requires instance URL
    const baseUrl = templateKey === "salesforce"
      ? (instanceUrl || "").replace(/\/$/, "")
      : template.baseUrl;
    if (!baseUrl) return res.status(400).json({ error: "instanceUrl required for Salesforce" });

    const urlError = validateUrl(baseUrl);
    if (urlError) return res.status(400).json({ error: urlError });

    // Check max + duplicates
    const existing = await db.select({ id: customConnectors.id, slug: customConnectors.slug }).from(customConnectors)
      .where(eq(customConnectors.companyId, companyId));
    if (existing.length >= 10) return res.status(400).json({ error: "Massimo 10 connettori custom" });
    if (existing.some(e => e.slug === template.slug)) return res.status(409).json({ error: `${template.name} è già collegato` });

    try {
      const [row] = await db.insert(customConnectors).values({
        companyId, name: template.name, slug: template.slug, baseUrl,
        authType: template.authType, authHeader: template.authHeader, authPrefix: template.authPrefix,
        description: template.description, actions: template.actions,
      }).returning();

      await db.insert(companySecrets).values({
        id: randomUUID(), companyId,
        name: `custom_api_${row.id}`,
        provider: "encrypted",
        description: encrypt(apiKey),
      });

      await upsertConnectorAccount(db, companyId, `custom_${template.slug}`, row.id, template.name);
      res.json(row);
    } catch (err: any) {
      if (err.code === "23505") return res.status(409).json({ error: "Connettore già esistente" });
      console.error("[custom-connectors] template create error:", err);
      res.status(500).json({ error: "Errore creazione connettore" });
    }
  });

  return router;
}

import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets } from "@goitalia/db";
import { eq, and, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { encrypt, decrypt } from "../utils/crypto.js";
import { upsertConnectorAccount, removeAllConnectorAccountsByType } from "../utils/connector-sync.js";

const META_APP_ID = process.env.META_APP_ID || "";
const META_APP_SECRET = process.env.META_APP_SECRET || "";
const REDIRECT_URI = (process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL || "https://impresa.goitalia.eu") + "/api/oauth/meta/callback";

const SCOPES = [
  "email",
  "pages_show_list",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "business_management",
].join(",");


const oauthStates = new Map<string, { companyId: string; userId: string; prefix: string; expiresAt: number }>();
setInterval(() => { const now = Date.now(); for (const [k, v] of oauthStates) { if (v.expiresAt < now) oauthStates.delete(k); } }, 300000);

export function metaRoutes(db: Db) {
  const router = Router();

  // GET /oauth/meta/connect?companyId=xxx&prefix=xxx
  router.get("/oauth/meta/connect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const prefix = (req.query.prefix as string) || "";
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }

    const state = crypto.randomBytes(32).toString("hex");
    oauthStates.set(state, { companyId, userId: actor.userId, prefix, expiresAt: Date.now() + 600000 });

    const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${SCOPES}&state=${state}&response_type=code`;
    res.redirect(authUrl);
  });

  // GET /oauth/meta/callback
  router.get("/oauth/meta/callback", async (req, res) => {
    const { code, state, error: oauthError } = req.query as Record<string, string>;
    if (oauthError) { res.redirect("/?error=meta_oauth_denied"); return; }
    if (!code || !state) { res.redirect("/?error=meta_oauth_invalid"); return; }

    const stateData = oauthStates.get(state);
    oauthStates.delete(state);
    if (!stateData || stateData.expiresAt < Date.now()) { res.redirect("/?error=meta_oauth_expired"); return; }

    try {
      // Exchange code for short-lived token
      const tokenRes = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${META_APP_SECRET}&code=${code}`);
      if (!tokenRes.ok) { console.error("[Meta OAuth] Token exchange failed:", await tokenRes.text()); res.redirect("/?error=meta_token_failed"); return; }
      const tokens = await tokenRes.json() as { access_token: string; token_type: string; expires_in: number };

      // Exchange for long-lived token (60 days)
      const longRes = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${tokens.access_token}`);
      const longToken = longRes.ok ? await longRes.json() as { access_token: string; expires_in: number } : tokens;

      // Check granted permissions
      const permsRes = await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${longToken.access_token}`);
      const permsData = await permsRes.json();
      console.log("[Meta OAuth] Granted permissions:", JSON.stringify(permsData));

      // Get user info
      const meRes = await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${longToken.access_token}`);
      const me = await meRes.json() as { id?: string; name?: string };
      console.log("[Meta OAuth] User:", me.name, me.id);

      // Get pages
      const pagesRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token&access_token=${longToken.access_token}`);
      const pagesData = await pagesRes.json() as { data?: Array<{ id: string; name: string; access_token: string }>; error?: any };
      console.warn("[Meta OAuth] Pages me/accounts:", JSON.stringify(pagesData));
      let pages = pagesData.data || [];

      // Fallback: try Business Manager owned pages if me/accounts is empty
      if (pages.length === 0) {
        console.warn("[Meta OAuth] No pages from me/accounts, trying Business Manager fallback...");
        try {
          const bizRes = await fetch(`https://graph.facebook.com/v21.0/me/businesses?access_token=${longToken.access_token}`);
          const bizData = await bizRes.json() as { data?: Array<{ id: string; name: string }> };
          console.warn("[Meta OAuth] Businesses:", JSON.stringify(bizData));
          for (const biz of (bizData.data || [])) {
            const bpRes = await fetch(`https://graph.facebook.com/v21.0/${biz.id}/owned_pages?fields=id,name,access_token&access_token=${longToken.access_token}`);
            const bpData = await bpRes.json() as { data?: Array<{ id: string; name: string; access_token: string }> };
            console.warn(`[Meta OAuth] Business "${biz.name}" owned pages:`, JSON.stringify(bpData));
            if (bpData.data?.length) {
              pages = [...pages, ...bpData.data];
            }
            // Also try client_pages
            const cpRes = await fetch(`https://graph.facebook.com/v21.0/${biz.id}/client_pages?fields=id,name,access_token&access_token=${longToken.access_token}`);
            const cpData = await cpRes.json() as { data?: Array<{ id: string; name: string; access_token: string }> };
            if (cpData.data?.length) {
              console.warn(`[Meta OAuth] Business "${biz.name}" client pages:`, JSON.stringify(cpData));
              pages = [...pages, ...cpData.data];
            }
          }
        } catch (bizErr) { console.warn("[Meta OAuth] Business fallback error:", bizErr); }
      }

      if (pages.length === 0) {
        console.warn("[Meta OAuth] WARNING: No pages found after all fallbacks.");
      }

      // Get Instagram accounts linked to pages
      const igAccounts: Array<{ id: string; username: string; pageId: string; pageName: string }> = [];
      for (const page of pages) {
        const pageToken = page.access_token || longToken.access_token;
        const igRes = await fetch(`https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account{id,username}&access_token=${pageToken}`);
        const igData = await igRes.json() as { instagram_business_account?: { id: string; username: string } };
        console.warn(`[Meta OAuth] Page "${page.name}" (${page.id}) IG:`, igData.instagram_business_account ? igData.instagram_business_account.username : "none");
        if (igData.instagram_business_account) {
          igAccounts.push({
            id: igData.instagram_business_account.id,
            username: igData.instagram_business_account.username || "",
            pageId: page.id,
            pageName: page.name,
          });
        }
      }

      // Fallback: try direct Instagram accounts via user's businesses
      if (igAccounts.length === 0) {
        console.warn("[Meta OAuth] No IG from pages, trying user IG accounts endpoint...");
        try {
          const igUserRes = await fetch(`https://graph.facebook.com/v21.0/${me.id}/instagram_accounts?fields=id,username&access_token=${longToken.access_token}`);
          const igUserData = await igUserRes.json() as { data?: Array<{ id: string; username: string }>; error?: any };
          console.warn("[Meta OAuth] User IG accounts:", JSON.stringify(igUserData));
          for (const ig of (igUserData.data || [])) {
            if (ig.username && !igAccounts.find(a => a.id === ig.id)) {
              igAccounts.push({ id: ig.id, username: ig.username, pageId: "", pageName: "" });
            }
          }
        } catch { /* ignore */ }
      }

      console.warn(`[Meta OAuth] Final: ${pages.length} pages, ${igAccounts.length} IG accounts`);

      // Save everything
      const metaData = {
        accessToken: longToken.access_token,
        expiresAt: Date.now() + (longToken.expires_in || 5184000) * 1000,
        userId: me.id,
        userName: me.name,
        pages: pages.map((p) => ({ id: p.id, name: p.name, accessToken: p.access_token })),
        instagram: igAccounts,
      };

      const encrypted = encrypt(JSON.stringify(metaData));
      const existing = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, stateData.companyId), eq(companySecrets.name, "meta_tokens")))
        .then((rows) => rows[0]);

      if (existing) {
        await db.update(companySecrets).set({ description: encrypted, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
      } else {
        await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId: stateData.companyId, name: "meta_tokens", provider: "encrypted", description: encrypted });
      }

      // Sync connector_accounts
      for (const ig of igAccounts) {
        await upsertConnectorAccount(db, stateData.companyId, "meta_ig", ig.username, ig.username);
      }
      for (const page of pages) {
        await upsertConnectorAccount(db, stateData.companyId, "meta_fb", page.id, page.name);
      }

      const prefix = stateData.prefix || "";
      res.redirect("/" + prefix + "/plugins?meta_connected=true");
    } catch (err) {
      console.error("Meta OAuth error:", err);
      res.redirect("/?error=meta_oauth_error");
    }
  });

  // GET /oauth/meta/status?companyId=xxx
  router.get("/oauth/meta/status", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ connected: false }); return; }

    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "meta_tokens")))
      .then((rows) => rows[0]);
    if (!secret?.description) { res.json({ connected: false }); return; }

    try {
      const data = JSON.parse(decrypt(secret.description));
      res.json({
        connected: true,
        userName: data.userName,
        pages: (data.pages || []).map((p: any) => ({ id: p.id, name: p.name })),
        instagram: (data.instagram || []).map((ig: any) => ({ id: ig.id, username: ig.username, pageName: ig.pageName })),
      });
    } catch { res.json({ connected: false }); }
  });

  // POST /oauth/meta/disconnect?companyId=xxx
  router.post("/oauth/meta/disconnect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string || req.body?.companyId;
    if (!companyId) { res.json({ disconnected: true }); return; }
    await db.delete(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "meta_tokens")));
    await removeAllConnectorAccountsByType(db, companyId, "meta_ig");
    await removeAllConnectorAccountsByType(db, companyId, "meta_fb");
    res.json({ disconnected: true });
  });

  return router;
}

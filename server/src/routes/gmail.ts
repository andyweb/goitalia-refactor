import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets, agents, companyContacts } from "@goitalia/db";
import { eq, and, sql, ilike, or } from "drizzle-orm";
import crypto from "node:crypto";
import { encrypt, decrypt } from "../utils/crypto.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";


async function getGmailToken(db: Db, companyId: string, accountIndex = 0): Promise<{ access_token: string; email: string } | null> {
  const secret = await db.select().from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "google_oauth_tokens")))
    .then((rows) => rows[0]);
  if (!secret?.description) return null;

  const decrypted = JSON.parse(decrypt(secret.description));
  const accounts = Array.isArray(decrypted) ? decrypted : [decrypted];
  const tokenData = accounts[accountIndex] || accounts[0];
  if (!tokenData) return null;
  
  // Refresh if expired
  if (tokenData.expires_at && tokenData.expires_at < Date.now() && tokenData.refresh_token) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: tokenData.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (res.ok) {
      const newTokens = await res.json() as { access_token: string; expires_in: number };
      tokenData.access_token = newTokens.access_token;
      tokenData.expires_at = Date.now() + newTokens.expires_in * 1000;
      // Save updated tokens — preserve full array
      accounts[accountIndex] = tokenData;
      const encrypted = encrypt(JSON.stringify(accounts));
      await db.update(companySecrets)
        .set({ description: encrypted, updatedAt: new Date() })
        .where(eq(companySecrets.id, secret.id));
    }
  }

  return { access_token: tokenData.access_token, email: tokenData.email || "" };
}

interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  body: string;
  date: string;
  isUnread: boolean;
  isStarred: boolean;
}

function decodeBase64Url(str: string): string {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

function extractHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function extractBody(payload: any): string {
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  if (payload.parts) {
    // Prefer text/plain, fallback to text/html
    const textPart = payload.parts.find((p: any) => p.mimeType === "text/plain");
    if (textPart?.body?.data) return decodeBase64Url(textPart.body.data);
    const htmlPart = payload.parts.find((p: any) => p.mimeType === "text/html");
    if (htmlPart?.body?.data) {
      const html = decodeBase64Url(htmlPart.body.data);
      return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    }
    // Nested parts
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
  }
  return "";
}

export function gmailRoutes(db: Db) {
  const router = Router();

  // GET /gmail/messages?companyId=xxx&maxResults=20 - List emails
  router.get("/gmail/messages", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }

    const companyId = req.query.companyId as string;
    const maxResults = parseInt(req.query.maxResults as string) || 20;
    const pageToken = req.query.pageToken as string || "";
    const label = req.query.label as string || "INBOX";
    const accountIdx = parseInt(req.query.account as string) || 0;
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }

    const token = await getGmailToken(db, companyId, accountIdx);
    if (!token) { res.status(400).json({ error: "Google non connesso. Vai su Plugin per collegare il tuo account." }); return; }

    try {
      // Get message list
      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}${label === "STARRED" ? "&q=is:starred" : label === "ARCHIVE" ? "&q=-in:inbox+-in:trash+-in:spam+in:anywhere" : "&labelIds=" + label}${pageToken ? "&pageToken=" + pageToken : ""}`,
        { headers: { Authorization: "Bearer " + token.access_token } }
      );
      if (!listRes.ok) {
        const err = await listRes.text();
        console.error("Gmail list error:", listRes.status, err);
        res.status(502).json({ error: "Errore lettura email" });
        return;
      }
      const listData = await listRes.json() as { messages?: Array<{ id: string; threadId: string }>; nextPageToken?: string };
      if (!listData.messages?.length) { res.json({ messages: [], email: token.email, nextPageToken: null }); return; }

      // Get message details (batch, max 10 for speed)
      const messageIds = listData.messages;
      const messages: GmailMessage[] = [];

      for (const msg of messageIds) {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: "Bearer " + token.access_token } }
        );
        if (!msgRes.ok) continue;
        const msgData = await msgRes.json() as any;
        const headers = msgData.payload?.headers || [];

        messages.push({
          id: msgData.id,
          threadId: msgData.threadId,
          from: extractHeader(headers, "From"),
          to: extractHeader(headers, "To"),
          subject: extractHeader(headers, "Subject"),
          snippet: msgData.snippet || "",
          body: extractBody(msgData.payload).slice(0, 2000),
          date: extractHeader(headers, "Date"),
          isUnread: (msgData.labelIds || []).includes("UNREAD"),
          isStarred: (msgData.labelIds || []).includes("STARRED"),
        });
      }

      res.json({ messages, email: token.email, nextPageToken: listData.nextPageToken || null });
    } catch (err) {
      console.error("Gmail error:", err);
      res.status(500).json({ error: "Errore nel recupero email" });
    }
  });

  // GET /gmail/message/:id?companyId=xxx - Get single email
  router.get("/gmail/message/:id", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }

    const companyId = req.query.companyId as string;
    const messageId = req.params.id;
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }

    const token = await getGmailToken(db, companyId);
    if (!token) { res.status(400).json({ error: "Google non connesso" }); return; }

    try {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
        { headers: { Authorization: "Bearer " + token.access_token } }
      );
      if (!msgRes.ok) { res.status(502).json({ error: "Errore lettura email" }); return; }
      const msgData = await msgRes.json() as any;
      const headers = msgData.payload?.headers || [];

      res.json({
        id: msgData.id,
        threadId: msgData.threadId,
        from: extractHeader(headers, "From"),
        to: extractHeader(headers, "To"),
        subject: extractHeader(headers, "Subject"),
        snippet: msgData.snippet || "",
        body: extractBody(msgData.payload),
        date: extractHeader(headers, "Date"),
        isUnread: (msgData.labelIds || []).includes("UNREAD"),
      });
    } catch (err) {
      console.error("Gmail message error:", err);
      res.status(500).json({ error: "Errore lettura email" });
    }
  });

  // POST /gmail/generate-reply - Generate AI reply
  router.post("/gmail/generate-reply", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }

    const { companyId, messageId, agentId } = req.body as { companyId: string; messageId: string; agentId?: string };
    if (!companyId || !messageId) { res.status(400).json({ error: "companyId e messageId richiesti" }); return; }

    // Get email content
    const token = await getGmailToken(db, companyId);
    if (!token) { res.status(400).json({ error: "Google non connesso" }); return; }

    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: "Bearer " + token.access_token } }
    );
    if (!msgRes.ok) { res.status(502).json({ error: "Errore lettura email" }); return; }
    const msgData = await msgRes.json() as any;
    const headers = msgData.payload?.headers || [];
    const from = extractHeader(headers, "From");
    const subject = extractHeader(headers, "Subject");
    const body = extractBody(msgData.payload).slice(0, 3000);

    // Get Claude API key
    const apiKeySecret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "claude_api_key")))
      .then((rows) => rows[0]);
    if (!apiKeySecret?.description) { res.status(400).json({ error: "API key Claude non configurata" }); return; }

    let claudeApiKey: string;
    try { claudeApiKey = decrypt(apiKeySecret.description); } catch { res.status(500).json({ error: "Errore decrypt API key" }); return; }

    // Get agent instructions if provided
    let agentPrompt = "";
    if (agentId) {
      const agent = await db.select().from(agents).where(eq(agents.id, agentId)).then((rows) => rows[0]);
      if (agent) {
        const config = (agent.adapterConfig as Record<string, unknown>) || {};
        agentPrompt = (config.promptTemplate as string) || "";
      }
    }

    const systemPrompt = agentPrompt || `Sei un assistente email professionale. Scrivi risposte in italiano, professionali e concise. Non inventare informazioni che non hai.`;

    const userMessage = `Genera una risposta professionale a questa email.

DA: ${from}
OGGETTO: ${subject}

CONTENUTO:
${body}

Scrivi SOLO il testo della risposta, senza oggetto, senza "Gentile..." se non necessario. La risposta deve essere naturale e professionale.`;

    try {
      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": claudeApiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
        }),
      });

      if (!claudeRes.ok) {
        const errText = await claudeRes.text();
        console.error("Claude error:", claudeRes.status, errText);
        res.status(502).json({ error: "Errore generazione risposta AI" });
        return;
      }

      const data = await claudeRes.json() as { content?: Array<{ type: string; text?: string }> };
      const replyText = data.content?.filter((c) => c.type === "text").map((c) => c.text).join("\n") || "";

      res.json({ reply: replyText, originalSubject: subject, originalFrom: from });
    } catch (err) {
      console.error("Generate reply error:", err);
      res.status(500).json({ error: "Errore generazione risposta" });
    }
  });

  // POST /gmail/send - Send email (after approval)
  router.post("/gmail/send", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }

    const { companyId, to, subject, body, threadId, inReplyTo } = req.body as {
      companyId: string; to: string; subject: string; body: string; threadId?: string; inReplyTo?: string;
    };
    if (!companyId || !to || !subject || !body) {
      res.status(400).json({ error: "companyId, to, subject e body richiesti" });
      return;
    }

    const token = await getGmailToken(db, companyId);
    if (!token) { res.status(400).json({ error: "Google non connesso" }); return; }

    // Build RFC 2822 email
    const headers = [
      `To: ${to}`,
      `Subject: ${subject.startsWith("Re:") ? subject : "Re: " + subject}`,
      `Content-Type: text/plain; charset=utf-8`,
    ];
    if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
    if (threadId) headers.push(`References: ${inReplyTo || ""}`);

    const raw = Buffer.from(headers.join("\r\n") + "\r\n\r\n" + body).toString("base64url");

    try {
      const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token.access_token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw, threadId }),
      });

      if (!sendRes.ok) {
        const err = await sendRes.text();
        console.error("Gmail send error:", sendRes.status, err);
        res.status(502).json({ error: "Errore invio email" });
        return;
      }

      const sent = await sendRes.json() as { id: string };
      res.json({ sent: true, messageId: sent.id });
    } catch (err) {
      console.error("Send email error:", err);
      res.status(500).json({ error: "Errore invio email" });
    }
  });

  // POST /gmail/trash - Move to trash
  router.post("/gmail/trash", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, messageId, accountIndex } = req.body;
    const token = await getGmailToken(db, companyId, accountIndex || 0);
    if (!token) { res.status(400).json({ error: "Google non connesso" }); return; }
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/trash`, {
      method: "POST", headers: { Authorization: "Bearer " + token.access_token },
    });
    if (!r.ok) { res.status(502).json({ error: "Errore eliminazione" }); return; }
    res.json({ success: true });
  });

  // POST /gmail/archive - Remove from inbox (archive)
  router.post("/gmail/archive", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, messageId, accountIndex } = req.body;
    const token = await getGmailToken(db, companyId, accountIndex || 0);
    if (!token) { res.status(400).json({ error: "Google non connesso" }); return; }
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
      method: "POST", headers: { Authorization: "Bearer " + token.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
    });
    if (!r.ok) { res.status(502).json({ error: "Errore archiviazione" }); return; }
    res.json({ success: true });
  });

  // POST /gmail/star - Toggle star
  router.post("/gmail/star", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, messageId, starred, accountIndex } = req.body;
    const token = await getGmailToken(db, companyId, accountIndex || 0);
    if (!token) { res.status(400).json({ error: "Google non connesso" }); return; }
    const body = starred
      ? { addLabelIds: ["STARRED"] }
      : { removeLabelIds: ["STARRED"] };
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
      method: "POST", headers: { Authorization: "Bearer " + token.access_token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) { res.status(502).json({ error: "Errore preferiti" }); return; }
    res.json({ success: true });
  });

  // POST /gmail/mark-read - Mark as read/unread
  router.post("/gmail/mark-read", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, messageId, read, accountIndex } = req.body;
    const token = await getGmailToken(db, companyId, accountIndex || 0);
    if (!token) { res.status(400).json({ error: "Google non connesso" }); return; }
    const body = read
      ? { removeLabelIds: ["UNREAD"] }
      : { addLabelIds: ["UNREAD"] };
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
      method: "POST", headers: { Authorization: "Bearer " + token.access_token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) { res.status(502).json({ error: "Errore" }); return; }
    res.json({ success: true });
  });

  // GET /gmail/unread-count?companyId=xxx - counts ALL accounts
  router.get("/gmail/unread-count", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ count: 0 }); return; }
    
    // Get all accounts and sum unread counts
    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "google_tokens")))
      .then((r) => r[0]);
    if (!secret?.description) { res.json({ count: 0 }); return; }
    
    try {
      const decrypted = JSON.parse(decrypt(secret.description));
      const accounts = Array.isArray(decrypted) ? decrypted : [decrypted];
      let totalUnread = 0;
      
      for (const account of accounts) {
        try {
          const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX", {
            headers: { Authorization: "Bearer " + account.access_token },
          });
          if (r.ok) {
            const data = await r.json() as { messagesUnread?: number };
            totalUnread += data.messagesUnread || 0;
          }
        } catch {}
      }
      
      res.json({ count: totalUnread });
    } catch {
      res.json({ count: 0 });
    }
  });

  // GET /gmail/accounts?companyId=xxx - List connected accounts
  router.get("/gmail/accounts", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ accounts: [] }); return; }
    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "google_oauth_tokens")))
      .then((rows) => rows[0]);
    if (!secret?.description) { res.json({ accounts: [] }); return; }
    try {
      const decrypted = JSON.parse(decrypt(secret.description));
      const accounts = Array.isArray(decrypted) ? decrypted : [decrypted];
      res.json({ accounts: accounts.map((a: any, i: number) => ({ index: i, email: a.email || "Account " + (i + 1) })) });
    } catch { res.json({ accounts: [] }); }
  });

  // GET /gmail/contacts/search?companyId=xxx&q=andrea - Search contacts via sent emails
  router.get("/gmail/contacts/search", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const query = (req.query.q as string || "").trim();
    if (!companyId || !query || query.length < 2) { res.json({ contacts: [] }); return; }

    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "google_oauth_tokens")))
      .then((rows) => rows[0]);
    if (!secret?.description) { res.json({ contacts: [] }); return; }

    try {
      const decrypted = JSON.parse(decrypt(secret.description));
      const accounts = Array.isArray(decrypted) ? decrypted : [decrypted];
      const seen = new Set<string>();
      const contacts: Array<{ name: string; email: string; phone: string | null; source: string | null }> = [];

      // First: search local stored contacts (fast)
      try {
        const pattern = "%" + query + "%";
        const localContacts = await db.select().from(companyContacts)
          .where(and(
            eq(companyContacts.companyId, companyId),
            or(
              ilike(companyContacts.name, pattern),
              ilike(companyContacts.email, pattern),
              ilike(companyContacts.phone, pattern),
            ),
          ))
          .limit(20);
        for (const c of localContacts) {
          const key = c.email || c.phone || "";
          if (key && !seen.has(key)) {
            seen.add(key);
            contacts.push({ name: c.name || "", email: c.email || "", phone: c.phone || null, source: c.source || null });
          }
        }
      } catch {}

      // If enough results from local, skip Gmail live search
      if (contacts.length >= 10) {
        res.json({ contacts: contacts.slice(0, 15) });
        return;
      }

      // Parse "Name <email>" or just "email"
      function parseEmailHeader(header: string) {
        const results: Array<{ name: string; email: string }> = [];
        // Split by comma for multiple recipients
        for (const part of header.split(",")) {
          const match = part.trim().match(/^(?:"?([^"<]*)"?\s*)?<?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>?$/);
          if (match) {
            results.push({ name: (match[1] || "").trim(), email: match[2].toLowerCase() });
          }
        }
        return results;
      }

      for (const account of accounts) {
        if (!account.access_token) continue;
        try {
          // Search sent emails + inbox for matching addresses
          const gmailQuery = `(to:${query} OR from:${query}) -from:me`;
          const listRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=${encodeURIComponent(gmailQuery)}`,
            { headers: { Authorization: "Bearer " + account.access_token } }
          );
          if (!listRes.ok) continue;
          const listData = await listRes.json() as { messages?: Array<{ id: string }> };

          // Also search sent messages
          const sentQuery = `in:sent to:${query}`;
          const sentRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=${encodeURIComponent(sentQuery)}`,
            { headers: { Authorization: "Bearer " + account.access_token } }
          );
          const sentData = sentRes.ok ? await sentRes.json() as { messages?: Array<{ id: string }> } : { messages: [] };

          // Merge and dedupe message IDs
          const msgIds = new Set<string>();
          for (const m of [...(listData.messages || []), ...(sentData.messages || [])]) {
            msgIds.add(m.id);
          }

          // Fetch headers for each message (max 10)
          let count = 0;
          for (const msgId of msgIds) {
            if (count >= 10 || contacts.length >= 15) break;
            count++;
            const msgRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=metadata&metadataHeaders=From&metadataHeaders=To`,
              { headers: { Authorization: "Bearer " + account.access_token } }
            );
            if (!msgRes.ok) continue;
            const msgData = await msgRes.json() as { payload?: { headers?: Array<{ name: string; value: string }> } };
            const headers = msgData.payload?.headers || [];
            for (const h of headers) {
              if (h.name === "From" || h.name === "To") {
                for (const parsed of parseEmailHeader(h.value)) {
                  if (parsed.email && !seen.has(parsed.email) && parsed.email.includes(query.toLowerCase())) {
                    seen.add(parsed.email);
                    contacts.push({ ...parsed, phone: null, source: "google" });
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error("[gmail/contacts] search error:", err);
        }
      }

      res.json({ contacts: contacts.slice(0, 15) });
    } catch (err) {
      console.error("[gmail/contacts] error:", err);
      res.json({ contacts: [] });
    }
  });

  // POST /gmail/contacts/sync — Sync contacts from Google People API to DB
  router.post("/gmail/contacts/sync", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string || req.body?.companyId;
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }

    try {
      // Get all Google accounts for this company
      const rows = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "google_oauth_tokens")));
      if (!rows.length) { res.status(400).json({ error: "Google non collegato" }); return; }

      let totalImported = 0;

      for (const row of rows) {
        let parsed: any;
        try { parsed = JSON.parse(decrypt(row.description || "")); } catch { continue; }
        // Tokens are stored as array of accounts
        const accounts = Array.isArray(parsed) ? parsed : (parsed?.access_token ? [parsed] : []);
        console.log("[contacts-sync] found", accounts.length, "Google accounts");

        for (let tokens of accounts) {
          if (!tokens?.access_token) { console.log("[contacts-sync] skipping account, no access_token"); continue; }

          // Refresh token if needed
          if (tokens.expires_at && Date.now() > tokens.expires_at - 60000 && tokens.refresh_token) {
            try {
              const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  client_id: GOOGLE_CLIENT_ID,
                  client_secret: GOOGLE_CLIENT_SECRET,
                  refresh_token: tokens.refresh_token,
                  grant_type: "refresh_token",
                }),
              });
              if (refreshRes.ok) {
                const newTokens = await refreshRes.json() as any;
                tokens.access_token = newTokens.access_token;
                tokens.expires_at = Date.now() + (newTokens.expires_in || 3600) * 1000;
                // Save refreshed tokens back
                const idx = accounts.indexOf(tokens);
                if (idx >= 0) accounts[idx] = tokens;
                await db.update(companySecrets).set({ description: encrypt(JSON.stringify(accounts)), updatedAt: new Date() }).where(eq(companySecrets.id, row.id));
              } else {
                console.error("[contacts-sync] token refresh failed:", refreshRes.status);
              }
            } catch (err) { console.error("[contacts-sync] refresh error:", err); }
          }

        // Fetch contacts from People API (paginated)
        let nextPageToken: string | undefined;
        let pageCount = 0;
        do {
          const url = new URL("https://people.googleapis.com/v1/people/me/connections");
          url.searchParams.set("pageSize", "1000");
          url.searchParams.set("personFields", "names,emailAddresses,phoneNumbers,organizations,photos");
          url.searchParams.set("sortOrder", "LAST_MODIFIED_DESCENDING");
          if (nextPageToken) url.searchParams.set("pageToken", nextPageToken);

          const r = await fetch(url.toString(), {
            headers: { Authorization: "Bearer " + tokens.access_token },
          });
          if (!r.ok) {
            console.error("[contacts-sync] People API error:", r.status, await r.text());
            break;
          }
          const data = await r.json() as any;
          const connections = data.connections || [];

          for (const person of connections) {
            const resourceName = person.resourceName || "";
            const name = person.names?.[0]?.displayName || "";
            const email = person.emailAddresses?.[0]?.value || "";
            const phone = person.phoneNumbers?.[0]?.canonicalForm || person.phoneNumbers?.[0]?.value || "";
            const org = person.organizations?.[0]?.name || "";
            const jobTitle = person.organizations?.[0]?.title || "";
            const photoUrl = person.photos?.[0]?.url || "";

            if (!name && !email && !phone) continue;

            const contactId = crypto.randomUUID();
            try {
              await db.execute(sql`
                INSERT INTO company_contacts (id, company_id, source, source_id, name, email, phone, company, job_title, photo_url, updated_at)
                VALUES (${contactId}, ${companyId}, 'google', ${resourceName}, ${name || null}, ${email || null}, ${phone || null}, ${org || null}, ${jobTitle || null}, ${photoUrl || null}, NOW())
                ON CONFLICT (company_id, source, source_id) DO UPDATE SET
                  name = EXCLUDED.name,
                  email = EXCLUDED.email,
                  phone = EXCLUDED.phone,
                  company = EXCLUDED.company,
                  job_title = EXCLUDED.job_title,
                  photo_url = EXCLUDED.photo_url,
                  updated_at = NOW()
              `);
              totalImported++;
            } catch (err) {
              console.error("[contacts-sync] insert error:", err);
            }
          }

          nextPageToken = data.nextPageToken;
          pageCount++;
        } while (nextPageToken && pageCount < 10); // max 10 pages = 10k contacts

        // Also fetch "other contacts" (people you've interacted with but don't have in your contacts)
        try {
          let otherNextPage: string | undefined;
          let otherPages = 0;
          do {
            const otherUrl = new URL("https://people.googleapis.com/v1/otherContacts");
            otherUrl.searchParams.set("pageSize", "1000");
            otherUrl.searchParams.set("readMask", "names,emailAddresses,phoneNumbers");
            if (otherNextPage) otherUrl.searchParams.set("pageToken", otherNextPage);

            const otherRes = await fetch(otherUrl.toString(), {
              headers: { Authorization: "Bearer " + tokens.access_token },
            });
            if (!otherRes.ok) break;
            const otherData = await otherRes.json() as any;
            for (const person of (otherData.otherContacts || [])) {
              const resourceName = person.resourceName || "";
              const name = person.names?.[0]?.displayName || "";
              const email = person.emailAddresses?.[0]?.value || "";
              const phone = person.phoneNumbers?.[0]?.canonicalForm || person.phoneNumbers?.[0]?.value || "";
              if (!name && !email && !phone) continue;

              const contactId = crypto.randomUUID();
              try {
                await db.execute(sql`
                  INSERT INTO company_contacts (id, company_id, source, source_id, name, email, phone, updated_at)
                  VALUES (${contactId}, ${companyId}, 'google', ${resourceName}, ${name || null}, ${email || null}, ${phone || null}, NOW())
                  ON CONFLICT (company_id, source, source_id) DO UPDATE SET
                    name = COALESCE(EXCLUDED.name, company_contacts.name),
                    email = COALESCE(EXCLUDED.email, company_contacts.email),
                    phone = COALESCE(EXCLUDED.phone, company_contacts.phone),
                    updated_at = NOW()
                `);
                totalImported++;
              } catch {}
            }
            otherNextPage = otherData.nextPageToken;
            otherPages++;
          } while (otherNextPage && otherPages < 5);
        } catch (err) {
          console.error("[contacts-sync] otherContacts error:", err);
        }
        } // end for (let tokens of accounts)
      } // end for (const row of rows)

      res.json({ imported: totalImported });
    } catch (err) {
      console.error("[contacts-sync] error:", err);
      res.status(500).json({ error: "Errore sync contatti" });
    }
  });

  // GET /gmail/contacts/list — Search stored contacts
  router.get("/gmail/contacts/list", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const q = (req.query.q as string || "").trim();
    if (!companyId) { res.json({ contacts: [] }); return; }

    try {
      const hasPhone = req.query.hasPhone === "1";
      const source = req.query.source as string | undefined;
      
      // Debug: count total contacts for this company
      const countResult = await db.execute(sql`SELECT count(*) as cnt, source FROM company_contacts WHERE company_id = ${companyId} GROUP BY source`) as any;
      console.log("[contacts-list] companyId:", companyId, "counts:", JSON.stringify(countResult.rows || countResult));

      let rows;
      const conditions: any[] = [eq(companyContacts.companyId, companyId)];
      if (hasPhone) conditions.push(sql`${companyContacts.phone} IS NOT NULL`);
      if (source) conditions.push(eq(companyContacts.source, source));

      if (q) {
        const pattern = "%" + q + "%";
        conditions.push(or(
          ilike(companyContacts.name, pattern),
          ilike(companyContacts.email, pattern),
          ilike(companyContacts.phone, pattern),
          ilike(companyContacts.company, pattern),
        ));
      }

      rows = await db.select().from(companyContacts).where(and(...conditions));
      console.log("[contacts-list] returned", rows.length, "contacts (hasPhone:", hasPhone, ")");
      res.json({ contacts: rows });
    } catch (err) {
      console.error("[contacts-list] error:", err);
      res.json({ contacts: [] });
    }
  });

  // POST /gmail/contacts/add — Add a contact manually
  router.post("/gmail/contacts/add", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, source, phone, name, email, company: org } = req.body || {};
    if (!companyId || !source || !phone) { res.status(400).json({ error: "companyId, source, phone richiesti" }); return; }

    try {
      const normalizedPhone = phone.replace(/[\s\-()]/g, "");
      const sourceId = source + "_" + normalizedPhone;
      const id = crypto.randomUUID();

      await db.execute(sql`
        INSERT INTO company_contacts (id, company_id, source, source_id, name, phone, email, company, updated_at)
        VALUES (${id}, ${companyId}, ${source}, ${sourceId}, ${name || null}, ${normalizedPhone}, ${email || null}, ${org || null}, NOW())
        ON CONFLICT (company_id, source, source_id) DO UPDATE SET
          name = COALESCE(NULLIF(EXCLUDED.name, ''), company_contacts.name),
          phone = EXCLUDED.phone,
          updated_at = NOW()
      `);
      res.json({ success: true, id });
    } catch (err) {
      console.error("[contacts-add] error:", err);
      res.status(500).json({ error: "Errore aggiunta contatto" });
    }
  });

  // DELETE /gmail/contacts/:id — Delete a contact
  router.delete("/gmail/contacts/:id", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }

    try {
      await db.execute(sql`DELETE FROM company_contacts WHERE id = ${req.params.id}`);
      res.json({ deleted: true });
    } catch (err) {
      console.error("[contacts-delete] error:", err);
      res.status(500).json({ error: "Errore eliminazione contatto" });
    }
  });

  return router;
}

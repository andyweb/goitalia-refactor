import { Router } from "express";
import multer from "multer";
import type { Db } from "@goitalia/db";
import { companySecrets, agents, connectorAccounts, agentConnectorAccounts } from "@goitalia/db";
import { eq, and, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { encrypt, decrypt } from "../utils/crypto.js";
import { upsertConnectorAccount, removeConnectorAccount } from "../utils/connector-sync.js";
import { getContactContext, normalizePhoneNumber } from "./whatsapp-contacts.js";
import { whatsappContacts } from "@goitalia/db";

const WASENDER_API = "https://www.wasenderapi.com/api";
function getWasenderPat() { return process.env.WASENDER_PAT || ""; }

export function whatsappRoutes(db: Db) {
  const router = Router();

  // POST /whatsapp/connect — Create or reconnect session + get QR
  router.post("/whatsapp/connect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, phoneNumber, name } = req.body as { companyId: string; phoneNumber: string; name?: string };
    if (!companyId || !phoneNumber) { res.status(400).json({ error: "companyId e phoneNumber richiesti" }); return; }

    try {
      const webhookUrl = (process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL || "https://impresa.goitalia.eu") + "/wa-hook/" + companyId;

      // Check if session already exists in DB
      const existingSecret = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
        .then((rows) => rows[0]);

      let sessions: any[] = [];
      if (existingSecret?.description) {
        try { const dec = JSON.parse(decrypt(existingSecret.description)); sessions = Array.isArray(dec) ? dec : [dec]; } catch {}
      }

      // Find existing session for this phone number
      const existingSession = sessions.find((s: any) => s.phoneNumber === phoneNumber);

      if (existingSession?.sessionId) {
        // Session exists — try to reconnect it
        console.log("[wa] Reconnecting existing session, PAT length:", getWasenderPat().length, "sessionId:", existingSession.sessionId);
        const connectRes = await fetch(WASENDER_API + "/whatsapp-sessions/" + existingSession.sessionId + "/connect", {
          method: "POST",
          headers: { Authorization: "Bearer " + getWasenderPat() },
        });
        if (connectRes.ok) {
          const connectData = await connectRes.json() as { data?: { status: string; qrCode?: string } };
          if (connectData.data?.status === "connected") {
            res.json({ connected: true, sessionId: existingSession.sessionId });
          } else {
            res.json({
              connected: false,
              sessionId: existingSession.sessionId,
              qrCode: connectData.data?.qrCode || null,
              status: connectData.data?.status || "need_scan",
            });
          }
          return;
        }
        // If reconnect failed, session might be deleted on WaSender — create new one
        console.log("[wa] Reconnect failed, creating new session");
      }

      // Create new session on WaSender
      const r = await fetch(WASENDER_API + "/whatsapp-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + getWasenderPat() },
        body: JSON.stringify({
          name: name || "GoItalIA-" + companyId.slice(0, 8),
          phone_number: phoneNumber,
          account_protection: true,
          log_messages: true,
          webhook_url: webhookUrl,
          webhook_enabled: true,
          webhook_events: ["messages.received", "messages.upsert", "session.status", "qrcode.updated"],
        }),
      });

      if (!r.ok) {
        const err = await r.text();
        // If 422 "phone number already taken", find existing session on WaSender
        if (r.status === 422 && err.includes("already been taken")) {
          console.log("[wa] Phone already on WaSender, looking up existing session...");
          try {
            const listRes = await fetch(WASENDER_API + "/whatsapp-sessions", {
              headers: { Authorization: "Bearer " + getWasenderPat() },
            });
            if (listRes.ok) {
              const listData = await listRes.json() as { data?: Array<{ id: number; phone_number: string; api_key: string; webhook_secret?: string }> };
              const existing = (listData.data || []).find((s) => s.phone_number === phoneNumber || s.phone_number === phoneNumber.replace("+", ""));
              if (existing) {
                console.log("[wa] Found existing WaSender session:", existing.id);
                // Update webhook
                await fetch(WASENDER_API + "/whatsapp-sessions/" + existing.id, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json", Authorization: "Bearer " + getWasenderPat() },
                  body: JSON.stringify({ webhook_url: webhookUrl, webhook_enabled: true }),
                }).catch(() => {});
                // Save session locally
                const recoveredSession = {
                  sessionId: existing.id,
                  apiKey: existing.api_key,
                  webhookSecret: existing.webhook_secret || "",
                  phoneNumber,
                };
                const idx = sessions.findIndex((s: any) => s.phoneNumber === phoneNumber);
                if (idx >= 0) { sessions[idx] = recoveredSession; } else { sessions.push(recoveredSession); }
                const encSessions = encrypt(JSON.stringify(sessions));
                if (existingSecret) {
                  await db.update(companySecrets).set({ description: encSessions, updatedAt: new Date() }).where(eq(companySecrets.id, existingSecret.id));
                } else {
                  await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId, name: "whatsapp_sessions", provider: "encrypted", description: encSessions });
                }
                await upsertConnectorAccount(db, companyId, "whatsapp", phoneNumber);
                // Try to connect and get QR
                const connectRes = await fetch(WASENDER_API + "/whatsapp-sessions/" + existing.id + "/connect", {
                  method: "POST",
                  headers: { Authorization: "Bearer " + getWasenderPat() },
                });
                const connectData = await connectRes.json() as { data?: { status: string; qrCode?: string } };
                res.json({
                  connected: connectData.data?.status === "connected",
                  sessionId: existing.id,
                  qrCode: connectData.data?.qrCode || null,
                  status: connectData.data?.status || "need_scan",
                });
                return;
              }
            }
          } catch (lookupErr) { console.error("[wa] Session lookup error:", lookupErr); }
        }
        console.error("WaSender create error:", r.status, err);
        const errMsg = (r.status === 422 && err.includes("already been taken")) 
          ? "Questo numero è già collegato ad un'altra sessione WaSender. Scollegalo prima dalla dashboard WaSender."
          : "Errore creazione sessione WhatsApp: " + err.substring(0, 200);
        res.status(502).json({ error: errMsg });
        return;
      }

      const session = await r.json() as { data?: { id: number; api_key: string; webhook_secret: string } };
      const sessionData = session.data;
      if (!sessionData) { res.status(502).json({ error: "Risposta WaSender non valida" }); return; }

      // Save session info
      const newSession = {
        sessionId: sessionData.id,
        apiKey: sessionData.api_key,
        webhookSecret: sessionData.webhook_secret,
        phoneNumber,
      };

      const idx = sessions.findIndex((s: any) => s.phoneNumber === phoneNumber);
      if (idx >= 0) { sessions[idx] = newSession; } else { sessions.push(newSession); }
      const encSessions = encrypt(JSON.stringify(sessions));

      if (existingSecret) {
        await db.update(companySecrets).set({ description: encSessions, updatedAt: new Date() }).where(eq(companySecrets.id, existingSecret.id));
      } else {
        await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId, name: "whatsapp_sessions", provider: "encrypted", description: encSessions });
      }

      // Sync connector_accounts
      await upsertConnectorAccount(db, companyId, "whatsapp", phoneNumber, name);

      // Connect new session to get QR
      const connectRes = await fetch(WASENDER_API + "/whatsapp-sessions/" + sessionData.id + "/connect", {
        method: "POST",
        headers: { Authorization: "Bearer " + getWasenderPat() },
      });
      const connectData = await connectRes.json() as { data?: { status: string; qrCode?: string } };

      res.json({
        connected: false,
        sessionId: sessionData.id,
        qrCode: connectData.data?.qrCode || null,
        status: connectData.data?.status || "need_scan",
      });
    } catch (err) {
      console.error("WhatsApp connect error:", err);
      res.status(500).json({ error: "Errore connessione WhatsApp" });
    }
  });

  // GET /whatsapp/qr?companyId=xxx — Get fresh QR code
  router.get("/whatsapp/qr", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }

    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
      .then((rows) => rows[0]);
    if (!secret?.description) { res.json({ qrCode: null }); return; }

    try {
      const data = JSON.parse(decrypt(secret.description));
      const r = await fetch(WASENDER_API + "/whatsapp-sessions/" + data.sessionId + "/qrcode", {
        headers: { Authorization: "Bearer " + getWasenderPat() },
      });
      const qrData = await r.json() as { data?: { qrCode?: string } };
      res.json({ qrCode: qrData.data?.qrCode || null });
    } catch { res.json({ qrCode: null }); }
  });

  // GET /whatsapp/status?companyId=xxx
  router.get("/whatsapp/status", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ connected: false }); return; }

    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
      .then((rows) => rows[0]);
    if (!secret?.description) { res.json({ connected: false, numbers: [] }); return; }

    try {
      const dec = JSON.parse(decrypt(secret.description));
      const sessions = Array.isArray(dec) ? dec : [dec];
      const numbers: Array<{ phoneNumber: string; sessionId: any; status: string; connected: boolean }> = [];
      let anyConnected = false;
      for (const s of sessions) {
        try {
          const r = await fetch(WASENDER_API + "/status", { headers: { Authorization: "Bearer " + s.apiKey } });
          const data = await r.json() as { status?: string };
          const st = data.status || "unknown";
          const conn = st === "connected";
          if (conn) anyConnected = true;
          numbers.push({ phoneNumber: s.phoneNumber, sessionId: s.sessionId, status: st, connected: conn });
        } catch {
          numbers.push({ phoneNumber: s.phoneNumber, sessionId: s.sessionId, status: "error", connected: false });
        }
      }
      res.json({ connected: anyConnected, numbers });
    } catch { res.json({ connected: false, numbers: [] }); }
  });

  // POST /whatsapp/disconnect?companyId=xxx
  router.post("/whatsapp/disconnect", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string || req.body?.companyId;
    if (!companyId) { res.json({ disconnected: true }); return; }

    const phoneToRemove = req.query.phone as string || req.body?.phone || "";
    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
      .then((rows) => rows[0]);

    if (secret?.description) {
      try {
        const dec = JSON.parse(decrypt(secret.description));
        const sessions = Array.isArray(dec) ? dec : [dec];
        const toRemove = phoneToRemove ? sessions.find((s: any) => s.phoneNumber === phoneToRemove) : sessions[0];
        if (toRemove) {
          await fetch(WASENDER_API + "/whatsapp-sessions/" + toRemove.sessionId + "/disconnect", { method: "POST", headers: { Authorization: "Bearer " + getWasenderPat() } }).catch(() => {});
          await fetch(WASENDER_API + "/whatsapp-sessions/" + toRemove.sessionId, { method: "DELETE", headers: { Authorization: "Bearer " + getWasenderPat() } }).catch(() => {});
        }
        const filtered = phoneToRemove ? sessions.filter((s: any) => s.phoneNumber !== phoneToRemove) : [];
        if (filtered.length > 0) {
          await db.update(companySecrets).set({ description: encrypt(JSON.stringify(filtered)), updatedAt: new Date() }).where(eq(companySecrets.id, secret.id));
        } else {
          await db.delete(companySecrets).where(eq(companySecrets.id, secret.id));
        }
        // Sync connector_accounts
        if (phoneToRemove) {
          await removeConnectorAccount(db, companyId, "whatsapp", phoneToRemove);
        } else {
          await removeConnectorAccount(db, companyId, "whatsapp");
        }
      } catch {}
    }
    res.json({ disconnected: true });
  });

  // GET /whatsapp/messages?companyId=xxx
  router.get("/whatsapp/messages", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ messages: [] }); return; }
    try {
      const rows = await db.execute(sql`SELECT id, remote_jid, from_name, message_text, direction, message_type, media_url, created_at FROM whatsapp_messages WHERE company_id = ${companyId} ORDER BY created_at DESC LIMIT 200`);
      res.json({ messages: rows || [] });
    } catch { res.json({ messages: [] }); }
  });

  // POST /whatsapp/send
  router.post("/whatsapp/send", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, to, text, remoteJid } = req.body as { companyId: string; to?: string; text: string; remoteJid?: string };
    const rawJid = to || remoteJid || "";
    const recipient = rawJid.replace("@s.whatsapp.net", "").replace("@g.us", "").replace(/@lid$/, "");
    if (!companyId || !recipient || !text) { res.status(400).json({ error: "Parametri mancanti" }); return; }

    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
      .then((rows) => rows[0]);
    if (!secret?.description) { res.status(400).json({ error: "WhatsApp non connesso" }); return; }

    try {
      const dec = JSON.parse(decrypt(secret.description));
      const sessions = Array.isArray(dec) ? dec : [dec];
      const data = sessions[0];
      if (!data) { res.status(400).json({ error: "Nessuna sessione WhatsApp" }); return; }
      const r = await fetch(WASENDER_API + "/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + data.apiKey },
        body: JSON.stringify({ to: recipient, text }),
      });
      if (!r.ok) { res.status(502).json({ error: "Errore invio" }); return; }
      // Save with the original remote_jid so it matches the thread
      try {
        await db.execute(sql`INSERT INTO whatsapp_messages (company_id, remote_jid, from_name, message_text, direction) VALUES (${companyId}, ${rawJid}, ${"Bot"}, ${text}, ${"outgoing"})`);
      } catch {}
      res.json({ sent: true });
    } catch { res.status(500).json({ error: "Errore invio" }); }
  });

  // POST /whatsapp/send-media - Send image/file via WhatsApp
  const waUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });
  router.post("/whatsapp/send-media", waUpload.single("file"), async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, remoteJid, caption } = req.body as { companyId: string; remoteJid?: string; caption?: string };
    const file = (req as any).file;
    if (!companyId || !remoteJid || !file) { res.status(400).json({ error: "Parametri mancanti" }); return; }
    const recipient = remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", "");

    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
      .then((rows) => rows[0]);
    if (!secret?.description) { res.status(400).json({ error: "WhatsApp non connesso" }); return; }

    try {
      const dec = JSON.parse(decrypt(secret.description));
      const sessions = Array.isArray(dec) ? dec : [dec];
      const data = sessions[0];
      if (!data) { res.status(400).json({ error: "Nessuna sessione" }); return; }

      // WaSender send-media API
      let mediaBuffer = file.buffer;
      let mediaMime = file.mimetype;
      let mediaFilename = file.originalname;

      // Convert webm audio to ogg/opus (WhatsApp requires ogg, not webm)
      if (file.mimetype.includes("webm") || file.originalname.endsWith(".webm")) {
        try {
          const { execSync } = await import("child_process");
          const fs = await import("node:fs/promises");
          const crypto = await import("node:crypto");
          const tmpIn = "/tmp/wa-voice-" + crypto.randomUUID() + ".webm";
          const tmpOut = tmpIn.replace(".webm", ".ogg");
          await fs.writeFile(tmpIn, file.buffer);
          execSync(`ffmpeg -y -i ${tmpIn} -c:a libopus -b:a 64k ${tmpOut}`, { timeout: 15000 });
          mediaBuffer = await fs.readFile(tmpOut);
          mediaMime = "audio/ogg";
          mediaFilename = "vocale.ogg";
          // Cleanup temp files
          await fs.unlink(tmpIn).catch(() => {});
          await fs.unlink(tmpOut).catch(() => {});
          console.log("[wa-voice-send] converted webm -> ogg, size:", mediaBuffer.length);
        } catch (convErr) {
          console.error("[wa-voice-send] ffmpeg conversion failed:", convErr);
        }
      }

      // Save file locally and use public URL for WaSender
      let localMediaUrl: string | undefined;
      const fs2 = await import("node:fs/promises");
      const crypto2 = await import("node:crypto");
      const ext = mediaMime.includes("ogg") ? ".ogg" : mediaMime.includes("webm") ? ".webm" : mediaMime.includes("mp3") || mediaMime.includes("mpeg") ? ".mp3" : mediaMime.startsWith("image/") ? (mediaMime.includes("png") ? ".png" : ".jpg") : mediaMime.startsWith("video/") ? ".mp4" : ".bin";
      const savedFilename = crypto2.randomUUID() + ext;
      await fs2.mkdir("data/wa-media", { recursive: true });
      await fs2.writeFile("data/wa-media/" + savedFilename, mediaBuffer);
      localMediaUrl = "/api/wa-media/" + savedFilename;

      // Build public URL for WaSender
      const publicBase = "https://impresa.goitalia.eu";
      const publicUrl = publicBase + localMediaUrl;
      console.log("[wa-voice-send] saved locally, publicUrl:", publicUrl);

      // Send message with media URL
      const sendPayload: Record<string, string> = { to: recipient };
      if (mediaMime.startsWith("audio/")) {
        sendPayload.audioUrl = publicUrl;
      } else if (mediaMime.startsWith("image/")) {
        sendPayload.imageUrl = publicUrl;
        if (caption) sendPayload.text = caption;
      } else if (mediaMime.startsWith("video/")) {
        sendPayload.videoUrl = publicUrl;
        if (caption) sendPayload.text = caption;
      } else {
        sendPayload.documentUrl = publicUrl;
        if (caption) sendPayload.text = caption;
      }

      const r = await fetch(WASENDER_API + "/send-message", {
        method: "POST",
        headers: { Authorization: "Bearer " + data.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(sendPayload),
      });
      if (!r.ok) { const err = await r.text(); console.error("WA send-message error:", err); res.status(502).json({ error: "Errore invio media" }); return; }
      console.log("[wa-voice-send] message sent successfully");
      // Don't INSERT here — the webhook will save the outgoing message to avoid duplicates
      res.json({ sent: true });
    } catch (err) { console.error("WA send-media:", err); res.status(500).json({ error: "Errore invio" }); }
  });

  // GET /whatsapp/unread-count?companyId=xxx
  router.get("/whatsapp/unread-count", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ count: 0 }); return; }
    try {
      // Count unread: messages where no per-chat read marker exists after the message, falling back to global marker
      const rows = await db.execute(sql`
        SELECT COUNT(*) as count FROM whatsapp_messages wm
        WHERE wm.company_id = ${companyId} AND wm.direction = 'incoming'
        AND wm.created_at > COALESCE(
          (SELECT last_read_at FROM read_markers WHERE company_id = ${companyId} AND user_id = ${actor.userId} AND channel = 'whatsapp' AND chat_id = wm.remote_jid),
          (SELECT last_read_at FROM read_markers WHERE company_id = ${companyId} AND user_id = ${actor.userId} AND channel = 'whatsapp' AND chat_id IS NULL),
          '2000-01-01'
        )`);
      const count = (rows as any[])[0]?.count || 0;
      res.json({ count: parseInt(String(count)) });
    } catch { res.json({ count: 0 }); }
  });

  // POST /whatsapp/mark-read
  router.post("/whatsapp/mark-read", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, chatId } = req.body as { companyId: string; chatId?: string };
    if (!companyId) { res.json({ ok: true }); return; }
    try {
      if (chatId) {
        // Per-chat mark-read — also mark related JIDs (same contact may use @lid and @s.whatsapp.net)
        await db.execute(sql`DELETE FROM read_markers WHERE company_id = ${companyId} AND user_id = ${actor.userId} AND channel = 'whatsapp' AND chat_id = ${chatId}`);
        await db.execute(sql`INSERT INTO read_markers (company_id, user_id, channel, chat_id, last_read_at) VALUES (${companyId}, ${actor.userId}, 'whatsapp', ${chatId}, now())`);
        
        // Find related JIDs from same contact (by from_name) and mark those as read too
        try {
          const relatedJids = await db.execute(sql`
            SELECT DISTINCT remote_jid FROM whatsapp_messages 
            WHERE company_id = ${companyId} AND remote_jid != ${chatId}
            AND from_name = (SELECT from_name FROM whatsapp_messages WHERE company_id = ${companyId} AND remote_jid = ${chatId} AND direction = 'incoming' LIMIT 1)
            AND direction = 'incoming'
          `) as any[];
          for (const row of relatedJids) {
            if (row.remote_jid) {
              await db.execute(sql`DELETE FROM read_markers WHERE company_id = ${companyId} AND user_id = ${actor.userId} AND channel = 'whatsapp' AND chat_id = ${row.remote_jid}`);
              await db.execute(sql`INSERT INTO read_markers (company_id, user_id, channel, chat_id, last_read_at) VALUES (${companyId}, ${actor.userId}, 'whatsapp', ${row.remote_jid}, now())`);
            }
          }
        } catch {} 
        // Also mark as read on WhatsApp via WaSender API
        try {
          // Get the latest incoming message ID for this chat (search across all JIDs of same contact)
          const lastMsg = await db.execute(sql`
            SELECT wa_message_id, remote_jid FROM whatsapp_messages 
            WHERE company_id = ${companyId} AND direction = 'incoming' AND wa_message_id IS NOT NULL
            AND (remote_jid = ${chatId} OR from_name = (
              SELECT from_name FROM whatsapp_messages WHERE company_id = ${companyId} AND remote_jid = ${chatId} AND direction = 'incoming' LIMIT 1
            ))
            ORDER BY created_at DESC LIMIT 1
          `) as any[];
          const msgId = lastMsg?.[0]?.wa_message_id;
          const msgJid = lastMsg?.[0]?.remote_jid;
          if (msgId && msgJid) {
            const waSecret = await db.select().from(companySecrets)
              .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
              .then((r: any) => r[0]);
            if (waSecret?.description) {
              const sessions = JSON.parse(decrypt(waSecret.description));
              const session = Array.isArray(sessions) ? sessions[0] : sessions;
              if (session?.apiKey) {
                const readRes = await fetch(WASENDER_API + "/messages/read", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.apiKey },
                  body: JSON.stringify({ key: { id: msgId, remoteJid: String(msgJid), fromMe: false } }),
                });
                const readBody = await readRes.text();
                console.log(`[wa-mark-read] WaSender response: ${readRes.status} body=${readBody.substring(0, 200)}`);
              }
            }
          }
        } catch (err) { console.error("[wa-mark-read] WaSender API error:", err); }
      } else {
        // Global mark-read (page open)
        await db.execute(sql`DELETE FROM read_markers WHERE company_id = ${companyId} AND user_id = ${actor.userId} AND channel = 'whatsapp'`);
        await db.execute(sql`INSERT INTO read_markers (company_id, user_id, channel, last_read_at) VALUES (${companyId}, ${actor.userId}, 'whatsapp', now())`);
      }
    } catch {}
    res.json({ ok: true });
  });

  // GET /whatsapp/read-markers?companyId=xxx - Get per-chat read timestamps
  router.get("/whatsapp/read-markers", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ markers: {} }); return; }
    try {
      const rows = await db.execute(sql`SELECT chat_id, last_read_at FROM read_markers WHERE company_id = ${companyId} AND user_id = ${actor.userId} AND channel = 'whatsapp'`);
      const markers: Record<string, string> = {};
      for (const row of rows as any[]) {
        if (row.chat_id) markers[row.chat_id] = row.last_read_at;
        else markers["__global__"] = row.last_read_at;
      }
      res.json({ markers });
    } catch { res.json({ markers: {} }); }
  });

  // POST /whatsapp/generate-reply
  router.post("/whatsapp/generate-reply", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, messageText, fromName, remoteJid, mediaUrl, messageType } = req.body as { companyId: string; messageText: string; fromName: string; remoteJid?: string; mediaUrl?: string; messageType?: string };
    if (!companyId || (!messageText && !mediaUrl)) { res.status(400).json({ error: "Parametri mancanti" }); return; }

    const apiKeySecret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "claude_api_key")))
      .then((rows) => rows[0]);
    if (!apiKeySecret?.description) { res.status(400).json({ error: "API key Claude non configurata" }); return; }
    let claudeKey: string;
    try { claudeKey = decrypt(apiKeySecret.description); } catch { res.status(500).json({ error: "Errore decrypt" }); return; }

    // Get conversation history
    let history: Array<{ role: "user" | "assistant"; content: string }> = [];
    if (remoteJid) {
      try {
        const rows = await db.execute(sql`SELECT message_text, direction FROM whatsapp_messages WHERE company_id = ${companyId} AND remote_jid = ${remoteJid} ORDER BY created_at ASC LIMIT 20`);
        history = (rows as any[]).map((r: any) => ({
          role: r.direction === "incoming" ? "user" as const : "assistant" as const,
          content: r.message_text,
        }));
      } catch {}
    }
    if (history.length === 0) {
      history = [{ role: "user", content: messageText }];
    }

    try {
      // If last message has an image, add it to the request with vision
      let finalMessages: any = history;
      if (mediaUrl && messageType === "image") {
        try {
          const fs = await import("node:fs");
          const path = await import("node:path");
          const localPath = mediaUrl.replace("/api/wa-media/", "");
          const filePath = path.join(process.cwd(), "data/wa-media", localPath);
          if (fs.existsSync(filePath)) {
            const imgBuffer = fs.readFileSync(filePath);
            const base64 = imgBuffer.toString("base64");
            const mediaType = filePath.endsWith(".png") ? "image/png" : "image/jpeg";
            // Replace last message with image + text
            finalMessages = [...history.slice(0, -1), {
              role: "user" as const,
              content: [
                { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
                { type: "text", text: messageText || "L'utente ha inviato questa immagine. Descrivi cosa vedi e rispondi in modo appropriato." },
              ],
            }];
          }
        } catch (err) { console.error("[wa] image read error:", err); }
      }

      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: "Sei un assistente di customer service professionale. Rispondi in italiano, in modo conciso e cordiale. Se ti viene mostrata un\'immagine, descrivila e rispondi in modo contestuale.",
          messages: finalMessages,
        }),
      });
      if (!r.ok) { res.status(502).json({ error: "Errore AI" }); return; }
      const data = await r.json() as { content?: Array<{ text?: string }> };
      const reply = data.content?.map((c) => c.text).join("") || "";
      res.json({ reply });
    } catch { res.status(500).json({ error: "Errore generazione risposta" }); }
  });

  // POST /whatsapp/settings
  router.post("/whatsapp/settings", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, autoReply, phoneNumber } = req.body as { companyId: string; autoReply: boolean; phoneNumber?: string };
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }
    const existing = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_settings")))
      .then((rows) => rows[0]);
    let settings: Record<string, any> = {};
    if (existing?.description) { try { settings = JSON.parse(existing.description); } catch {} }
    if (!settings.numbers) settings.numbers = {};
    if (phoneNumber) { settings.numbers[phoneNumber] = { autoReply }; }
    const json = JSON.stringify(settings);
    if (existing) {
      await db.update(companySecrets).set({ description: json, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
    } else {
      await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId, name: "whatsapp_settings", provider: "plain", description: json });
    }
    res.json({ ok: true });
  });

  // GET /whatsapp/settings?companyId=xxx
  router.get("/whatsapp/settings", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ numbers: {} }); return; }
    const row = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_settings")))
      .then((rows) => rows[0]);
    if (!row?.description) { res.json({ numbers: {} }); return; }
    try { res.json(JSON.parse(row.description)); } catch { res.json({ numbers: {} }); }
  });


  // POST /whatsapp/delete-chat
  router.post("/whatsapp/delete-chat", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, remoteJid } = req.body as { companyId: string; remoteJid: string };
    if (!companyId || !remoteJid) { res.status(400).json({ error: "Parametri mancanti" }); return; }
    try {
      await db.execute(sql`DELETE FROM whatsapp_messages WHERE company_id = ${companyId} AND remote_jid = ${remoteJid}`);
      res.json({ deleted: true });
    } catch { res.status(500).json({ error: "Errore" }); }
  });
  // POST /whatsapp/contacts/sync — Sync WhatsApp contacts to company_contacts
  router.post("/whatsapp/contacts/sync", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string || req.body?.companyId;
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }

    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
      .then((rows) => rows[0]);
    if (!secret?.description) { res.status(400).json({ error: "WhatsApp non connesso" }); return; }

    try {
      const dec = JSON.parse(decrypt(secret.description));
      const sessions = Array.isArray(dec) ? dec : [dec];
      const session = sessions[0];
      if (!session?.apiKey) { res.status(400).json({ error: "Nessuna sessione WhatsApp" }); return; }

      console.log("[wa-contacts-sync] fetching contacts from WaSender...");
      const r = await fetch(WASENDER_API + "/contacts", {
        headers: { Authorization: "Bearer " + session.apiKey },
      });

      if (!r.ok) {
        const err = await r.text();
        console.error("[wa-contacts-sync] API error:", r.status, err);
        res.status(502).json({ error: "Errore API WaSender: " + r.status });
        return;
      }

      const data = await r.json() as any;
      const contacts = data.data || data || [];
      console.log("[wa-contacts-sync] received", Array.isArray(contacts) ? contacts.length : 0, "contacts");

      let totalImported = 0;
      const contactList = Array.isArray(contacts) ? contacts : [];

      for (const c of contactList) {
        if (c.isGroup || (c.id || "").includes("@g.us")) continue;
        
        const phone = (c.id || "").replace("@s.whatsapp.net", "").replace("@c.us", "");
        if (!phone || phone.length < 5) continue;
        
        const name = c.name || c.notify || "";
        const photoUrl = c.imgUrl || "";
        const sourceId = "wa_" + phone;
        const contactId = crypto.randomUUID();

        try {
          await db.execute(sql`
            INSERT INTO company_contacts (id, company_id, source, source_id, name, phone, photo_url, updated_at)
            VALUES (${contactId}, ${companyId}, 'whatsapp', ${sourceId}, ${name || null}, ${'+' + phone}, ${photoUrl || null}, NOW())
            ON CONFLICT (company_id, source, source_id) DO UPDATE SET
              name = COALESCE(NULLIF(EXCLUDED.name, ''), company_contacts.name),
              phone = EXCLUDED.phone,
              photo_url = COALESCE(EXCLUDED.photo_url, company_contacts.photo_url),
              updated_at = NOW()
          `);
          totalImported++;
        } catch (err) {
          console.error("[wa-contacts-sync] insert error:", err);
        }
      }

      console.log("[wa-contacts-sync] imported", totalImported, "contacts");
      res.json({ imported: totalImported });
    } catch (err) {
      console.error("[wa-contacts-sync] error:", err);
      res.status(500).json({ error: "Errore sync contatti WhatsApp" });
    }
  });

  // GET /whatsapp/health-check — Check all sessions across all companies
  router.get("/whatsapp/health-check", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    try {
      const results = await checkAllWhatsAppSessions(db);
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: "Errore health check" });
    }
  });

  // Periodic health check every 5 minutes
  setInterval(async () => {
    try {
      await checkAllWhatsAppSessions(db);
    } catch (err) {
      console.error("[wa-health] periodic check error:", err);
    }
  }, 5 * 60 * 1000);

  // Run initial check after 30 seconds
  setTimeout(async () => {
    try {
      await checkAllWhatsAppSessions(db);
    } catch (err) {
      console.error("[wa-health] initial check error:", err);
    }
  }, 30 * 1000);

  return router;
}

async function checkAllWhatsAppSessions(db: Db) {
  const allSecrets = await db.select().from(companySecrets)
    .where(eq(companySecrets.name, "whatsapp_sessions"));
  
  const results: Array<{ companyId: string; phoneNumber: string; sessionId: string; status: string; connected: boolean }> = [];

  for (const secret of allSecrets) {
    if (!secret.description) continue;
    try {
      const dec = JSON.parse(decrypt(secret.description));
      const sessions = Array.isArray(dec) ? dec : [dec];
      for (const s of sessions) {
        try {
          const r = await fetch(WASENDER_API + "/status", { 
            headers: { Authorization: "Bearer " + s.apiKey },
          });
          const data = await r.json() as { status?: string };
          const status = data.status || "unknown";
          const connected = status === "connected";
          results.push({ 
            companyId: secret.companyId, 
            phoneNumber: s.phoneNumber || "?", 
            sessionId: s.sessionId || "?", 
            status, 
            connected 
          });
          if (!connected) {
            console.warn(`[wa-health] ⚠️ Session DISCONNECTED: company=${secret.companyId} phone=${s.phoneNumber} status=${status}`);
          } else {
            console.log(`[wa-health] ✅ Session OK: company=${secret.companyId} phone=${s.phoneNumber}`);
          }
        } catch (err) {
          console.error(`[wa-health] ❌ Error checking session: company=${secret.companyId} phone=${s.phoneNumber}`, err);
          results.push({ companyId: secret.companyId, phoneNumber: s.phoneNumber || "?", sessionId: s.sessionId || "?", status: "error", connected: false });
        }
      }
    } catch {}
  }

  return results;
}

export function whatsappWebhookRouter(db: Db) {
  const router = Router();

  router.post("/:companyId", async (req, res) => {
    const companyId = req.params.companyId;
    const event = req.body;
    // Basic validation — reject if no valid event structure
    if (!event?.event || !companyId || companyId.length < 20) {
      res.status(400).json({ error: "Invalid webhook" });
      return;
    }
    // Respond immediately
    res.json({ ok: true });

    // Log all webhook events for debugging
    const fromMe = event?.data?.messages?.key?.fromMe;
    console.log(`[wa-webhook] event=${event?.event} fromMe=${fromMe} remoteJid=${event?.data?.messages?.key?.remoteJid || "?"} keys=${Object.keys(event?.data || {}).join(",")}`);

    if (event?.event === "messages.received" && event?.data?.messages) {
      const msg = event.data.messages;
      const remoteJid = msg.key?.remoteJid || "";
      const fromName = msg.pushName || msg.key?.cleanedSenderPn || "";
      const waMessageId = msg.key?.id || null;
      // Extract real phone number for rubrica lookup (WaSender may use LID format in remoteJid)
      const senderPhone = msg.key?.cleanedSenderPn || msg.senderPn || msg.cleanedSenderPn || (remoteJid.includes("@lid") ? "" : remoteJid);
      console.log(`[wa-webhook-debug] remoteJid=${remoteJid} senderPhone=${senderPhone} pushName=${msg.pushName} cleanedSenderPn=${msg.key?.cleanedSenderPn || msg.cleanedSenderPn} senderPn=${msg.senderPn} participant=${msg.key?.participant} msgKeys=${JSON.stringify(Object.keys(msg.key || {}))} topKeys=${JSON.stringify(Object.keys(msg).filter(k => k !== 'message'))}`);
      let text = msg.messageBody || msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
      let messageType = "text";
      let mediaUrl = "";
      
      // Handle voice messages
      if (!text && (msg.message?.audioMessage || msg.messageType === "audio")) {
        messageType = "audio";
        try {
          const waSecret = await db.select().from(companySecrets)
            .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
            .then((r: any) => r[0]);
          
          let audioBuffer: ArrayBuffer | null = null;
          if (waSecret?.description) {
            const sessions = JSON.parse(decrypt(waSecret.description));
            const session = Array.isArray(sessions) ? sessions[0] : sessions;
            if (session?.apiKey) {
              const decryptRes = await fetch("https://www.wasenderapi.com/api/decrypt-media", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.apiKey },
                body: JSON.stringify({ data: { messages: msg } }),
              });
              const decryptText = await decryptRes.text();
              console.log(`[wa-voice] decrypt-media status=${decryptRes.status}, body=${decryptText.substring(0, 500)}`);
              if (decryptRes.ok || decryptRes.status === 200) {
                let decData: any = {};
                try { decData = JSON.parse(decryptText); } catch {}
                const audioUrl = decData.data?.url || decData.publicUrl;
                if (audioUrl) {
                  const audioRes = await fetch(audioUrl);
                  audioBuffer = await audioRes.arrayBuffer();
                  console.log(`[wa-voice] audio downloaded: ${audioBuffer.byteLength} bytes`);

                  // Save audio file to disk for playback
                  const audioFilename = crypto.randomUUID() + ".ogg";
                  const fs = await import("node:fs/promises");
                  await fs.mkdir("data/wa-media", { recursive: true });
                  await fs.writeFile("data/wa-media/" + audioFilename, Buffer.from(audioBuffer));
                  mediaUrl = "/api/wa-media/" + audioFilename;

                  // Transcribe with Whisper if OpenAI key available
                  const openaiSecret = await db.select().from(companySecrets)
                    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "openai_api_key")))
                    .then((r: any) => r[0]);
                  if (openaiSecret?.description) {
                    const openaiKey = decrypt(openaiSecret.description);
                    const formData = new FormData();
                    formData.append("file", new Blob([audioBuffer], { type: "audio/ogg" }), "voice.ogg");
                    formData.append("model", "whisper-1");
                    formData.append("language", "it");
                    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
                      method: "POST", headers: { Authorization: "Bearer " + openaiKey }, body: formData,
                    });
                    const whisperText = await whisperRes.text();
                    console.log(`[wa-voice] whisper status=${whisperRes.status}, body=${whisperText.substring(0, 300)}`);
                    if (whisperRes.ok) {
                      const result = JSON.parse(whisperText) as { text?: string };
                      text = "🎤 " + (result.text || "[vocale non comprensibile]");
                    }
                  } else {
                    text = "🎤 [Messaggio vocale]";
                  }
                } else {
                  console.log(`[wa-voice] no audio URL in decrypt response`);
                }
              }
            }
          }
          if (!text) text = "🎤 [Messaggio vocale]";
        } catch (err) { console.error("[wa-webhook] voice error:", err); text = "🎤 [Messaggio vocale]"; }
      }
      
      // Handle image/video/document messages
      
      if (msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.documentMessage || msg.messageType === "image" || msg.messageType === "video" || msg.messageType === "document") {
        messageType = msg.message?.imageMessage ? "image" : msg.message?.videoMessage ? "video" : "document";
        const caption = msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || "";
        if (caption) text = caption;
        
        // Download media via WaSender decrypt-media API and save locally
        try {
          const waSecret = await db.select().from(companySecrets)
            .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
            .then((r: any) => r[0]);
          if (waSecret?.description) {
            const sessions = JSON.parse(decrypt(waSecret.description));
            const session = Array.isArray(sessions) ? sessions[0] : sessions;
            if (session?.apiKey) {
              
              const decryptRes = await fetch("https://www.wasenderapi.com/api/decrypt-media", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.apiKey },
                body: JSON.stringify({ data: { messages: msg } }),
              });
              const decText = await decryptRes.text();
              
              if (decryptRes.ok || decryptRes.status === 200) {
                let decData: any = {};
                try { decData = JSON.parse(decText); } catch {}
                if (decData.publicUrl || decData.data?.url) {
                  // Download the file and save locally
                  const mediaRes = await fetch(decData.publicUrl || decData.data?.url);
                  if (mediaRes.ok) {
                    const buffer = Buffer.from(await mediaRes.arrayBuffer());
                    const ext = messageType === "image" ? ".jpg" : messageType === "video" ? ".mp4" : ".bin";
                    const filename = crypto.randomUUID() + ext;
                    const fs = await import("node:fs/promises");
                    await fs.writeFile("data/wa-media/" + filename, buffer);
                    mediaUrl = "/api/wa-media/" + filename;
                  }
                }
              }
            }
          }
        } catch (err) { console.error("[wa-webhook] media download error:", err); }
        
        
        if (!text) text = messageType === "image" ? "[Immagine]" : messageType === "video" ? "[Video]" : "[Documento]";
      }
      
      if (text) {
        const isFromMe = msg.key?.fromMe === true;
        const direction = isFromMe ? "outgoing" : "incoming";
        const saveName = isFromMe ? "Tu" : fromName;
        try {
          if (isFromMe) {
            // Avoid duplicates for outgoing messages (may already be saved from dashboard send)
            const existing = await db.execute(sql`
              SELECT id FROM whatsapp_messages 
              WHERE company_id = ${companyId} AND remote_jid = ${remoteJid} AND direction = ${"outgoing"} AND message_text = ${text}
              AND created_at > NOW() - INTERVAL '30 seconds' LIMIT 1
            `) as any[];
            if (!existing || existing.length === 0) {
              await db.execute(sql`INSERT INTO whatsapp_messages (company_id, remote_jid, from_name, message_text, direction, message_type, media_url, wa_message_id) VALUES (${companyId}, ${remoteJid}, ${saveName}, ${text}, ${direction}, ${messageType}, ${mediaUrl || null}, ${waMessageId})`);
              console.log(`[wa-webhook] saved phone-sent message to ${remoteJid}: ${text.substring(0, 50)}`);
            }
          } else {
            await db.execute(sql`INSERT INTO whatsapp_messages (company_id, remote_jid, from_name, message_text, direction, message_type, media_url, wa_message_id) VALUES (${companyId}, ${remoteJid}, ${saveName}, ${text}, ${direction}, ${messageType}, ${mediaUrl || null}, ${waMessageId})`);
          }
        } catch (err) { console.error("[wa-webhook] save error:", err); }

        // Auto-reply via agent connector
        try {
          const agentLink = await db.select({ agentId: agentConnectorAccounts.agentId })
            .from(agentConnectorAccounts)
            .innerJoin(connectorAccounts, eq(agentConnectorAccounts.connectorAccountId, connectorAccounts.id))
            .where(and(
              eq(connectorAccounts.companyId, companyId),
              eq(connectorAccounts.connectorType, "whatsapp"),
            ))
            .then(r => r[0]);

          if (agentLink) {
            const agent = await db.select().from(agents).where(eq(agents.id, agentLink.agentId)).then(r => r[0]);
            if (agent) {
              const agentAutoReply = (agent.adapterConfig as any)?.autoReply === true;

              // Lookup rubrica contatto per override autoMode e contesto
              // Use senderPhone (real number) for lookup, fallback to remoteJid
              const lookupNumber = senderPhone || remoteJid;
              const contactInfo = lookupNumber ? await getContactContext(db, agent.id, lookupNumber) : null;

              // Determina se rispondere in automatico
              let shouldAutoReply = agentAutoReply;
              if (contactInfo) {
                if (contactInfo.autoMode === "auto") shouldAutoReply = true;
                else if (contactInfo.autoMode === "manual") shouldAutoReply = false;
                // "inherit" → segue il default dell'agente
              }

              if (shouldAutoReply) {
                const claudeSecret = await db.select().from(companySecrets)
                  .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "claude_api_key")))
                  .then(r => r[0]);
                if (claudeSecret?.description) {
                  const claudeKey = decrypt(claudeSecret.description);
                  const adapterConfig = agent.adapterConfig as Record<string, unknown>;
                  let prompt = (adapterConfig?.promptTemplate as string) || `Sei ${agent.name}. Rispondi in italiano in modo conciso.`;

                  // Regola fissa: rispondi nella lingua dell'ultimo messaggio ricevuto
                  prompt += "\n\nREGOLA IMPORTANTE: Rispondi SEMPRE nella stessa lingua in cui è scritto l'ultimo messaggio che ricevi. Se scrivono in inglese, rispondi in inglese. Se in spagnolo, in spagnolo. Se in italiano, in italiano. Adatta la lingua automaticamente.";

                  // Arricchisci il prompt con contesto del contatto dalla rubrica
                  if (contactInfo?.context) {
                    prompt += contactInfo.context;
                  }

                  // Get conversation history for context
                  let history: Array<{ role: "user" | "assistant"; content: string }> = [];
                  try {
                    const rows = await db.execute(sql`SELECT message_text, direction FROM whatsapp_messages WHERE company_id = ${companyId} AND remote_jid = ${remoteJid} ORDER BY created_at ASC LIMIT 20`);
                    history = (rows as any[]).map((r: any) => ({
                      role: r.direction === "incoming" ? "user" as const : "assistant" as const,
                      content: r.message_text,
                    }));
                  } catch {}
                  if (history.length === 0) {
                    history = [{ role: "user", content: text }];
                  }

                  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
                    body: JSON.stringify({
                      model: (adapterConfig?.model as string) || "claude-haiku-4-5-20251001",
                      max_tokens: 1024,
                      system: prompt,
                      messages: history,
                    }),
                  });

                  if (claudeRes.ok) {
                    const data = await claudeRes.json() as { content?: Array<{ text?: string }> };
                    const reply = data.content?.find(b => b.text)?.text;
                    if (reply) {
                      // Send reply via WaSender API
                      const waSecret = await db.select().from(companySecrets)
                        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
                        .then(r => r[0]);
                      if (waSecret?.description) {
                        const sessions = JSON.parse(decrypt(waSecret.description));
                        const session = Array.isArray(sessions) ? sessions[0] : sessions;
                        if (session?.apiKey) {
                          await fetch(WASENDER_API + "/send-message", {
                            method: "POST",
                            headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.apiKey },
                            body: JSON.stringify({ to: remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", ""), text: reply }),
                          });
                          try {
                            await db.execute(sql`INSERT INTO whatsapp_messages (company_id, remote_jid, from_name, message_text, direction) VALUES (${companyId}, ${remoteJid}, ${agent.name || "Bot"}, ${reply}, ${"outgoing"})`);
                          } catch {}

                          // Auto-generate conversation summary (async, don't block)
                          if (contactInfo && lookupNumber) {
                            generateConversationSummary(db, companyId, remoteJid, lookupNumber, claudeKey, agent.name || "Agente").catch(err =>
                              console.error("[wa-summary] error:", err)
                            );
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        } catch (autoReplyErr) { console.error("[wa-webhook] auto-reply error:", autoReplyErr); }
      }
    }

    // Handle messages sent from the phone (so they appear in the dashboard)
    if ((event?.event === "messages.upsert" || event?.event === "message.sent") && event?.data?.messages) {
      const msg = event.data.messages;
      const fromMe = msg.key?.fromMe === true;
      if (fromMe) {
        const remoteJid = msg.key?.remoteJid || "";
        if (!remoteJid || remoteJid.endsWith("@g.us") || remoteJid === "status@broadcast") {
          // Skip group/status messages
        } else {
          let text = msg.messageBody || msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
          let messageType = "text";
          let mediaUrl = "";

          // Handle media in outgoing
          if (msg.message?.imageMessage) {
            messageType = "image";
            text = msg.message.imageMessage.caption || "[Immagine]";
          } else if (msg.message?.videoMessage) {
            messageType = "video";
            text = msg.message.videoMessage.caption || "[Video]";
          } else if (msg.message?.audioMessage) {
            messageType = "audio";
            text = "🎤 [Vocale inviato]";
          } else if (msg.message?.documentMessage) {
            messageType = "document";
            text = msg.message.documentMessage.fileName || "[Documento]";
          }

          // Download media for playback (images, videos, audio)
          if (messageType !== "text" && messageType !== "document") {
            try {
              const waSecret = await db.select().from(companySecrets)
                .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_sessions")))
                .then((r: any) => r[0]);
              if (waSecret?.description) {
                const sessions = JSON.parse(decrypt(waSecret.description));
                const session = Array.isArray(sessions) ? sessions[0] : sessions;
                if (session?.apiKey) {
                  const decryptRes = await fetch("https://www.wasenderapi.com/api/decrypt-media", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.apiKey },
                    body: JSON.stringify({ data: { messages: msg } }),
                  });
                  if (decryptRes.ok || decryptRes.status === 200) {
                    let decData: any = {};
                    try { decData = JSON.parse(await decryptRes.text()); } catch {}
                    const fileUrl = decData.data?.url || decData.publicUrl;
                    if (fileUrl) {
                      const fileRes = await fetch(fileUrl);
                      const fileBuffer = await fileRes.arrayBuffer();
                      const ext = messageType === "image" ? ".jpg" : messageType === "video" ? ".mp4" : ".ogg";
                      const filename = crypto.randomUUID() + ext;
                      const fs = await import("node:fs/promises");
                      await fs.mkdir("data/wa-media", { recursive: true });
                      await fs.writeFile("data/wa-media/" + filename, Buffer.from(fileBuffer));
                      mediaUrl = "/api/wa-media/" + filename;
                      console.log(`[wa-webhook] saved outgoing ${messageType}: ${fileBuffer.byteLength} bytes`);
                    }
                  }
                }
              }
            } catch (err) { console.error("[wa-webhook] outgoing media download error:", err); }
          }

          if (text) {
            try {
              // Avoid duplicates: check if we already saved this (e.g. sent via dashboard)
              const existing = await db.execute(sql`
                SELECT id FROM whatsapp_messages 
                WHERE company_id = ${companyId} AND remote_jid = ${remoteJid} AND direction = ${"outgoing"} AND message_text = ${text}
                AND created_at > NOW() - INTERVAL '30 seconds' LIMIT 1
              `) as any[];
              if (!existing || existing.length === 0) {
                await db.execute(sql`INSERT INTO whatsapp_messages (company_id, remote_jid, from_name, message_text, direction, message_type, media_url) VALUES (${companyId}, ${remoteJid}, ${"Tu"}, ${text}, ${"outgoing"}, ${messageType}, ${mediaUrl || null})`);
                console.log(`[wa-webhook] saved phone-sent message to ${remoteJid}: ${text.substring(0, 50)}`);
              }
            } catch (err) { console.error("[wa-webhook] save sent-from-phone error:", err); }
          }
        }
      }
    }
  });

  // Auto-generate conversation summary after each reply
  async function generateConversationSummary(db: Db, companyId: string, remoteJid: string, phoneNumber: string, claudeKey: string, agentName: string) {
    const normalized = normalizePhoneNumber(phoneNumber);
    const contact = await db.select().from(whatsappContacts)
      .where(and(eq(whatsappContacts.companyId, companyId), eq(whatsappContacts.phoneNumber, normalized)))
      .then(r => r[0]);
    if (!contact) return;

    // Only re-summarize if last summary is older than 5 minutes (avoid spam)
    if (contact.lastSummaryAt && (Date.now() - new Date(contact.lastSummaryAt).getTime()) < 5 * 60 * 1000) return;

    // Get recent conversation
    const rows = await db.execute(sql`
      SELECT message_text, direction, from_name, created_at
      FROM whatsapp_messages
      WHERE company_id = ${companyId} AND remote_jid = ${remoteJid}
      ORDER BY created_at DESC LIMIT 30
    `) as any[];
    if (!rows || rows.length < 2) return;

    const msgs = rows.reverse();
    const transcript = msgs.map((m: any) => {
      const who = m.direction === "incoming" ? (contact.name || phoneNumber) : agentName;
      const time = new Date(m.created_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
      return `[${time}] ${who}: ${m.message_text}`;
    }).join("\n");

    const summaryRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: "Sei un assistente che riassume conversazioni WhatsApp per il titolare dell'azienda. Scrivi un riassunto conciso in italiano con: 1) Cosa si sono detti 2) Punti importanti da sapere 3) Eventuali azioni richieste o promesse fatte. Sii breve e diretto, usa bullet points.",
        messages: [{ role: "user", content: `Riassumi questa conversazione:\n\n${transcript}` }],
      }),
    });

    if (summaryRes.ok) {
      const data = await summaryRes.json() as { content?: Array<{ text?: string }> };
      const summary = data.content?.find(b => b.text)?.text;
      if (summary) {
        await db.update(whatsappContacts).set({
          lastSummary: summary,
          lastSummaryAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(whatsappContacts.id, contact.id));
      }
    }
  }



  

  

  // POST /whatsapp/settings
  router.post("/whatsapp/settings", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const { companyId, autoReply, phoneNumber } = req.body as { companyId: string; autoReply: boolean; phoneNumber?: string };
    if (!companyId) { res.status(400).json({ error: "companyId richiesto" }); return; }
    const existing = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_settings")))
      .then((rows) => rows[0]);
    let settings: Record<string, any> = {};
    if (existing?.description) { try { settings = JSON.parse(existing.description); } catch {} }
    if (!settings.numbers) settings.numbers = {};
    if (phoneNumber) { settings.numbers[phoneNumber] = { autoReply }; }
    const json = JSON.stringify(settings);
    if (existing) {
      await db.update(companySecrets).set({ description: json, updatedAt: new Date() }).where(eq(companySecrets.id, existing.id));
    } else {
      await db.insert(companySecrets).values({ id: crypto.randomUUID(), companyId, name: "whatsapp_settings", provider: "plain", description: json });
    }
    res.json({ ok: true });
  });

  // GET /whatsapp/settings?companyId=xxx
  router.get("/whatsapp/settings", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ numbers: {} }); return; }
    const row = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "whatsapp_settings")))
      .then((rows) => rows[0]);
    if (!row?.description) { res.json({ numbers: {} }); return; }
    try { res.json(JSON.parse(row.description)); } catch { res.json({ numbers: {} }); }
  });

  return router;
}

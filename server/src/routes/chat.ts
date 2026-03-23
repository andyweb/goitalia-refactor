import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets, agents, companyMemberships } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import { decryptSecret } from "./onboarding.js";

export function chatRoutes(db: Db) {
  const router = Router();

  // POST /chat — Send message to an agent and get Claude response
  router.post("/chat", async (req, res) => {
    try {
      const actor = req.actor as { type?: string; userId?: string; companyIds?: string[] } | undefined;
      if (!actor || actor.type !== "board" || !actor.userId) {
        res.status(401).json({ error: "Autenticazione richiesta" });
        return;
      }

      const { companyId, agentId, message, history } = req.body as {
        companyId: string;
        agentId?: string;
        message: string;
        history?: Array<{ role: "user" | "assistant"; content: string }>;
      };

      if (!companyId || !message) {
        res.status(400).json({ error: "companyId e message sono obbligatori" });
        return;
      }

      // Verify user has access to company
      const membership = await db.select().from(companyMemberships)
        .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, actor.userId)))
        .then((rows) => rows[0]);

      if (!membership) {
        res.status(403).json({ error: "Accesso non autorizzato" });
        return;
      }

      // Get Claude API key
      const secret = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "claude_api_key")))
        .then((rows) => rows[0]);

      if (!secret?.description) {
        res.status(400).json({ error: "API key Claude non configurata. Vai su Impostazioni per inserirla." });
        return;
      }

      const apiKey = decryptSecret(secret.description);

      // Get agent instructions if agentId provided
      let systemPrompt = "Sei un assistente AI di GoItalIA. Rispondi in italiano in modo professionale e conciso.";

      if (agentId) {
        const agent = await db.select().from(agents)
          .where(eq(agents.id, agentId))
          .then((rows) => rows[0]);

        if (agent) {
          const adapterConfig = agent.adapterConfig as Record<string, unknown> | null;
          const promptTemplate = typeof adapterConfig?.promptTemplate === "string" ? adapterConfig.promptTemplate : "";
          const capabilities = agent.capabilities ?? "";

          systemPrompt = promptTemplate || `Sei ${agent.name}, ${agent.title ?? agent.role} presso l'azienda del cliente.\n\nCompetenze: ${capabilities}\n\nRispondi sempre in italiano, in modo professionale e conciso.`;
        }
      }

      // Build messages
      const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
      if (history && Array.isArray(history)) {
        for (const msg of history.slice(-20)) { // max 20 messages context
          messages.push({ role: msg.role, content: msg.content });
        }
      }
      messages.push({ role: "user", content: message });

      // Call Claude API with streaming
      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: systemPrompt,
          messages,
          stream: true,
        }),
      });

      if (!claudeRes.ok) {
        const errText = await claudeRes.text();
        console.error("Claude API error:", claudeRes.status, errText);
        res.status(502).json({ error: "Errore nella comunicazione con Claude AI" });
        return;
      }

      // Stream the response
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const reader = claudeRes.body as unknown as AsyncIterable<Uint8Array>;
      const decoder = new TextDecoder();

      for await (const chunk of reader) {
        const text = decoder.decode(chunk, { stream: true });
        res.write(text);
      }

      res.end();
    } catch (error) {
      console.error("Chat error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Errore nella chat" });
      }
    }
  });

  return router;
}

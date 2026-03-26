# Attività Programmate + Auto-Reply — Piano di Implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere attività programmate (cron) gestite dal CEO via chat + toggle auto-reply per agenti conversazionali.

**Architecture:** Riusa tabelle DB esistenti (`routines`, `routine_triggers`, `routine_runs`). Nuovo `RoutineScheduler` service con tick loop 30s modellato su `pluginJobScheduler`. Tool CEO per creare/gestire routine. Approvazione bozze in chat + UI dedicata. Auto-reply come campo `autoReply` in `adapterConfig`.

**Tech Stack:** Node.js, Express, Drizzle ORM, PostgreSQL, Claude API, React, TypeScript

---

## File Structure

### Nuovi file
| File | Responsabilità |
|------|---------------|
| `server/src/services/routine-scheduler.ts` | Tick loop 30s, dispatch routine → agente Claude API |
| `server/src/services/routine-executor.ts` | Esecuzione routine: chiama agente, salva risultato, gestisce approvazione |

### File da modificare
| File | Cosa cambia |
|------|-------------|
| `server/src/routes/chat.ts` | 3 nuovi tool CEO + case nel switch executeChatTool |
| `server/src/app.ts` | Avvio RoutineScheduler + endpoint approvazione |
| `server/src/routes/whatsapp.ts` | Auto-reply: controlla autoReply, chiama agente |
| `server/src/routes/telegram.ts` | Auto-reply: controlla autoReply, chiama agente |
| `ui/src/components/Sidebar.tsx` | Voce menu "Attività Programmate" + badge pending |
| `ui/src/App.tsx` | Route /scheduled |
| `ui/src/pages/Routines.tsx` | Adattare stile glass + italiano + tab "Da approvare" |
| `ui/src/pages/AgentDetail.tsx` | Toggle auto-reply nella tab Connettori |

---

### Task 1: RoutineScheduler — Tick Loop

**Files:**
- Create: `server/src/services/routine-scheduler.ts`
- Modify: `server/src/app.ts`

- [ ] **Step 1: Creare routine-scheduler.ts**

```typescript
// server/src/services/routine-scheduler.ts
import type { Db } from "@goitalia/db";
import { routineTriggers, routines, routineRuns } from "@goitalia/db";
import { and, eq, lte, ne } from "drizzle-orm";
import { parseCron, nextCronTick } from "./cron.js";
import { randomUUID } from "node:crypto";

const TICK_INTERVAL_MS = 30_000;

export interface RoutineScheduler {
  start(): void;
  stop(): void;
}

export function createRoutineScheduler(db: Db, executeRun: (runId: string, routineId: string) => Promise<void>): RoutineScheduler {
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const now = new Date();
      const dueTriggers = await db.select({
        triggerId: routineTriggers.id,
        routineId: routineTriggers.routineId,
        cronExpression: routineTriggers.cronExpression,
        timezone: routineTriggers.timezone,
        companyId: routineTriggers.companyId,
      })
        .from(routineTriggers)
        .innerJoin(routines, eq(routineTriggers.routineId, routines.id))
        .where(and(
          lte(routineTriggers.nextRunAt, now),
          eq(routineTriggers.enabled, true),
          eq(routineTriggers.kind, "cron"),
          eq(routines.status, "active"),
        ))
        .limit(20);

      for (const trigger of dueTriggers) {
        try {
          // Check concurrency: skip if already running
          const activeRun = await db.select({ id: routineRuns.id })
            .from(routineRuns)
            .where(and(
              eq(routineRuns.routineId, trigger.routineId),
              eq(routineRuns.status, "received"),
            ))
            .then(r => r[0]);

          if (activeRun) continue; // skip_if_active default

          // Create run
          const runId = randomUUID();
          await db.insert(routineRuns).values({
            id: runId,
            companyId: trigger.companyId,
            routineId: trigger.routineId,
            triggerId: trigger.triggerId,
            source: "cron",
            status: "received",
            triggeredAt: now,
          });

          // Update trigger: next run + last fired
          if (trigger.cronExpression) {
            const parsed = parseCron(trigger.cronExpression);
            const next = nextCronTick(parsed, now);
            await db.update(routineTriggers)
              .set({
                nextRunAt: next,
                lastFiredAt: now,
              })
              .where(eq(routineTriggers.id, trigger.triggerId));
          }

          // Dispatch execution (async, don't await)
          executeRun(runId, trigger.routineId).catch((err) => {
            console.error("[routine-scheduler] execution error:", err);
          });
        } catch (err) {
          console.error("[routine-scheduler] trigger error:", trigger.triggerId, err);
        }
      }
    } catch (err) {
      console.error("[routine-scheduler] tick error:", err);
    } finally {
      ticking = false;
    }
  }

  return {
    start() {
      console.log("[routine-scheduler] started, tick every", TICK_INTERVAL_MS, "ms");
      timer = setInterval(tick, TICK_INTERVAL_MS);
      // Run first tick immediately
      void tick();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      console.log("[routine-scheduler] stopped");
    },
  };
}
```

- [ ] **Step 2: Verificare compilazione**

Run: `cd server && npx tsc --noEmit`
Expected: nessun errore

- [ ] **Step 3: Commit**

```bash
git add server/src/services/routine-scheduler.ts
git commit -m "feat: RoutineScheduler tick loop — query routine_triggers, create runs, advance next_run_at"
```

---

### Task 2: Routine Executor — Esecuzione Agente Claude API

**Files:**
- Create: `server/src/services/routine-executor.ts`

- [ ] **Step 1: Creare routine-executor.ts**

```typescript
// server/src/services/routine-executor.ts
import type { Db } from "@goitalia/db";
import { routines, routineRuns, agents, companySecrets, connectorAccounts, agentConnectorAccounts } from "@goitalia/db";
import { eq, and } from "drizzle-orm";
import { decrypt } from "../utils/crypto.js";

// Reuse filterToolsForAgent and getAgentConnectorsFromDb from chat.ts
// We'll import TOOLS, TOOL_CONNECTOR, filterToolsForAgent from chat.ts exports

export function createRoutineExecutor(db: Db) {

  async function executeRun(runId: string, routineId: string): Promise<void> {
    // 1. Load routine + agent
    const routine = await db.select().from(routines)
      .where(eq(routines.id, routineId))
      .then(r => r[0]);
    if (!routine || !routine.assigneeAgentId) {
      await db.update(routineRuns).set({ status: "failed", failureReason: "Routine o agente non trovato" }).where(eq(routineRuns.id, runId));
      return;
    }

    const agent = await db.select().from(agents)
      .where(eq(agents.id, routine.assigneeAgentId))
      .then(r => r[0]);
    if (!agent) {
      await db.update(routineRuns).set({ status: "failed", failureReason: "Agente non trovato" }).where(eq(routineRuns.id, runId));
      return;
    }

    // 2. Get API key
    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, routine.companyId), eq(companySecrets.name, "claude_api_key")))
      .then(r => r[0]);
    if (!secret?.description) {
      await db.update(routineRuns).set({ status: "failed", failureReason: "API key Claude non configurata" }).where(eq(routineRuns.id, runId));
      return;
    }
    const apiKey = decrypt(secret.description);

    // 3. Build agent prompt
    const adapterConfig = agent.adapterConfig as Record<string, unknown> | null;
    const promptTemplate = typeof adapterConfig?.promptTemplate === "string" ? adapterConfig.promptTemplate : "";
    const customInstructions = typeof adapterConfig?.customInstructions === "string" ? adapterConfig.customInstructions : "";
    const capabilities = agent.capabilities ?? "";
    const basePrompt = promptTemplate || `Sei ${agent.name}, ${agent.title ?? agent.role} presso l'azienda del cliente.\nCompetenze: ${capabilities}\nEsegui il compito assegnato usando i tool a disposizione. Rispondi in italiano, in modo conciso e operativo.`;
    let systemPrompt = customInstructions.trim() ? basePrompt + "\n\n## ISTRUZIONI AGGIUNTIVE\n" + customInstructions : basePrompt;

    // 4. Check approval mode
    const metadata = (routine as any).metadata as Record<string, unknown> | null;
    const approvalRequired = metadata?.approval_required === true;

    if (approvalRequired) {
      systemPrompt += "\n\n## MODALITA' BOZZA\nIMPORTANTE: Prepara il contenuto completo ma NON eseguire l'azione finale (non pubblicare, non inviare, non creare). Restituisci SOLO la bozza pronta per l'approvazione del cliente. Descrivi cosa faresti e mostra il contenuto preparato.";
    }

    // 5. Get agent connectors and filter tools
    const connRows = await db.select({
      connectorType: connectorAccounts.connectorType,
      accountId: connectorAccounts.accountId,
    }).from(agentConnectorAccounts)
      .innerJoin(connectorAccounts, eq(agentConnectorAccounts.connectorAccountId, connectorAccounts.id))
      .where(eq(agentConnectorAccounts.agentId, agent.id));

    // Build connectors map (same logic as getAgentConnectorsFromDb in chat.ts)
    const connectors: Record<string, boolean> = {};
    for (const row of connRows) {
      const t = row.connectorType;
      if (t === "google") { connectors.gmail = true; connectors.calendar = true; connectors.drive = true; }
      else if (t === "telegram") { connectors["tg_" + row.accountId] = true; }
      else if (t === "whatsapp") { connectors.whatsapp = true; }
      else if (t === "meta_ig") { connectors["ig_" + row.accountId] = true; }
      else if (t === "meta_fb") { connectors["fb_" + row.accountId] = true; }
      else if (t === "linkedin") { connectors.linkedin = true; }
      else if (t === "fal") { connectors.fal = true; }
      else if (t === "fic") { connectors.fic = true; }
      else if (t === "openapi") { connectors.oai_company = true; connectors.oai_risk = true; connectors.oai_cap = true; }
      else if (t === "voice") { connectors.voice = true; }
    }

    // Fallback to adapterConfig.connectors
    if (connRows.length === 0) {
      const legacyConn = (adapterConfig?.connectors as Record<string, boolean>) || {};
      Object.assign(connectors, legacyConn);
    }

    // 6. Import TOOLS and filterToolsForAgent from chat.ts
    const { getTools, getToolConnector, filterToolsForAgent } = await import("../routes/chat.js");
    const agentTools = filterToolsForAgent(agent.role || "general", connectors);

    // 7. Call Claude API with multi-turn tool loop
    const messages: Array<{ role: string; content: unknown }> = [
      { role: "user", content: routine.description || routine.title || "Esegui l'attività programmata." },
    ];

    let result = "";
    const MAX_TURNS = 5;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: (adapterConfig?.model as string) || "claude-haiku-4-5-20251001",
          max_tokens: 4096,
          system: systemPrompt,
          messages,
          tools: agentTools,
        }),
      });

      if (!claudeRes.ok) {
        const errText = await claudeRes.text();
        await db.update(routineRuns).set({ status: "failed", failureReason: "Claude API error: " + errText.slice(0, 500) }).where(eq(routineRuns.id, runId));
        return;
      }

      const data = await claudeRes.json() as {
        content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
        stop_reason?: string;
      };

      // Collect text
      for (const block of data.content || []) {
        if (block.type === "text" && block.text) result += block.text;
      }

      // Check for tool use
      const toolBlocks = (data.content || []).filter(b => b.type === "tool_use");
      if (toolBlocks.length === 0 || data.stop_reason === "end_turn") break;

      // Execute tools (reuse executeChatTool from chat.ts)
      const { executeChatTool } = await import("../routes/chat.js");
      const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = [];

      for (const toolBlock of toolBlocks) {
        const toolResult = await executeChatTool(
          db,
          toolBlock.name!,
          toolBlock.input,
          routine.companyId,
          agent.id,
          apiKey,
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolBlock.id!,
          content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
        });
      }

      messages.push({ role: "assistant", content: data.content });
      messages.push({ role: "user", content: toolResults });
    }

    // 8. Save result
    const finalStatus = approvalRequired ? "pending_approval" : "completed";
    await db.update(routineRuns).set({
      status: finalStatus,
      triggerPayload: { result, approval_required: approvalRequired },
      completedAt: approvalRequired ? null : new Date(),
    }).where(eq(routineRuns.id, runId));

    console.log(`[routine-executor] run ${runId} finished with status ${finalStatus}`);
  }

  return { executeRun };
}
```

- [ ] **Step 2: Esportare funzioni necessarie da chat.ts**

In `server/src/routes/chat.ts`, aggiungere export delle funzioni necessarie:

```typescript
// Aggiungere DOPO la definizione di filterToolsForAgent (circa riga 641):
export { TOOLS as getTools, TOOL_CONNECTOR as getToolConnector, filterToolsForAgent };
```

E aggiungere export per `executeChatTool`:

```typescript
// Aggiungere PRIMA del return router (fine file):
export { executeChatTool };
```

**NOTA:** La funzione `executeChatTool` attualmente è definita dentro `chatRoutes()` e ha accesso a `db` via closure. Bisogna estrarre le parti che servono al routine-executor come funzioni standalone che accettano `db` come parametro. Questo significa:
- Esportare `TOOLS`, `TOOL_CONNECTOR`, `filterToolsForAgent` direttamente (sono già fuori dalla closure)
- Per `executeChatTool`: creare una versione standalone che accetta `db` come primo parametro

In pratica, `executeChatTool` è già definita come `async function executeChatTool(db, toolName, toolInput, companyId, agentId, apiKey)` dentro chatRoutes — estrarre fuori dalla closure.

- [ ] **Step 3: Verificare compilazione**

Run: `cd server && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add server/src/services/routine-executor.ts server/src/routes/chat.ts
git commit -m "feat: RoutineExecutor — esegue routine via Claude API con tool loop e modalità bozza"
```

---

### Task 3: Tool CEO — crea/lista/elimina attività programmate

**Files:**
- Modify: `server/src/routes/chat.ts`

- [ ] **Step 1: Aggiungere i 3 tool alla TOOLS array**

Aggiungere dopo l'ultimo tool in TOOLS (prima della chiusura `]`):

```typescript
  {
    name: "crea_attivita_programmata",
    description: "Crea un'attività programmata (cron) per un agente. L'agente eseguirà automaticamente il task all'orario specificato.",
    input_schema: {
      type: "object" as const,
      properties: {
        agente_id: { type: "string", description: "ID dell'agente che esegue l'attività" },
        titolo: { type: "string", description: "Nome breve dell'attività (es: Post Instagram giornaliero)" },
        descrizione: { type: "string", description: "Istruzioni dettagliate per l'agente su cosa fare" },
        orario: { type: "string", description: "Quando eseguire, in italiano (es: ogni giorno alle 12, ogni lunedi alle 9, ogni ora)" },
        approvazione: { type: "boolean", description: "true = richiede approvazione prima di eseguire, false = esegue automaticamente" },
      },
      required: ["agente_id", "titolo", "descrizione", "orario"] as string[],
    },
  },
  {
    name: "lista_attivita_programmate",
    description: "Elenca tutte le attività programmate della company con stato, prossima esecuzione e agente assegnato.",
    input_schema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "elimina_attivita_programmata",
    description: "Archivia un'attività programmata (non la eseguirà più).",
    input_schema: {
      type: "object" as const,
      properties: {
        routine_id: { type: "string", description: "ID dell'attività da eliminare" },
      },
      required: ["routine_id"] as string[],
    },
  },
```

- [ ] **Step 2: Aggiungere i tool a TOOL_CONNECTOR**

```typescript
  // Attività programmate (no connector required)
  crea_attivita_programmata: null,
  lista_attivita_programmate: null,
  elimina_attivita_programmata: null,
```

- [ ] **Step 3: Aggiungere import routines/routineTriggers in chat.ts**

All'inizio di chat.ts, aggiungere agli import:

```typescript
import { companySecrets, agents, companyMemberships, companies, issues, connectorAccounts, agentConnectorAccounts, routines, routineTriggers, routineRuns } from "@goitalia/db";
```

- [ ] **Step 4: Implementare i case nel switch executeChatTool**

Aggiungere nel switch di `executeChatTool`, dopo il case `"crea_agente"`:

```typescript
      case "crea_attivita_programmata": {
        const input = toolInput as { agente_id: string; titolo: string; descrizione: string; orario: string; approvazione?: boolean };

        // Verify agent exists
        const targetAgent = await db.select({ id: agents.id, name: agents.name }).from(agents)
          .where(and(eq(agents.id, input.agente_id), eq(agents.companyId, companyId), ne(agents.status, "terminated")))
          .then(r => r[0]);
        if (!targetAgent) return "Errore: agente non trovato con ID " + input.agente_id;

        // Convert natural language to cron expression
        const cronMap: Record<string, string> = {
          "ogni minuto": "* * * * *",
          "ogni ora": "0 * * * *",
          "ogni giorno": "0 9 * * *",
          "ogni lunedi": "0 9 * * 1",
          "ogni martedi": "0 9 * * 2",
          "ogni mercoledi": "0 9 * * 3",
          "ogni giovedi": "0 9 * * 4",
          "ogni venerdi": "0 9 * * 5",
          "ogni sabato": "0 9 * * 6",
          "ogni domenica": "0 9 * * 0",
          "dal lunedi al venerdi": "0 9 * * 1-5",
          "il primo del mese": "0 9 1 * *",
        };

        let cronExpr = "";
        const orarioLower = input.orario.toLowerCase().trim();

        // Try exact match first
        for (const [pattern, cron] of Object.entries(cronMap)) {
          if (orarioLower.startsWith(pattern)) {
            cronExpr = cron;
            break;
          }
        }

        // Parse time from "alle HH:MM" or "alle HH"
        const timeMatch = orarioLower.match(/alle?\s+(\d{1,2})(?::(\d{2}))?/);
        if (timeMatch) {
          const hour = parseInt(timeMatch[1]);
          const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
          if (cronExpr) {
            // Replace hour/minute in existing cron
            const parts = cronExpr.split(" ");
            parts[0] = String(minute);
            parts[1] = String(hour);
            cronExpr = parts.join(" ");
          } else {
            cronExpr = `${minute} ${hour} * * *`; // default: daily
          }
        }

        // Parse "ogni N minuti/ore"
        const intervalMatch = orarioLower.match(/ogni\s+(\d+)\s+(minut|or)/);
        if (intervalMatch) {
          const n = parseInt(intervalMatch[1]);
          if (intervalMatch[2].startsWith("minut")) {
            cronExpr = `*/${n} * * * *`;
          } else {
            cronExpr = `0 */${n} * * *`;
          }
        }

        if (!cronExpr) cronExpr = "0 9 * * *"; // fallback: ogni giorno alle 9

        // Create routine
        const routineId = randomUUID();
        await db.insert(routines).values({
          id: routineId,
          companyId,
          title: input.titolo,
          description: input.descrizione,
          assigneeAgentId: input.agente_id,
          status: "active",
          concurrencyPolicy: "skip_if_active",
          catchUpPolicy: "skip_missed",
          createdByAgentId: agentId,
          metadata: { approval_required: input.approvazione !== false },
        } as any);

        // Create cron trigger
        const { parseCron, nextCronTick } = await import("../services/cron.js");
        const parsed = parseCron(cronExpr);
        const nextRun = nextCronTick(parsed, new Date());
        const triggerId = randomUUID();
        await db.insert(routineTriggers).values({
          id: triggerId,
          companyId,
          routineId,
          kind: "cron",
          label: input.titolo,
          enabled: true,
          cronExpression: cronExpr,
          timezone: "Europe/Rome",
          nextRunAt: nextRun,
          createdByAgentId: agentId,
        } as any);

        const approvalStr = input.approvazione !== false ? "con approvazione (ti chiederò conferma prima di eseguire)" : "automatica (eseguirà senza conferma)";
        return `Attività programmata creata: "${input.titolo}" — Agente: ${targetAgent.name} — Orario: ${cronExpr} (${input.orario}) — Modalità: ${approvalStr} — Prossima esecuzione: ${nextRun?.toLocaleString("it-IT", { timeZone: "Europe/Rome" }) || "calcolando..."}`;
      }

      case "lista_attivita_programmate": {
        const allRoutines = await db.select({
          id: routines.id,
          title: routines.title,
          status: routines.status,
          agentName: agents.name,
        }).from(routines)
          .leftJoin(agents, eq(routines.assigneeAgentId, agents.id))
          .where(and(eq(routines.companyId, companyId), ne(routines.status, "archived")));

        if (allRoutines.length === 0) return "Nessuna attività programmata trovata.";

        // Get triggers for next run info
        let result = "Attività programmate:\n";
        for (const r of allRoutines) {
          const trigger = await db.select({ cronExpression: routineTriggers.cronExpression, nextRunAt: routineTriggers.nextRunAt, enabled: routineTriggers.enabled })
            .from(routineTriggers)
            .where(and(eq(routineTriggers.routineId, r.id), eq(routineTriggers.kind, "cron")))
            .then(rows => rows[0]);
          const nextRun = trigger?.nextRunAt ? new Date(trigger.nextRunAt).toLocaleString("it-IT", { timeZone: "Europe/Rome" }) : "N/A";
          const stato = trigger?.enabled === false ? "pausata" : r.status;
          result += `- [${r.id.slice(0, 8)}] "${r.title}" — Agente: ${r.agentName || "N/A"} — Stato: ${stato} — Cron: ${trigger?.cronExpression || "N/A"} — Prossima: ${nextRun}\n`;
        }
        return result;
      }

      case "elimina_attivita_programmata": {
        const input = toolInput as { routine_id: string };
        const routine = await db.select({ id: routines.id, title: routines.title })
          .from(routines)
          .where(and(eq(routines.id, input.routine_id), eq(routines.companyId, companyId)))
          .then(r => r[0]);
        if (!routine) return "Errore: attività programmata non trovata con ID " + input.routine_id;

        await db.update(routines).set({ status: "archived" }).where(eq(routines.id, input.routine_id));
        // Disable all triggers
        await db.update(routineTriggers).set({ enabled: false }).where(eq(routineTriggers.routineId, input.routine_id));
        return `Attività programmata "${routine.title}" archiviata e disattivata.`;
      }
```

- [ ] **Step 5: Aggiornare CEO_PROMPT_BASE per menzionare attività programmate**

Nella sezione `## ORCHESTRAZIONE` del CEO_PROMPT_BASE, aggiungere:

```
## ATTIVITÀ PROGRAMMATE
Puoi creare attività che vengono eseguite automaticamente a orari predefiniti.
- Usa crea_attivita_programmata per schedulare azioni ricorrenti
- Esempi: "pubblica un post su IG ogni giorno alle 12", "manda report vendite ogni lunedì"
- Modalità con approvazione: l'agente prepara il contenuto, il cliente approva prima dell'esecuzione
- Modalità automatica: l'agente esegue senza conferma
- Usa lista_attivita_programmate per vedere le attività attive
- Usa elimina_attivita_programmata per rimuovere un'attività
```

- [ ] **Step 6: Verificare compilazione**

Run: `cd server && npx tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/chat.ts
git commit -m "feat: tool CEO — crea/lista/elimina attività programmate con parsing orario naturale"
```

---

### Task 4: Wiring — Avvio Scheduler + Endpoint Approvazione

**Files:**
- Modify: `server/src/app.ts`

- [ ] **Step 1: Importare e avviare lo scheduler in app.ts**

Aggiungere import:

```typescript
import { createRoutineScheduler } from "./services/routine-scheduler.js";
import { createRoutineExecutor } from "./services/routine-executor.js";
```

Dopo l'avvio del `pluginJobScheduler` (circa riga 514 `scheduler.start()`), aggiungere:

```typescript
  // Start routine scheduler for cron-based activities
  const routineExecutor = createRoutineExecutor(db);
  const routineScheduler = createRoutineScheduler(db, routineExecutor.executeRun);
  routineScheduler.start();
```

- [ ] **Step 2: Aggiungere endpoint approvazione**

Dopo gli endpoint esistenti nell'`api` router:

```typescript
  // Approve/reject routine run
  api.post("/routines/:routineId/runs/:runId/approve", async (req, res) => {
    const { routineId, runId } = req.params;
    const { modifiedContent } = req.body as { modifiedContent?: string };

    const run = await db.select().from(routineRuns)
      .where(and(eq(routineRuns.id, runId), eq(routineRuns.routineId, routineId)))
      .then(r => r[0]);

    if (!run) { res.status(404).json({ error: "Run non trovata" }); return; }
    if (run.status !== "pending_approval") { res.status(400).json({ error: "Run non in attesa di approvazione" }); return; }

    // If modified content, update the payload
    const payload = (run.triggerPayload as Record<string, unknown>) || {};
    if (modifiedContent) payload.result = modifiedContent;
    payload.approved = true;
    payload.approved_at = new Date().toISOString();

    // Re-execute with approval (the agent will now execute the final action)
    const routine = await db.select().from(routines).where(eq(routines.id, routineId)).then(r => r[0]);
    if (!routine) { res.status(404).json({ error: "Routine non trovata" }); return; }

    // Update run status to running, then execute
    await db.update(routineRuns).set({ status: "received", triggerPayload: payload }).where(eq(routineRuns.id, runId));

    // Execute the approved content
    const routineExecutor = createRoutineExecutor(db);
    routineExecutor.executeRun(runId, routineId).catch((err) => {
      console.error("[approve] execution error:", err);
    });

    res.json({ ok: true, status: "executing" });
  });

  api.post("/routines/:routineId/runs/:runId/reject", async (req, res) => {
    const { runId } = req.params;
    await db.update(routineRuns).set({
      status: "failed",
      failureReason: "Rifiutata dall'utente",
      completedAt: new Date(),
    }).where(eq(routineRuns.id, runId));
    res.json({ ok: true });
  });

  // Get pending approval runs for a company
  api.get("/routines/pending", async (req, res) => {
    const companyId = req.query.companyId as string;
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    const pending = await db.select({
      runId: routineRuns.id,
      routineId: routineRuns.routineId,
      routineTitle: routines.title,
      agentName: agents.name,
      result: routineRuns.triggerPayload,
      triggeredAt: routineRuns.triggeredAt,
    }).from(routineRuns)
      .innerJoin(routines, eq(routineRuns.routineId, routines.id))
      .leftJoin(agents, eq(routines.assigneeAgentId, agents.id))
      .where(and(eq(routineRuns.companyId, companyId), eq(routineRuns.status, "pending_approval")));
    res.json(pending);
  });
```

- [ ] **Step 3: Aggiungere import routineRuns + routines + agents in app.ts**

Verificare che `routineRuns`, `routines`, `agents` siano già importati (gli import esistenti dovrebbero coprirli).

- [ ] **Step 4: Verificare compilazione**

Run: `cd server && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts
git commit -m "feat: avvio RoutineScheduler + endpoint approvazione/rifiuto/pending bozze"
```

---

### Task 5: Frontend — Sidebar + Route + Pagina Lista

**Files:**
- Modify: `ui/src/components/Sidebar.tsx`
- Modify: `ui/src/App.tsx`
- Modify: `ui/src/pages/Routines.tsx`

- [ ] **Step 1: Aggiungere voce sidebar "Attività Programmate"**

In `Sidebar.tsx`, trovare la voce "Connettori" (`<SidebarNavItem to="/plugins" label="Connettori"`) e aggiungere PRIMA:

```tsx
<SidebarNavItem to="/scheduled" label="Attività" icon={CalendarClockIcon} badge={pendingCount > 0 ? pendingCount : undefined} />
```

Aggiungere import `CalendarClockIcon` da `lucide-react` e stato `pendingCount`:

```tsx
import { CalendarClock as CalendarClockIcon } from "lucide-react";

// Nel useEffect checkConnectors, aggiungere fetch pending count:
const [pendingCount, setPendingCount] = useState(0);

// Nel useEffect:
fetch("/api/routines/pending?companyId=" + selectedCompanyId, { credentials: "include" })
  .then((r) => r.json())
  .then((d) => setPendingCount(Array.isArray(d) ? d.length : 0))
  .catch(() => {});
```

- [ ] **Step 2: Aggiungere route in App.tsx**

Trovare le route nel router e aggiungere:

```tsx
<Route path="scheduled" element={<Routines />} />
```

Verificare che l'import di `Routines` esista già (dovrebbe essere in `ui/src/pages/Routines.tsx`).

- [ ] **Step 3: Adattare Routines.tsx allo stile GoItalIA**

Il file esiste già con il layout Paperclip. Le modifiche principali:
- Tradurre label in italiano
- Stile glass card
- Aggiungere tab "Da approvare" che mostra i run con `status = "pending_approval"`
- Badge contatore bozze pending

Queste sono modifiche di stile/UI che vanno fatte leggendo il file corrente e adattando. Non riscrivo l'intero componente — il task è di adattare lo stile seguendo il pattern delle altre pagine GoItalIA (glass-card, colori, font).

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/Sidebar.tsx ui/src/App.tsx ui/src/pages/Routines.tsx
git commit -m "feat: sidebar Attività Programmate + route + pagina lista con tab Da Approvare"
```

---

### Task 6: Auto-Reply Toggle su Agenti

**Files:**
- Modify: `ui/src/pages/AgentDetail.tsx`
- Modify: `server/src/routes/whatsapp.ts`
- Modify: `server/src/routes/telegram.ts`

- [ ] **Step 1: Aggiungere toggle auto-reply nella tab Connettori di AgentDetail.tsx**

Nel componente `AgentConnectorsTab`, aggiungere un toggle "Risposta automatica" in cima alla sezione, visibile solo se l'agente ha connettori conversazionali (WhatsApp, Telegram, Meta, Gmail):

```tsx
// Stato
const autoReply = (agent.adapterConfig as any)?.autoReply === true;
const [autoReplyDraft, setAutoReplyDraft] = useState(autoReply);

// Toggle handler
const toggleAutoReply = async () => {
  const newVal = !autoReplyDraft;
  setAutoReplyDraft(newVal);
  const res = await fetch("/api/agents/" + agentId + "?companyId=" + companyId, { credentials: "include" });
  if (res.ok) {
    const a = await res.json();
    const config = a.adapterConfig || {};
    config.autoReply = newVal;
    await fetch("/api/agents/" + agentId + "?companyId=" + companyId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ adapterConfig: config }),
    });
  }
};

// UI — in cima alla sezione connettori
<div className="flex items-center justify-between px-3 py-3 rounded-xl mb-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
  <div>
    <div className="text-sm font-medium">Risposta automatica</div>
    <div className="text-[10px] text-muted-foreground">L'agente risponde automaticamente ai messaggi in arrivo</div>
  </div>
  {nativeToggle(autoReplyDraft, toggleAutoReply)}
</div>
```

- [ ] **Step 2: Implementare auto-reply in whatsapp.ts**

Nel webhook handler di WhatsApp (`/wa-hook/`), dopo aver salvato il messaggio in arrivo, aggiungere:

```typescript
// Check auto-reply
const agentLink = await db.select({ agentId: agentConnectorAccounts.agentId })
  .from(agentConnectorAccounts)
  .innerJoin(connectorAccounts, eq(agentConnectorAccounts.connectorAccountId, connectorAccounts.id))
  .where(and(
    eq(connectorAccounts.companyId, companyId),
    eq(connectorAccounts.connectorType, "whatsapp"),
    eq(connectorAccounts.accountId, phoneNumber),
  ))
  .then(r => r[0]);

if (agentLink) {
  const agent = await db.select().from(agents).where(eq(agents.id, agentLink.agentId)).then(r => r[0]);
  if (agent && (agent.adapterConfig as any)?.autoReply === true) {
    // Get API key and execute auto-reply
    const secret = await db.select().from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "claude_api_key")))
      .then(r => r[0]);
    if (secret?.description) {
      const apiKey = decrypt(secret.description);
      const adapterConfig = agent.adapterConfig as Record<string, unknown>;
      const prompt = (adapterConfig?.promptTemplate as string) || `Sei ${agent.name}. Rispondi in italiano.`;
      // Call Claude API
      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: (adapterConfig?.model as string) || "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: prompt,
          messages: [{ role: "user", content: incomingMessage }],
        }),
      });
      if (claudeRes.ok) {
        const data = await claudeRes.json() as { content?: Array<{ text?: string }> };
        const reply = data.content?.find(b => b.text)?.text;
        if (reply) {
          // Send reply via WaSender API
          // (use existing send message logic in whatsapp.ts)
        }
      }
    }
  }
}
```

- [ ] **Step 3: Implementare auto-reply in telegram.ts**

Stessa logica del WhatsApp ma per Telegram:

```typescript
// Nel webhook handler /tg-hook/:botUsername
// Dopo aver salvato il messaggio, check auto-reply
const agentLink = await db.select({ agentId: agentConnectorAccounts.agentId })
  .from(agentConnectorAccounts)
  .innerJoin(connectorAccounts, eq(agentConnectorAccounts.connectorAccountId, connectorAccounts.id))
  .where(and(
    eq(connectorAccounts.companyId, companyId),
    eq(connectorAccounts.connectorType, "telegram"),
    eq(connectorAccounts.accountId, botUsername),
  ))
  .then(r => r[0]);

if (agentLink) {
  const agent = await db.select().from(agents).where(eq(agents.id, agentLink.agentId)).then(r => r[0]);
  if (agent && (agent.adapterConfig as any)?.autoReply === true) {
    // Same pattern: get API key, call Claude, send reply via Telegram API
  }
}
```

- [ ] **Step 4: Verificare compilazione**

Run: `cd server && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add ui/src/pages/AgentDetail.tsx server/src/routes/whatsapp.ts server/src/routes/telegram.ts
git commit -m "feat: toggle auto-reply per agenti conversazionali — WhatsApp e Telegram"
```

---

### Task 7: Build, Deploy e Test

**Files:**
- Nessun file nuovo

- [ ] **Step 1: Build e push**

```bash
cd /Users/emanuelemaccari/impresa-goitalia
git push origin master
```

- [ ] **Step 2: Deploy su VPS**

```bash
ssh root@89.167.3.74 "cd /var/www/impresa-goitalia && git pull origin master && npm run build && cp ui/public/sw.js ui/dist/sw.js && pm2 restart goitalia-impresa"
```

- [ ] **Step 3: Test funzionale**

1. Vai su impresa.goitalia.eu
2. Verifica che "Attività" appare nella sidebar
3. Chatta col CEO: "Crea un'attività programmata per l'agente @energizzo.it: pubblica un post su Instagram ogni giorno alle 12 con approvazione"
4. Verifica che la routine viene creata
5. Nella sezione Attività Programmate, verifica che appare
6. Su un agente WhatsApp/Telegram, verifica il toggle auto-reply

- [ ] **Step 4: Commit finale e tag**

```bash
git tag v2-scheduled-activities
git push origin v2-scheduled-activities
```

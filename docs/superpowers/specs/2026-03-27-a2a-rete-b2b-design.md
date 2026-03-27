# A2A — Rete B2B tra CEO AI

## Summary

Rete B2B intra-piattaforma per GoItalIA Impresa. I CEO AI delle PMI comunicano direttamente via DB condiviso (no protocollo Google A2A esterno). Le PMI si trovano nella directory, si collegano, e i CEO si scambiano task (ordini, preventivi, messaggi).

Include anche: onboarding semplificato via PIVA (OpenAPI.it a spese UNVRS, 1 domanda invece di 9).

## Decisioni

| Decisione | Scelta |
|-----------|--------|
| Comunicazione | DB condiviso, no HTTP inter-server |
| CEO risposta | Ibrido: auto per info/prezzi/preventivi, approvazione umana per ordini/pagamenti |
| Visibilità directory | Opt-in (hidden di default) |
| Categorie | Codice ATECO reale da OpenAPI.it (non lista inventata) |
| Onboarding | Solo PIVA → OpenAPI.it (API UNVRS) → auto-compila dati |
| Connessioni | Bidirezionali con label per lato (rubrica partner) |
| Verifica identità | TODO futuro (PEC/visura), per ora ci fidiamo |

## Architettura

### Database — 4 tabelle nuove

**`a2a_profiles`** — profilo pubblico PMI nella directory
- company_id (FK, UNIQUE), slug, vat_number, legal_name
- ateco_code, ateco_description (da OpenAPI.it)
- address, zone, description, risk_score
- tags (JSONB), services (JSONB)
- visibility ('public' | 'hidden', default 'hidden')

**`a2a_connections`** — connessioni tra company (2 record per connessione bidirezionale)
- from_company_id, to_company_id (FK)
- status ('pending' | 'active' | 'blocked')
- relationship_label ("Fornitore vini", "Cliente")
- notes

**`a2a_tasks`** — unità di lavoro tra CEO
- from_company_id, to_company_id (FK)
- type ('message' | 'quote' | 'order' | 'service')
- title, description, status, requires_approval
- metadata (JSONB)

**`a2a_messages`** — messaggi dentro un task
- task_id (FK), from_company_id
- role ('ceo' | 'human'), content, attachments (JSONB)

### API — `server/src/routes/a2a.ts`

```
# Profilo
GET/POST /api/a2a/profile
DELETE   /api/a2a/profile

# Directory
GET /api/a2a/directory?q=&zone=&ateco=

# Connessioni
GET/POST   /api/a2a/connections
PUT/DELETE /api/a2a/connections/:id

# Task + Messaggi
GET/POST /api/a2a/tasks
GET/PUT  /api/a2a/tasks/:id
POST     /api/a2a/tasks/:id/messages

# Badge
GET /api/a2a/unread-count
```

### Tool CEO — 7 nuovi tool

| Tool | Scopo |
|------|-------|
| `cerca_azienda_a2a` | Cerca nella directory per nome/ATECO/tag/zona |
| `lista_partner_a2a` | Rubrica partner (connessioni attive con label) |
| `invia_task_a2a` | Crea e invia task a company collegata |
| `rispondi_task_a2a` | Rispondi a task ricevuto |
| `lista_task_a2a` | Lista task in/out con filtri |
| `aggiorna_stato_task_a2a` | Cambia stato task |
| `messaggio_a2a` | Messaggio in task esistente |

Tool disponibili solo se company ha profilo A2A. Logica in `server/src/services/a2a-tools.ts` (separato da chat.ts).

### CEO ibrido — auto vs approvazione

**Auto-risposta**: info, listini, prezzi, preventivi, messaggi generici.
**Approvazione umana**: conferma ordini, pagamenti, impegni economici/contrattuali.

Implementato via: campo `requires_approval` su task + classificazione nel CEO prompt.

### UI — pagina `/a2a` "Rete B2B"

3 tab:
1. **Directory** — cerca aziende, profili, richiesta connessione
2. **Connessioni** — rubrica partner, richieste pending
3. **Task** — lista task in/out, dettaglio con messaggi

Sidebar: link "Rete B2B" in sezione LAVORO + badge pending.

### Notifiche real-time

Via WebSocket esistente (`server/src/realtime/`):
- Nuova richiesta connessione
- Nuovo task / messaggio
- Cambio stato task

### Onboarding semplificato

Flusso step 2 (Chat CEO):
1. CEO chiede solo PIVA
2. Chiamata OpenAPI.it con API key UNVRS (env var server, non secret company)
3. Torna: ragione sociale, ATECO, indirizzo, oggetto sociale
4. CEO conferma col titolare → salva in memoria
5. Fallback: se API down → domande classiche

Tool: `cerca_piva_onboarding` (usa API UNVRS, non della PMI).

## Fasi implementazione

### Fase 1 — Foundation: DB + Profili + Connessioni + Onboarding PIVA
Le PMI possono creare profilo, cercarsi, collegarsi. Onboarding chiede solo PIVA.

### Fase 2 — Comunicazione: Task + Messaggi + Tool CEO
I CEO si scambiano task e messaggi. Auto-risposta ibrida.

### Fase 3 — Polish: Background processing + Template + Integrazioni
CEO processa task in background. Template predefiniti. Integrazione FIC per fatture auto.

## File

### Nuovi
- `packages/db/src/schema/a2a_profiles.ts`
- `packages/db/src/schema/a2a_connections.ts`
- `packages/db/src/schema/a2a_tasks.ts`
- `packages/db/src/schema/a2a_messages.ts`
- `packages/db/src/migrations/0048_a2a_network.sql`
- `packages/db/src/migrations/0049_a2a_tasks.sql`
- `server/src/routes/a2a.ts`
- `server/src/services/a2a-tools.ts`
- `ui/src/pages/A2ANetwork.tsx`

### Da modificare
- `packages/db/src/schema/index.ts` — export tabelle
- `server/src/app.ts` — registrare routes
- `server/src/routes/chat.ts` — importare tool + TOOLS/TOOL_CONNECTOR
- `ui/src/App.tsx` — route /a2a
- `ui/src/components/Sidebar.tsx` — link + badge

## Sicurezza

- Solo company con connessione `active` possono scambiarsi task
- Rate limiting: max 100 task/giorno per connessione
- Visibilità opt-in (hidden default)
- Audit: ogni task/messaggio tracciato
- Verifica identità PIVA: TODO futuro

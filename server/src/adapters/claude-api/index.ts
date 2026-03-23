import type { ServerAdapterModule } from "../types.js";
import { execute } from "./execute.js";

export const claudeApiAdapter: ServerAdapterModule = {
  type: "claude_api",
  execute,
  models: [
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { id: "claude-opus-4-20250514", label: "Claude Opus 4" },
    { id: "claude-haiku-4-20250414", label: "Claude Haiku 4" },
  ],
  agentConfigurationDoc: `# Claude API Adapter

Adapter: claude_api

Chiama direttamente l'API Anthropic Messages. La API key viene dalla configurazione della company.

Campi opzionali:
- model (string): modello Claude da usare (default: claude-sonnet-4-20250514)
`,
};

import { useState, useEffect } from "react";
import { useCompany } from "../context/CompanyContext";
import { Brain, CheckCircle, AlertCircle, Loader2, ExternalLink } from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";

const POPULAR_MODELS = [
  { id: "nvidia/nemotron-3-nano-30b-a3b", label: "Nemotron 3 Nano 30B", provider: "NVIDIA", badge: "Consigliato" },
  { id: "nvidia/nemotron-3-nano-30b-a3b:free", label: "Nemotron 3 Nano 30B (Free)", provider: "NVIDIA", badge: "Gratuito" },
  { id: "nvidia/nemotron-nano-9b-v2", label: "Nemotron Nano 9B v2", provider: "NVIDIA", badge: "" },
  { id: "google/gemini-2.5-flash-preview", label: "Gemini 2.5 Flash Preview", provider: "Google", badge: "" },
  { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash", provider: "Google", badge: "" },
  { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4", provider: "Anthropic", badge: "" },
  { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", provider: "Meta", badge: "" },
  { id: "openai/gpt-4o", label: "GPT-4o", provider: "OpenAI", badge: "" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o Mini", provider: "OpenAI", badge: "Economico" },
  { id: "deepseek/deepseek-chat-v3-0324", label: "DeepSeek Chat V3", provider: "DeepSeek", badge: "" },
  { id: "mistralai/mistral-large-2411", label: "Mistral Large", provider: "Mistral", badge: "" },
];

export default function ModelsPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState<"claude" | "openrouter">("claude");
  const [model, setModel] = useState("nvidia/nemotron-3-nano-30b-a3b");
  const [customModel, setCustomModel] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [hasClaudeKey, setHasClaudeKey] = useState(false);
  const [hasOpenRouterKey, setHasOpenRouterKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Modelli AI" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    if (!selectedCompany?.id) return;
    setLoading(true);
    fetch("/api/llm/config?companyId=" + selectedCompany.id, { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        setProvider(d.provider || "claude");
        setModel(d.model || "nvidia/nemotron-3-nano-30b-a3b");
        setHasClaudeKey(d.hasClaudeKey || false);
        setHasOpenRouterKey(d.hasOpenRouterKey || false);
        if (d.model && !POPULAR_MODELS.find(m => m.id === d.model)) {
          setCustomModel(d.model);
        }
      })
      .catch(() => setError("Errore caricamento configurazione"))
      .finally(() => setLoading(false));
  }, [selectedCompany?.id]);

  const handleSave = async () => {
    if (!selectedCompany?.id) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    const selectedModel = customModel.trim() || model;

    try {
      const body: Record<string, string> = {
        companyId: selectedCompany.id,
        provider,
        model: selectedModel,
      };
      if (openrouterKey.trim()) body.openrouterApiKey = openrouterKey.trim();

      const r = await fetch("/api/llm/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (!r.ok) {
        const errData = await r.json().catch(() => ({}));
        throw new Error(errData.error || "Errore salvataggio");
      }

      setSaved(true);
      setOpenrouterKey("");
      if (openrouterKey.trim()) setHasOpenRouterKey(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>
          <Brain className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Modelli AI</h1>
          <p className="text-sm text-muted-foreground">Scegli il provider e il modello per il tuo CEO AI</p>
        </div>
      </div>

      {/* Provider Selection */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Provider</label>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setProvider("claude")}
            className="relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all"
            style={{
              borderColor: provider === "claude" ? "#6366f1" : "hsl(220 13% 20%)",
              background: provider === "claude" ? "hsl(220 13% 14%)" : "hsl(220 13% 11%)",
            }}
          >
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #d97706, #f59e0b)" }}>
              <span className="text-white font-bold text-sm">A</span>
            </div>
            <span className="text-sm font-medium">Claude (Anthropic)</span>
            {hasClaudeKey && <span className="text-[10px] text-emerald-400 flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Configurato</span>}
            {provider === "claude" && <div className="absolute top-2 right-2 w-3 h-3 rounded-full bg-indigo-500" />}
          </button>

          <button
            onClick={() => setProvider("openrouter")}
            className="relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all"
            style={{
              borderColor: provider === "openrouter" ? "#6366f1" : "hsl(220 13% 20%)",
              background: provider === "openrouter" ? "hsl(220 13% 14%)" : "hsl(220 13% 11%)",
            }}
          >
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #06b6d4, #22d3ee)" }}>
              <span className="text-white font-bold text-sm">OR</span>
            </div>
            <span className="text-sm font-medium">OpenRouter</span>
            {hasOpenRouterKey && <span className="text-[10px] text-emerald-400 flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Configurato</span>}
            {provider === "openrouter" && <div className="absolute top-2 right-2 w-3 h-3 rounded-full bg-indigo-500" />}
          </button>
        </div>
      </div>

      {/* OpenRouter API Key */}
      {provider === "openrouter" && (
        <div className="space-y-3 p-4 rounded-xl border" style={{ borderColor: "hsl(220 13% 20%)", background: "hsl(220 13% 11%)" }}>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">API Key OpenRouter</label>
            <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
              Ottieni key <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {hasOpenRouterKey && !openrouterKey && (
            <div className="flex items-center gap-2 text-xs text-emerald-400">
              <CheckCircle className="h-3 w-3" />
              API key salvata. Inserisci una nuova key solo se vuoi cambiarla.
            </div>
          )}
          <input
            type="password"
            placeholder={hasOpenRouterKey ? "••••••••••••••• (salvata)" : "sk-or-..."}
            value={openrouterKey}
            onChange={e => setOpenrouterKey(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm border"
            style={{ background: "hsl(220 13% 8%)", borderColor: "hsl(220 13% 20%)", color: "white" }}
          />
        </div>
      )}

      {/* Model Selection (only for OpenRouter) */}
      {provider === "openrouter" && (
        <div className="space-y-3">
          <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Modello</label>
          <div className="space-y-2">
            {POPULAR_MODELS.map(m => (
              <button
                key={m.id}
                onClick={() => { setModel(m.id); setCustomModel(""); }}
                className="w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all text-left"
                style={{
                  borderColor: model === m.id && !customModel ? "#6366f1" : "hsl(220 13% 20%)",
                  background: model === m.id && !customModel ? "hsl(220 13% 14%)" : "hsl(220 13% 11%)",
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full" style={{ background: model === m.id && !customModel ? "#6366f1" : "hsl(220 13% 25%)" }} />
                  <div>
                    <div className="text-sm font-medium">{m.label}</div>
                    <div className="text-xs text-muted-foreground">{m.provider}</div>
                  </div>
                </div>
                {m.badge && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                    style={{
                      background: m.badge === "Consigliato" ? "hsl(158 64% 52% / 0.15)" : m.badge === "Gratuito" ? "hsl(210 100% 52% / 0.15)" : "hsl(45 100% 52% / 0.15)",
                      color: m.badge === "Consigliato" ? "hsl(158 64% 52%)" : m.badge === "Gratuito" ? "hsl(210 100% 52%)" : "hsl(45 100% 52%)",
                    }}>
                    {m.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Custom model ID */}
          <div className="mt-3">
            <label className="text-xs text-muted-foreground">Oppure inserisci un model ID personalizzato:</label>
            <input
              type="text"
              placeholder="es. nvidia/nemotron-3-nano-30b-a3b:free"
              value={customModel}
              onChange={e => setCustomModel(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg text-sm border"
              style={{ background: "hsl(220 13% 8%)", borderColor: "hsl(220 13% 20%)", color: "white" }}
            />
          </div>
        </div>
      )}

      {/* Claude info */}
      {provider === "claude" && (
        <div className="p-4 rounded-xl border" style={{ borderColor: "hsl(220 13% 20%)", background: "hsl(220 13% 11%)" }}>
          <p className="text-sm text-muted-foreground">
            Con il provider Claude, viene utilizzata la API key Anthropic configurata nella sezione <strong>API Claude</strong>.
            Il modello di default è <code className="text-xs bg-white/10 px-1.5 py-0.5 rounded">claude-sonnet-4-6</code>.
          </p>
        </div>
      )}

      {/* Error & Success */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg text-sm" style={{ background: "hsl(0 72% 51% / 0.1)", color: "hsl(0 72% 70%)" }}>
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {saved && (
        <div className="flex items-center gap-2 p-3 rounded-lg text-sm" style={{ background: "hsl(158 64% 52% / 0.1)", color: "hsl(158 64% 52%)" }}>
          <CheckCircle className="h-4 w-4 flex-shrink-0" />
          Configurazione salvata! Il CEO AI utilizzerà ora {provider === "openrouter" ? "OpenRouter" : "Claude"}.
        </div>
      )}

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={saving || (provider === "openrouter" && !hasOpenRouterKey && !openrouterKey.trim())}
        className="w-full py-3 rounded-xl font-medium text-sm transition-all disabled:opacity-50"
        style={{
          background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
          color: "white",
        }}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Salva Configurazione"}
      </button>
    </div>
  );
}

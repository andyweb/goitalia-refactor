import { useState, useEffect } from "react";
import { useCompany } from "../context/CompanyContext";
import { Key, ExternalLink, Check, AlertCircle, ChevronRight } from "lucide-react";

export function ClaudeKeyModal() {
  const { selectedCompany } = useCompany();
  const [visible, setVisible] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!selectedCompany) return;
    setChecking(true);
    fetch(`/api/onboarding/claude-key/${selectedCompany.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.hasKey) {
          setVisible(true);
        }
        setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [selectedCompany]);

  if (checking || !visible || success) return null;

  const handleSubmit = async () => {
    if (!selectedCompany || !apiKey) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/onboarding/claude-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompany.id, apiKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Errore nel salvataggio");
        setLoading(false);
        return;
      }
      setSuccess(true);
      setTimeout(() => setVisible(false), 1500);
    } catch {
      setError("Errore di connessione");
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card text-card-foreground shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 pb-4 border-b border-border">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
              <Key className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Collega Claude AI</h2>
              <p className="text-sm text-muted-foreground">Inserisci la tua API key per attivare gli agenti</p>
            </div>
          </div>
        </div>

        {/* Tutorial */}
        <div className="p-6 space-y-4">
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Come ottenere la API key</p>

            <div className="space-y-2">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                <div>
                  <p className="text-sm font-medium">Crea un account su Anthropic</p>
                  <a
                    href="https://console.anthropic.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-0.5"
                  >
                    console.anthropic.com <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                <div>
                  <p className="text-sm font-medium">Vai su "API Keys" nel menu</p>
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-0.5"
                  >
                    Vai alle API Keys <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
                <p className="text-sm font-medium">Clicca "Create Key", copia la chiave e incollala qui sotto</p>
              </div>
            </div>
          </div>

          {/* Input */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">API Key *</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setError(null); }}
              placeholder="sk-ant-api03-..."
              className="w-full px-4 py-3 rounded-xl border border-border bg-background text-foreground text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
              autoComplete="off"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Note */}
          <p className="text-xs text-muted-foreground">
            La key viene verificata con una chiamata di test e salvata in modo sicuro. Non viene mai condivisa.
          </p>
        </div>

        {/* Footer */}
        <div className="p-6 pt-2 flex justify-end gap-3">
          <button
            onClick={handleSubmit}
            disabled={!apiKey || !apiKey.startsWith("sk-ant-") || loading}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Verifica in corso...
              </>
            ) : (
              <>
                Attiva agenti <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

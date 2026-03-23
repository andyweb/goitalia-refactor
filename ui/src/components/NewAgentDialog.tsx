import { useState } from "react";
import { useNavigate } from "@/lib/router";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { UserPlus, X } from "lucide-react";
import { agentsApi } from "../api/agents";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../lib/queryKeys";

export function NewAgentDialog() {
  const { newAgentOpen, closeNewAgent } = useDialog();
  const { selectedCompanyId } = useCompany();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [capabilities, setCapabilities] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      agentsApi.create(selectedCompanyId!, data),
    onSuccess: (agent: { urlKey?: string; id: string }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId!) });
      setName(""); setTitle(""); setCapabilities(""); setError(null);
      closeNewAgent();
      navigate(`/agents/${agent.urlKey ?? agent.id}/dashboard`);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Errore nella creazione");
    },
  });

  function handleCreate() {
    if (!name.trim()) { setError("Il nome è obbligatorio"); return; }
    setError(null);
    createMutation.mutate({
      name: name.trim(),
      title: title.trim() || undefined,
      capabilities: capabilities.trim() || undefined,
      adapterType: "claude_api",
      adapterConfig: {},
      role: "general",
      status: "idle",
    });
  }

  const inputClass = "w-full rounded-xl px-3 py-2.5 text-sm outline-none transition-colors";
  const inputStyle = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "hsl(0 0% 98%)",
  };

  return (
    <Dialog
      open={newAgentOpen}
      onOpenChange={(open) => {
        if (!open) {
          setError(null); setName(""); setTitle(""); setCapabilities("");
          closeNewAgent();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md p-0 gap-0 overflow-hidden"
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.01) 100%)",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(40px)",
          WebkitBackdropFilter: "blur(40px)",
          borderRadius: "1.5rem",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" style={{ color: "hsl(158 64% 52%)" }} />
            <span className="text-sm font-medium">Nuovo Agente</span>
          </div>
          <button
            className="h-7 w-7 flex items-center justify-center rounded-lg transition-colors"
            style={{ background: "rgba(255,255,255,0.06)" }}
            onClick={() => { setError(null); setName(""); setTitle(""); setCapabilities(""); closeNewAgent(); }}
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* Form */}
        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Nome *</label>
            <input
              className={inputClass}
              style={inputStyle}
              placeholder="Es. Marco, Assistente Vendite..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Ruolo / Titolo</label>
            <input
              className={inputClass}
              style={inputStyle}
              placeholder="Es. Responsabile Social, Contabile..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Competenze</label>
            <textarea
              className={`${inputClass} min-h-[80px] resize-none`}
              style={inputStyle}
              placeholder="Descrivi cosa deve saper fare questo agente..."
              value={capabilities}
              onChange={(e) => setCapabilities(e.target.value)}
            />
          </div>

          {error && (
            <div className="rounded-xl px-3 py-2 text-xs" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "hsl(0 65% 65%)" }}>
              {error}
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={createMutation.isPending || !name.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))",
              boxShadow: "0 4px 20px hsl(158 64% 42% / 0.3)",
            }}
          >
            {createMutation.isPending ? "Creazione in corso..." : "Crea Agente"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

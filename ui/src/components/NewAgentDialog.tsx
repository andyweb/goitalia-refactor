import { useState } from "react";
import { useNavigate } from "@/lib/router";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { ArrowLeft, UserPlus, X, ChevronRight } from "lucide-react";
import { agentsApi } from "../api/agents";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../lib/queryKeys";
import { AGENT_TEMPLATES, EMPTY_TEMPLATE, type AgentTemplate } from "../data/agent-templates";

const glassDialog = {
  background: "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.01) 100%)",
  border: "1px solid rgba(255,255,255,0.12)",
  backdropFilter: "blur(40px)",
  WebkitBackdropFilter: "blur(40px)",
  borderRadius: "1.5rem",
} as React.CSSProperties;

const inputClass = "w-full rounded-xl px-3 py-2.5 text-sm outline-none transition-colors";
const inputStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "hsl(0 0% 98%)",
} as React.CSSProperties;

export function NewAgentDialog() {
  const { newAgentOpen, closeNewAgent } = useDialog();
  const { selectedCompanyId } = useCompany();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<"select" | "customize">("select");
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplate | null>(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [capabilities, setCapabilities] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      agentsApi.create(selectedCompanyId!, data),
    onSuccess: (agent: { urlKey?: string; id: string }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId!) });
      resetAndClose();
      navigate(`/agents/${agent.urlKey ?? agent.id}/dashboard`);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Errore nella creazione");
    },
  });

  function resetAndClose() {
    setStep("select");
    setSelectedTemplate(null);
    setName("");
    setTitle("");
    setCapabilities("");
    setError(null);
    closeNewAgent();
  }

  function selectTemplate(template: AgentTemplate) {
    setSelectedTemplate(template);
    if (template.id === "vuoto") {
      setName("");
      setTitle("");
      setCapabilities("");
    } else {
      setName(template.name);
      setTitle(template.title);
      setCapabilities(template.capabilities);
    }
    setStep("customize");
  }

  function handleCreate() {
    if (!name.trim()) { setError("Il nome è obbligatorio"); return; }
    setError(null);

    const data: Record<string, unknown> = {
      name: name.trim(),
      title: title.trim() || undefined,
      capabilities: capabilities.trim() || undefined,
      adapterType: "claude_local",
      adapterConfig: {},
      role: "general",
      status: "idle",
    };

    // Se ha un template con istruzioni, le mettiamo nel promptTemplate dell'adapterConfig
    if (selectedTemplate && selectedTemplate.id !== "vuoto" && selectedTemplate.instructions) {
      data.adapterConfig = { promptTemplate: selectedTemplate.instructions };
    }

    createMutation.mutate(data);
  }

  return (
    <Dialog
      open={newAgentOpen}
      onOpenChange={(open) => { if (!open) resetAndClose(); }}
    >
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-lg p-0 gap-0 overflow-hidden"
        style={glassDialog}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="flex items-center gap-2">
            {step === "customize" && (
              <button
                className="h-7 w-7 flex items-center justify-center rounded-lg transition-colors mr-1"
                style={{ background: "rgba(255,255,255,0.06)" }}
                onClick={() => setStep("select")}
              >
                <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
            <UserPlus className="h-4 w-4" style={{ color: "hsl(158 64% 52%)" }} />
            <span className="text-sm font-medium">
              {step === "select" ? "Scegli tipo di agente" : selectedTemplate?.name ?? "Nuovo Agente"}
            </span>
          </div>
          <button
            className="h-7 w-7 flex items-center justify-center rounded-lg transition-colors"
            style={{ background: "rgba(255,255,255,0.06)" }}
            onClick={resetAndClose}
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>

        {step === "select" ? (
          /* ===== STEP 1: Template Selection ===== */
          <div className="p-4 max-h-[70vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-2">
              {AGENT_TEMPLATES.map((template) => {
                const Icon = template.icon;
                return (
                  <button
                    key={template.id}
                    className="flex flex-col items-start gap-2 p-3 rounded-xl text-left transition-all"
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                    onClick={() => selectTemplate(template)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                      e.currentTarget.style.borderColor = template.color;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                      e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                    }}
                  >
                    <div className="flex items-center gap-2 w-full">
                      <div
                        className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: `${template.color}20`, color: template.color }}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate">{template.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{template.department}</div>
                      </div>
                      <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                    </div>
                    <p className="text-[10px] text-muted-foreground/70 line-clamp-2 leading-relaxed">
                      {template.description}
                    </p>
                  </button>
                );
              })}

              {/* Empty template */}
              <button
                className="flex flex-col items-start gap-2 p-3 rounded-xl text-left transition-all col-span-2"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px dashed rgba(255,255,255,0.15)",
                }}
                onClick={() => selectTemplate(EMPTY_TEMPLATE)}
                onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.02)"}
              >
                <div className="flex items-center gap-2 w-full">
                  <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <UserPlus className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-semibold">Agente Personalizzato</div>
                    <div className="text-[10px] text-muted-foreground">Crea un agente vuoto e configuralo come preferisci</div>
                  </div>
                  <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                </div>
              </button>
            </div>
          </div>
        ) : (
          /* ===== STEP 2: Customize ===== */
          <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
            {/* Template info */}
            {selectedTemplate && selectedTemplate.id !== "vuoto" && (
              <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div
                  className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: `${selectedTemplate.color}20`, color: selectedTemplate.color }}
                >
                  <selectedTemplate.icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{selectedTemplate.name}</div>
                  <div className="text-xs text-muted-foreground">{selectedTemplate.department} — {selectedTemplate.title}</div>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Nome agente *</label>
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

            {/* Plugin suggeriti */}
            {selectedTemplate && selectedTemplate.plugins.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Plugin consigliati</label>
                <div className="flex flex-wrap gap-1.5">
                  {selectedTemplate.plugins.map((plugin) => (
                    <span
                      key={plugin}
                      className="px-2.5 py-1 rounded-full text-[10px] font-medium"
                      style={{
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "rgba(255,255,255,0.6)",
                      }}
                    >
                      {plugin}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Suitable for */}
            {selectedTemplate && selectedTemplate.id !== "vuoto" && (
              <div className="text-[10px] text-muted-foreground/50">
                Adatto a: {selectedTemplate.suitableFor.join(", ")}
              </div>
            )}

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
        )}
      </DialogContent>
    </Dialog>
  );
}

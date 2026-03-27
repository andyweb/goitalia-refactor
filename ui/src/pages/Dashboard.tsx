import { useEffect } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { agentsApi } from "../api/agents";
import { queryKeys } from "../lib/queryKeys";
import {
  Building2, Plug, Bot, MessageCircle, Network, Package, Plus,
  ArrowRight, Globe, Phone, Mail, MapPin, ChevronRight,
} from "lucide-react";
import type { Agent } from "@goitalia/shared";

const CONNECTOR_INFO: Record<string, { label: string; color: string; short: string }> = {
  google: { label: "Google", color: "#4285F4", short: "G" },
  telegram: { label: "Telegram", color: "#26A5E4", short: "T" },
  whatsapp: { label: "WhatsApp", color: "#25D366", short: "W" },
  meta_ig: { label: "Instagram", color: "#E1306C", short: "IG" },
  meta_fb: { label: "Facebook", color: "#1877F2", short: "FB" },
  linkedin: { label: "LinkedIn", color: "#0A66C2", short: "LI" },
  fal: { label: "Fal.ai", color: "#6366F1", short: "F" },
  fic: { label: "Fatture in Cloud", color: "#F59E0B", short: "FC" },
  openapi: { label: "OpenAPI.it", color: "#10B981", short: "OA" },
  voice: { label: "Vocali AI", color: "#8B5CF6", short: "V" },
  pec: { label: "PEC", color: "#06B6D4", short: "PE" },
  stripe: { label: "Stripe", color: "#635BFF", short: "S" },
  hubspot: { label: "HubSpot", color: "#FF7A45", short: "H" },
  salesforce: { label: "Salesforce", color: "#00A1E0", short: "SF" },
};

export function Dashboard() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => { setBreadcrumbs([{ label: "Dashboard" }]); }, [setBreadcrumbs]);

  // Profile
  const { data: profileData } = useQuery({
    queryKey: ["company-profile", selectedCompanyId],
    queryFn: () => fetch("/api/company-profile?companyId=" + selectedCompanyId, { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedCompanyId,
  });
  const profile = profileData?.profile || {};

  // Agents
  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const activeAgents = (agents || []).filter((a: Agent) => a.status !== "terminated" && a.role !== "ceo");

  // Connectors
  const { data: connectors } = useQuery({
    queryKey: ["connectors", selectedCompanyId],
    queryFn: () => fetch("/api/connector-accounts?companyId=" + selectedCompanyId, { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedCompanyId,
  });

  // Products
  const { data: products } = useQuery({
    queryKey: ["products", selectedCompanyId],
    queryFn: () => fetch("/api/company-products?companyId=" + selectedCompanyId, { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedCompanyId,
  });

  // A2A profile
  const { data: a2aProfile } = useQuery({
    queryKey: ["a2a-profile", selectedCompanyId],
    queryFn: () => fetch("/api/a2a/profile?companyId=" + selectedCompanyId, { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedCompanyId,
  });

  // Chat history (last messages)
  const { data: chatHistory } = useQuery({
    queryKey: ["chat-history-dash", selectedCompanyId],
    queryFn: () => fetch("/api/chat/history?companyId=" + selectedCompanyId + "&limit=5", { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedCompanyId,
  });

  const connectorsList = Array.isArray(connectors) ? connectors : [];
  const productsList = Array.isArray(products) ? products : [];
  const categories = [...new Set(productsList.map((p: any) => p.category).filter(Boolean))];
  const lastMessages = (chatHistory?.messages || []).filter((m: any) => !m.content?.startsWith("__PENDING__")).slice(-5);

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header — Company Info */}
      <div className="rounded-xl p-5 flex items-center gap-4" style={{ background: "linear-gradient(135deg, rgba(34,197,94,0.08), rgba(34,197,94,0.02))", border: "1px solid rgba(34,197,94,0.15)" }}>
        <div className="h-12 w-12 rounded-xl flex items-center justify-center text-sm font-bold shrink-0" style={{ background: "hsl(158 64% 42% / 0.15)", color: "hsl(158 64% 42%)" }}>
          {(profile.ragione_sociale || selectedCompany?.name || "?").slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold truncate">{profile.ragione_sociale || selectedCompany?.name}</h1>
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            {profile.settore && <span className="flex items-center gap-1"><Globe className="w-3 h-3" /> {profile.settore}</span>}
            {profile.citta && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {profile.citta}</span>}
            {profile.telefono && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {profile.telefono}</span>}
            {profile.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {profile.email}</span>}
          </div>
        </div>
        <Link to="company/settings" className="text-xs px-3 py-1.5 rounded-lg no-underline transition-all" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.6)" }}>
          Profilo <ChevronRight className="w-3 h-3 inline" />
        </Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center gap-2">
            <Plug className="w-4 h-4" style={{ color: "#a855f7" }} />
            <span className="text-xl font-bold" style={{ color: "#a855f7" }}>{connectorsList.length}</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">Connettori</p>
        </div>
        <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4" style={{ color: "#f59e0b" }} />
            <span className="text-xl font-bold" style={{ color: "#f59e0b" }}>{activeAgents.length}</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">Agenti</p>
        </div>
        <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4" style={{ color: "#3b82f6" }} />
            <span className="text-xl font-bold" style={{ color: "#3b82f6" }}>{productsList.length}</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">Catalogo</p>
        </div>
        <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4" style={{ color: "#22c55e" }} />
            <span className="text-xl font-bold" style={{ color: "#22c55e" }}>{a2aProfile ? "ON" : "OFF"}</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">Rete A2A</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Left column */}
        <div className="space-y-4">
          {/* Connectors */}
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Connettori Attivi</h2>
              <Link to="plugins" className="text-[10px] text-muted-foreground hover:text-white no-underline flex items-center gap-0.5">
                <Plus className="w-3 h-3" /> Aggiungi
              </Link>
            </div>
            {connectorsList.length === 0 ? (
              <div className="text-center py-4">
                <Plug className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Nessun connettore attivo</p>
                <Link to="plugins" className="text-xs no-underline mt-1 inline-block" style={{ color: "hsl(158 64% 52%)" }}>Vai ai Connettori</Link>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {connectorsList.map((c: any, i: number) => {
                  const info = CONNECTOR_INFO[c.connectorType];
                  return (
                    <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: `${info?.color || "#666"}10`, border: `1px solid ${info?.color || "#666"}20` }}>
                      <div className="h-5 w-5 rounded flex items-center justify-center text-[9px] font-bold text-white" style={{ background: info?.color || "#555" }}>
                        {info?.short || c.connectorType.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-xs" style={{ color: info?.color || "#999" }}>{c.accountLabel || info?.label || c.connectorType}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Agents */}
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Agenti ({activeAgents.length})</h2>
            </div>
            {activeAgents.length === 0 ? (
              <div className="text-center py-4">
                <Bot className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Nessun agente creato</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">Collega un connettore e crea il tuo primo agente</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {activeAgents.map((a: Agent) => (
                  <Link key={a.id} to={`agents/${a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}/instructions`} className="flex items-center gap-2.5 px-3 py-2 rounded-lg no-underline text-inherit transition-all hover:bg-white/5">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: a.status === "idle" ? "#22c55e" : a.status === "running" ? "#f59e0b" : "#6b7280" }} />
                    <span className="text-xs font-medium flex-1 truncate">{a.name}</span>
                    <span className="text-[10px] text-muted-foreground">{a.title || a.role}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Catalog quick view */}
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Catalogo ({productsList.length})</h2>
              <Link to="company/settings#catalogo" className="text-[10px] text-muted-foreground hover:text-white no-underline flex items-center gap-0.5">
                Gestisci <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            {categories.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {categories.map((cat: string) => {
                  const count = productsList.filter((p: any) => p.category === cat).length;
                  return (
                    <span key={cat} className="px-2 py-0.5 rounded-lg text-[10px] font-medium" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)" }}>
                      {cat} ({count})
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/50">Nessun prodotto nel catalogo</p>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Chat with CEO */}
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ultime Conversazioni CEO</h2>
              <Link to="chat" className="text-[10px] text-muted-foreground hover:text-white no-underline flex items-center gap-0.5">
                Apri Chat <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            {lastMessages.length === 0 ? (
              <div className="text-center py-4">
                <MessageCircle className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Nessuna conversazione</p>
                <Link to="chat" className="text-xs no-underline mt-1 inline-block" style={{ color: "hsl(158 64% 52%)" }}>Inizia a parlare col CEO</Link>
              </div>
            ) : (
              <div className="space-y-1.5">
                {lastMessages.map((m: any, i: number) => (
                  <div key={i} className="flex gap-2 py-1">
                    <div className="w-1 rounded-full shrink-0" style={{ background: m.role === "user" ? "hsl(158 64% 42%)" : "rgba(255,255,255,0.15)" }} />
                    <p className="text-[11px] text-muted-foreground truncate">{m.content?.substring(0, 100)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* A2A Network */}
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Rete A2A</h2>
              <Link to="a2a" className="text-[10px] text-muted-foreground hover:text-white no-underline flex items-center gap-0.5">
                Gestisci <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            {a2aProfile ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-xs font-medium">A2A Attiva</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  La tua azienda è visibile nella directory. Altre aziende possono trovarti e inviarti richieste.
                </p>
              </div>
            ) : (
              <div className="text-center py-4">
                <Network className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Rete A2A non attiva</p>
                <Link to="a2a" className="text-xs no-underline mt-1 inline-block" style={{ color: "hsl(158 64% 52%)" }}>Attiva A2A</Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

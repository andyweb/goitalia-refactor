import { useEffect, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { authApi } from "../api/auth";
import {
  Building2,
  Users,
  Bot,
  Plug,
  Activity,
  ChevronDown,
  Mail,
  Phone,
  MapPin,
  Globe,
  ExternalLink,
} from "lucide-react";
import { cn } from "../lib/utils";

function StatCard({ icon: Icon, value, label, color }: {
  icon: typeof Building2;
  value: string | number;
  label: string;
  color: string;
}) {
  return (
    <div className="rounded-xl p-5 transition-all" style={{ background: `${color}08`, border: `1px solid ${color}20` }}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-3xl font-bold" style={{ color }}>{value}</p>
          <p className="text-xs text-muted-foreground mt-1">{label}</p>
        </div>
        <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ background: `${color}15`, color }}>
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>
    </div>
  );
}

const CONNECTOR_LABELS: Record<string, { label: string; color: string }> = {
  google: { label: "Google", color: "#4285F4" },
  telegram: { label: "Telegram", color: "#26A5E4" },
  whatsapp: { label: "WhatsApp", color: "#25D366" },
  meta_ig: { label: "Instagram", color: "#E1306C" },
  meta_fb: { label: "Facebook", color: "#1877F2" },
  linkedin: { label: "LinkedIn", color: "#0A66C2" },
  fal: { label: "Fal.ai", color: "#6366F1" },
  fic: { label: "Fatture in Cloud", color: "#F59E0B" },
  openapi: { label: "OpenAPI.it", color: "#10B981" },
  voice: { label: "Vocali AI", color: "#8B5CF6" },
  pec: { label: "PEC", color: "#06B6D4" },
  stripe: { label: "Stripe", color: "#635BFF" },
  hubspot: { label: "HubSpot", color: "#FF7A45" },
  salesforce: { label: "Salesforce", color: "#00A1E0" },
};

type CompanyData = {
  id: string;
  name: string;
  issuePrefix: string;
  createdAt: string;
  profile: {
    ragioneSociale?: string;
    partitaIva?: string;
    citta?: string;
    settore?: string;
    telefono?: string;
    email?: string;
  } | null;
  agentsTotal: number;
  agentsActive: number;
  connectors: Array<{ type: string; label: string | null }>;
  users: Array<{ id: string; email: string; name: string }>;
};

export function AdminDashboard() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "GoItalIA Admin" }]);
  }, [setBreadcrumbs]);

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });

  const { data: stats } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => fetch("/api/admin/stats", { credentials: "include" }).then(r => r.json()),
  });

  const { data: companies } = useQuery<CompanyData[]>({
    queryKey: ["admin", "companies"],
    queryFn: () => fetch("/api/admin/companies", { credentials: "include" }).then(r => r.json()),
  });

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(158 64% 42% / 0.15)", color: "hsl(158 64% 42%)" }}>
          <Activity className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold">GoItalIA Admin</h1>
          <p className="text-xs text-muted-foreground">{session?.user?.email}</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Building2} value={stats?.totalCompanies ?? "–"} label="Imprese" color="hsl(158, 64%, 42%)" />
        <StatCard icon={Users} value={stats?.totalUsers ?? "–"} label="Utenti" color="hsl(200, 60%, 50%)" />
        <StatCard icon={Bot} value={stats?.totalAgents ?? "–"} label="Agenti" color="hsl(38, 92%, 50%)" />
        <StatCard icon={Plug} value={stats?.totalConnectors ?? "–"} label="Connettori" color="hsl(270, 60%, 55%)" />
      </div>

      {/* Companies List */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Imprese Registrate ({companies?.length ?? 0})
        </h2>
        {(companies ?? []).map((c) => {
          const isExpanded = expandedCompany === c.id;
          return (
            <div key={c.id} className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <button onClick={() => setExpandedCompany(isExpanded ? null : c.id)} className="w-full px-4 py-3 flex items-center gap-3 text-left">
                <div className="h-9 w-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0" style={{ background: "hsl(158 64% 42% / 0.15)", color: "hsl(158 64% 42%)" }}>
                  {c.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{c.profile?.ragioneSociale || c.name}</div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                    {c.profile?.citta && <span>{c.profile.citta}</span>}
                    {c.profile?.partitaIva && <span>P.IVA {c.profile.partitaIva}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.connectors.length > 0 && (
                    <div className="flex -space-x-1">
                      {c.connectors.slice(0, 5).map((co, i) => {
                        const info = CONNECTOR_LABELS[co.type];
                        return (
                          <div key={i} className="h-5 w-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white border border-black/30" style={{ background: info?.color || "#666" }} title={info?.label || co.type}>
                            {(info?.label || co.type).charAt(0)}
                          </div>
                        );
                      })}
                      {c.connectors.length > 5 && <div className="h-5 w-5 rounded-full flex items-center justify-center text-[8px] text-muted-foreground" style={{ background: "rgba(255,255,255,0.1)" }}>+{c.connectors.length - 5}</div>}
                    </div>
                  )}
                  <span className="text-[10px] text-muted-foreground">{c.agentsActive} agenti</span>
                  <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 pt-1 border-t border-white/5 space-y-3">
                  {/* Users */}
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Utenti</div>
                    <div className="flex flex-wrap gap-2">
                      {c.users.map(u => (
                        <div key={u.id} className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]" style={{ background: "rgba(255,255,255,0.05)" }}>
                          <Mail className="w-3 h-3 text-muted-foreground" />
                          <span>{u.email}</span>
                          <span className="text-muted-foreground">({u.name})</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Profile details */}
                  {c.profile && (
                    <div className="grid grid-cols-2 gap-2">
                      {c.profile.settore && <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Globe className="w-3 h-3" /> {c.profile.settore}</div>}
                      {c.profile.telefono && <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Phone className="w-3 h-3" /> {c.profile.telefono}</div>}
                      {c.profile.email && <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Mail className="w-3 h-3" /> {c.profile.email}</div>}
                      {c.profile.citta && <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><MapPin className="w-3 h-3" /> {c.profile.citta}</div>}
                    </div>
                  )}

                  {/* Connectors */}
                  {c.connectors.length > 0 && (
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Connettori ({c.connectors.length})</div>
                      <div className="flex flex-wrap gap-1.5">
                        {c.connectors.map((co, i) => {
                          const info = CONNECTOR_LABELS[co.type];
                          return (
                            <span key={i} className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: `${info?.color || "#666"}20`, color: info?.color || "#999", border: `1px solid ${info?.color || "#666"}30` }}>
                              {info?.label || co.type}{co.label ? `: ${co.label}` : ""}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    <Link to={`/${c.issuePrefix}/dashboard`} className="flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-lg no-underline" style={{ background: "hsl(158 64% 42% / 0.12)", color: "hsl(158 64% 52%)", border: "1px solid hsl(158 64% 42% / 0.25)" }}>
                      Apri Dashboard <ExternalLink className="w-3 h-3" />
                    </Link>
                    <Link to={`/${c.issuePrefix}/chat`} className="flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-lg no-underline" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.1)" }}>
                      Chat CEO
                    </Link>
                    <Link to={`/${c.issuePrefix}/plugins`} className="flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-lg no-underline" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.1)" }}>
                      Connettori
                    </Link>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

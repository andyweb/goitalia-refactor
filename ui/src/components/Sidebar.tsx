import {
  Inbox,
  CircleDot,
  LayoutDashboard,
  Search,
  SquarePen,
  Target,
  MessageCircle,
  Mail,
  Calendar,
  HardDrive,
  MessageSquare,
  Phone,
  Share2 as Share2Icon,
  Share2,
  Plus,
  ChevronDown,
  Settings,
  Plug,
  ShieldCheck,
  Key,
  LogOut,
  FolderOpen, Sparkles, Receipt, Globe, CalendarClock, Shield, Network, Crown, Brain,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarProjects } from "./SidebarProjects";
import { CONNECTOR_ICONS, detectConnector } from "./SidebarAgents";
import { agentsApi } from "../api/agents";
import { useDialog } from "../context/DialogContext";
import { useLocation, NavLink } from "@/lib/router";
import { useCompany } from "../context/CompanyContext";
import { useOnboarding } from "../context/OnboardingContext";
import { heartbeatsApi } from "../api/heartbeats";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { useInboxBadge } from "../hooks/useInboxBadge";
import { PluginSlotOutlet } from "@/plugins/slots";
import { CompanyPatternIcon } from "./CompanyPatternIcon";
import { useSidebar } from "../context/SidebarContext";
import { cn, agentRouteRef, agentUrl } from "../lib/utils";
import type { Agent } from "@goitalia/shared";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";

export function Sidebar() {
  const { openNewIssue } = useDialog();
  const { companies, selectedCompanyId, selectedCompany, setSelectedCompanyId } = useCompany();
  const { step: onboardingStep } = useOnboarding();
  const { data: sidebarAgents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    placeholderData: (prev) => prev,
  });
  const [mailUnread, setMailUnread] = useState(0);
  const location = useLocation();
  const [hasGoogle, setHasGoogle] = useState(false);
  const [hasTelegram, setHasTelegram] = useState(false);
  const [hasWhatsApp, setHasWhatsApp] = useState(false);
  const [hasSocial, setHasSocial] = useState(false);
  const [hasFal, setHasFal] = useState(false);
  const [hasFic, setHasFic] = useState(false);
  const [hasOpenapi, setHasOpenapi] = useState(false);
  const [a2aBadge, setA2aBadge] = useState(0);
  const [hasPec, setHasPec] = useState(false);
  const [pecUnread, setPecUnread] = useState(0);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [telegramUnread, setTelegramUnread] = useState(0);
  const [waUnread, setWaUnread] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  const connectorInitRef = useRef(false);

  useEffect(() => {
    if (!selectedCompanyId) return;
    connectorInitRef.current = false;
    const checkConnectors = () => {
      const isInit = !connectorInitRef.current;
      connectorInitRef.current = true;
      fetch("/api/oauth/google/status?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => { if (d.connected || isInit) setHasGoogle(d.connected || false); })
        .catch(() => {});
      fetch("/api/telegram/status?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => { if (d.connected || isInit) setHasTelegram(d.connected || false); })
        .catch(() => {});
      fetch("/api/whatsapp/status?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => { if (d.connected || isInit) setHasWhatsApp(d.connected || false); })
        .catch(() => {});
      fetch("/api/fal/status?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => { if (d.connected || isInit) setHasFal(d.connected || false); })
        .catch(() => {});
      fetch("/api/fic/status?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => { if (d.connected || isInit) setHasFic(d.connected || false); })
        .catch(() => {});
      fetch("/api/onboarding/claude-key/" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json()).then((d) => setHasApiKey(!!d.hasKey)).catch(() => {});
      fetch("/api/openapi-it/status?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => { if (d.connected || isInit) setHasOpenapi(d.connected || false); })
        .catch(() => {});
      fetch("/api/pec/status?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => { if (d.connected || isInit) setHasPec(d.connected || false); })
        .catch(() => {});
      fetch("/api/routines/pending?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setPendingCount(Array.isArray(d) ? d.length : 0))
        .catch(() => {});
      fetch("/api/oauth/meta/status?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json()).catch(() => ({ connected: false }))
        .then((meta) => { if (meta.connected || isInit) setHasSocial(meta.connected); });
    };
    checkConnectors();
    const connectorInterval = setInterval(checkConnectors, 10000);

    const fetchWaUnread = () => {
      if (!selectedCompanyId) return;
      if (window.location.pathname.includes("/whatsapp")) { setWaUnread(0); return; }
      fetch("/api/whatsapp/unread-count?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setWaUnread(d.count || 0))
        .catch(() => {});
    };
    fetchWaUnread();
    if (window.location.pathname.includes("/telegram")) setTelegramUnread(0);

    const fetchTgUnread = () => {
      if (!selectedCompanyId) return;
      fetch("/api/telegram/unread-count?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setTelegramUnread(d.count || 0))
        .catch(() => {});
    };
    fetchTgUnread();

    const fetchPecUnread = () => {
      fetch("/api/pec/unread-count?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setPecUnread(d.count || 0))
        .catch(() => {});
    };
    fetchPecUnread();
    if (window.location.pathname.includes("/pec")) setPecUnread(0);

    const fetchUnread = () => {
      fetch("/api/gmail/unread-count?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setMailUnread(d.count || 0))
        .catch(() => {});
    };
    const fetchA2aBadge = () => {
      fetch("/api/a2a/unread-count?companyId=" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setA2aBadge(d.total || 0))
        .catch(() => {});
    };
    fetchUnread();
    fetchA2aBadge();
    const interval = setInterval(() => { fetchUnread(); fetchTgUnread(); fetchWaUnread(); fetchPecUnread(); fetchA2aBadge();
    if (window.location.pathname.includes("/telegram")) setTelegramUnread(0);
    if (window.location.pathname.includes("/pec")) setPecUnread(0); }, 30000);
    const onMailUpdated = () => fetchUnread();
    const onTgRead = () => { setTelegramUnread(0); };
    const onWaRead = () => { setWaUnread(0); };
    window.addEventListener("mail-updated", onMailUpdated);
    window.addEventListener("telegram-read", onTgRead);
    window.addEventListener("whatsapp-read", onWaRead);
    return () => { clearInterval(interval); clearInterval(connectorInterval); window.removeEventListener("mail-updated", onMailUpdated); window.removeEventListener("telegram-read", onTgRead); window.removeEventListener("whatsapp-read", onWaRead); };
  }, [selectedCompanyId]);

  // Listen for API key changes
  useEffect(() => {
    const handler = () => {
      if (!selectedCompanyId) return;
      fetch("/api/onboarding/claude-key/" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json()).then((d) => setHasApiKey(!!d.hasKey)).catch(() => {});
    };
    window.addEventListener("onboarding-step-changed", handler);
    return () => window.removeEventListener("onboarding-step-changed", handler);
  }, [selectedCompanyId]);

  const inboxBadge = useInboxBadge(selectedCompanyId);
  const queryClient = useQueryClient();
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
    placeholderData: (prev) => prev,
  });
  const liveRunCount = liveRuns?.length ?? 0;

  const { isMobile, setSidebarOpen: closeSidebar } = useSidebar();

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    try { const s = localStorage.getItem("sidebar_expanded"); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem("sidebar_expanded", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const liveCountByAgent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of liveRuns ?? []) counts.set(run.agentId, (counts.get(run.agentId) ?? 0) + 1);
    return counts;
  }, [liveRuns]);

  const agentsByConnector = useMemo(() => {
    const groups: Record<string, Agent[]> = {};
    // Map connector types that share a sidebar group
    const connectorGroupMap: Record<string, string> = { linkedin: "meta" };
    for (const agent of (sidebarAgents ?? []) as Agent[]) {
      if (agent.status === "terminated") continue;
      if (agent.role === "ceo") { (groups["ceo"] ??= []).push(agent); continue; }
      let conn = detectConnector(agent);
      if (conn) { conn = connectorGroupMap[conn] || conn; (groups[conn] ??= []).push(agent); }
      else { (groups["other"] ??= []).push(agent); }
    }
    return groups;
  }, [sidebarAgents]);

  const agentMatch = location.pathname.match(/\/agents\/([^/]+)/);
  const activeAgentRef = agentMatch?.[1] ?? null;

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });

  const sidebarCompanies = companies.filter((c) => c.status !== "archived");

  function openSearch() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  }

  const pluginContext = {
    companyId: selectedCompanyId,
    companyPrefix: selectedCompany?.issuePrefix ?? null,
  };

  // Determine disabled states based on onboarding step
  // null (loading) or 99 (complete) = everything enabled
  const isComplete = onboardingStep == null || onboardingStep >= 99;
  const isStep0 = onboardingStep === 0;
  const isStep1 = onboardingStep === 1;
  const isStep2 = onboardingStep === 2;
  const isStep3 = onboardingStep === 3;

  const glowStyle = {
    background: "hsl(158 64% 42% / 0.25)",
    boxShadow: "0 0 15px hsl(158 64% 42% / 0.4)",
  };

  // Connector groups config
  const connectorGroups = [
    { key: "google", label: "Google", show: hasGoogle, pages: [
      { to: "/mail", label: "Mail", icon: Mail, badge: mailUnread > 0 ? mailUnread : undefined },
      { to: "/calendario", label: "Calendario", icon: Calendar },
      { to: "/documenti", label: "Documenti", icon: HardDrive },
    ]},
    { key: "pec", label: "PEC", show: hasPec, pages: [
      { to: "/pec", label: "Posta Certificata", icon: Shield, badge: pecUnread > 0 ? pecUnread : undefined },
    ]},
    { key: "whatsapp", label: "WhatsApp", show: hasWhatsApp, pages: [
      { to: "/whatsapp", label: "Chat", icon: MessageCircle, badge: waUnread > 0 ? waUnread : undefined },
    ]},
    { key: "telegram", label: "Telegram", show: hasTelegram, pages: [
      { to: "/telegram", label: "Chat", icon: MessageCircle, badge: telegramUnread > 0 ? telegramUnread : undefined },
    ]},
    { key: "meta", label: "Social", show: hasSocial, pages: [
      { to: "/social", label: "Gestione Social", icon: Share2Icon },
    ]},
    { key: "fal", label: "fal.ai", show: hasFal, pages: [
      { to: "/genera", label: "Genera Contenuti", icon: Sparkles },
    ]},
    { key: "fic", label: "Fatture in Cloud", show: hasFic, pages: [
      { to: "/fatturazione", label: "Fatturazione", icon: Receipt },
    ]},
    { key: "openapi", label: "OpenAPI.it", show: hasOpenapi, pages: [
      { to: "/analisi-aziende", label: "Analisi Aziende", icon: Globe },
    ]},
    { key: "hubspot", label: "HubSpot", show: false, pages: [] },
    { key: "salesforce", label: "Salesforce", show: false, pages: [] },
    { key: "stripe", label: "Stripe", show: false, pages: [] },
  ];

  const visibleGroups = connectorGroups.filter(g => g.show || (agentsByConnector[g.key]?.length ?? 0) > 0);

  // Helper to render an agent item inside a connector group
  const cleanAgentName = (name: string, connKey?: string) => {
    let clean = name
      .replace(/^Agente\s+/i, "")
      .replace(/^AG\.\s*/i, "");
    // Strip connector label prefix/suffix
    const labels = ["google", "whatsapp", "telegram", "instagram", "facebook", "meta", "linkedin", "hubspot", "salesforce", "fal.ai", "fal", "fatture in cloud", "openapi", "stripe", "pec"];
    if (connKey) labels.unshift(connKey);
    for (const label of labels) {
      clean = clean.replace(new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s:·-]*", "i"), "");
      clean = clean.replace(new RegExp("[\\s:·-]*" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "i"), "");
    }
    // Remove wrapping parentheses
    clean = clean.replace(/^\((.+)\)$/, "$1").trim();
    return clean || name;
  };

  const renderAgentItem = (agent: Agent, connKey?: string, connColor?: string) => {
    const runCount = liveCountByAgent.get(agent.id) ?? 0;
    const isActive = activeAgentRef === agentRouteRef(agent);
    const displayName = cleanAgentName(agent.name, connKey);
    return (
      <NavLink
        key={agent.id}
        to={`${agentUrl(agent)}/instructions`}
        onClick={() => { if (isMobile) closeSidebar(false); }}
        className={cn(
          "flex items-center gap-2 px-3 py-1 text-[12px] transition-all rounded-lg",
          isActive ? "text-white bg-white/8" : "text-foreground/60 hover:text-foreground hover:bg-white/4"
        )}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "hsl(158 64% 42%)" }} />
        <span className="flex-1 truncate">{displayName}</span>
        {runCount > 0 && (
          <span className="flex items-center gap-1 shrink-0">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" />
            </span>
          </span>
        )}
      </NavLink>
    );
  };

  return (
    <aside className="w-60 h-full min-h-0 flex flex-col" style={{
      background: "linear-gradient(135deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.02) 50%, rgba(255, 255, 255, 0.01) 100%)",
      backdropFilter: "blur(40px) saturate(150%)",
      WebkitBackdropFilter: "blur(40px) saturate(150%)",
      borderRight: "1px solid rgba(255, 255, 255, 0.1)",
    }}>
      {/* Search */}
      <div className="px-3 pt-3 pb-1 shrink-0">
        <button
          onClick={openSearch}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-[13px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          style={{
            background: "hsl(0 0% 100% / 0.04)",
            border: "1px solid hsl(0 0% 100% / 0.06)",
          }}
        >
          <Search className="h-3.5 w-3.5" />
          <span>Cerca</span>
        </button>
      </div>

      {/* Main nav */}
      <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-1 px-2 py-2">
        {/* Top items */}
        {(["emanuele@unvrslabs.dev", "andreaspurio20@gmail.com"].includes(session?.user?.email ?? "") || ["nAVU4wn2Chz3WJdcvl6JmoDbBfXJsX5y", "RRJucp2b1t5frH8ezTJKCNWuT1on8n71"].includes(session?.user?.id ?? "")) && (
          <SidebarNavItem to="admin" label="GoItalIA Admin" icon={ShieldCheck} />
        )}
        <div className={"flex flex-col gap-0.5" + (!isComplete ? " opacity-30 pointer-events-none" : "")}>
          <SidebarNavItem to="/org" label="Organigramma" icon={Share2Icon} />
          <SidebarNavItem to="/a2a" label="A2A" icon={Network} badge={a2aBadge > 0 ? a2aBadge : undefined} />
          <SidebarNavItem to="/dashboard" label="Dashboard" icon={LayoutDashboard} liveCount={liveRunCount} />
          <SidebarNavItem to="/scheduled" label="Attività" icon={CalendarClock} badge={pendingCount > 0 ? pendingCount : undefined} />
        </div>

        {/* Lavoro - Connector Groups */}
        <SidebarSection label="Lavoro">
          <div className={!isComplete && !isStep1 && !isStep2 ? "opacity-30 pointer-events-none" : ""}>
            {/* CEO Group */}
            <div>
              <button
                id={isStep1 || isStep2 ? "chat-ceo-nav" : undefined}
                onClick={() => toggleGroup("ceo")}
                className="flex items-center gap-2.5 px-3 py-1.5 w-full text-[13px] font-medium transition-all rounded-lg hover:bg-white/5"
                style={isStep1 ? { ...glowStyle, position: "relative", zIndex: 10 } : undefined}
              >
                <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded-md" style={{ background: "hsl(158 64% 42% / 0.2)" }}>
                  <Crown className="w-3.5 h-3.5" style={{ color: "hsl(158 64% 42%)" }} />
                </span>
                <span className="flex-1 text-left truncate">CEO AI</span>
                <ChevronDown className={`w-3 h-3 text-muted-foreground/40 transition-transform ${expandedGroups.ceo ? "rotate-180" : ""}`} />
              </button>
              {expandedGroups.ceo && (
                <div onClick={(e) => e.stopPropagation()} className="ml-5 pl-2 mt-0.5 space-y-0.5" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
                  <SidebarNavItem to="/chat" label="Chat" icon={MessageCircle} />
                </div>
              )}
            </div>

            {/* Dynamic Connector Groups */}
            {visibleGroups.map(group => {
              const connIcon = CONNECTOR_ICONS[group.key];
              const groupAgents = agentsByConnector[group.key] || [];
              const isExpanded = !!expandedGroups[group.key];
              const totalBadge = group.pages.reduce((sum, p) => sum + (p.badge || 0), 0);
              return (
                <div key={group.key}>
                  <button
                    onClick={() => toggleGroup(group.key)}
                    className="flex items-center gap-2.5 px-3 py-1.5 w-full text-[13px] font-medium transition-all rounded-lg hover:bg-white/5"
                  >
                    <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded-md" style={{ background: (connIcon?.color || "#888") + "22" }}>
                      {connIcon?.icon || <Plug className="w-3.5 h-3.5" />}
                    </span>
                    <span className="flex-1 text-left truncate">{group.label}</span>
                    {totalBadge > 0 && group.key !== "whatsapp" && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400">{totalBadge}</span>
                    )}
                    <ChevronDown className={`w-3 h-3 text-muted-foreground/40 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                  </button>
                  {isExpanded && (
                    <div onClick={(e) => e.stopPropagation()} className="ml-5 pl-2 mt-0.5 space-y-0.5" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
                      {group.pages.map(p => (
                        <SidebarNavItem key={p.to} to={p.to} label={p.label} icon={p.icon} badge={p.badge} />
                      ))}
                      {groupAgents.map(a => renderAgentItem(a, group.key, connIcon?.color))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Orphan agents (no connector) */}
            {(agentsByConnector.other || []).length > 0 && (
              <div>
                <button
                  onClick={() => toggleGroup("other")}
                  className="flex items-center gap-2.5 px-3 py-1.5 w-full text-[13px] font-medium transition-all rounded-lg hover:bg-white/5"
                >
                  <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded-md" style={{ background: "rgba(150,150,150,0.15)" }}>
                    <CircleDot className="w-3.5 h-3.5 text-muted-foreground" />
                  </span>
                  <span className="flex-1 text-left truncate">Altri Agenti</span>
                  <ChevronDown className={`w-3 h-3 text-muted-foreground/40 transition-transform ${expandedGroups.other ? "rotate-180" : ""}`} />
                </button>
                {expandedGroups.other && (
                  <div onClick={(e) => e.stopPropagation()} className="ml-5 pl-2 mt-0.5 space-y-0.5" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
                    {(agentsByConnector.other || []).map(a => renderAgentItem(a))}
                  </div>
                )}
              </div>
            )}
          </div>
        </SidebarSection>

        {/* Projects */}
        <div className={!isComplete ? "opacity-30 pointer-events-none" : ""}>
          <SidebarProjects />
        </div>

        {/* Impostazioni */}
        <SidebarSection label="Impostazioni">
          {isStep3 ? (
            <div className="relative" id="connettori-nav">
              <div className="absolute inset-0 rounded-lg animate-pulse" style={glowStyle} />
              <SidebarNavItem to="/plugins" label="Connettori" icon={Plug} className="relative z-10 !text-white font-bold" />
            </div>
          ) : (
            <div className={!isComplete ? "opacity-30 pointer-events-none" : ""} id="connettori-nav"><SidebarNavItem to="/plugins" label="Connettori" icon={Plug} /></div>
          )}
          <div className={!isComplete ? "opacity-30 pointer-events-none" : ""}><SidebarNavItem to="/company/settings" label="Profilo" icon={Settings} /></div>
          {isStep0 ? (
            <div className="relative" id="api-claude-nav">
              <div className="absolute inset-0 rounded-lg animate-pulse" style={glowStyle} />
              <SidebarNavItem to="/api-claude" label="API Claude" icon={Key} className="relative z-10 !text-white font-bold" />
            </div>
          ) : (
            <div className={!isComplete && onboardingStep !== null && onboardingStep > 0 ? "opacity-30 pointer-events-none" : ""} id="api-claude-nav">
              <SidebarNavItem to="/api-claude" label="API Claude" icon={Key} />
            </div>
          )}
          {/* <div className={!isComplete ? "opacity-30 pointer-events-none" : ""}><SidebarNavItem to="/models" label="Modelli AI" icon={Brain} /></div> */}
        </SidebarSection>

        <PluginSlotOutlet
          slotTypes={["sidebarPanel"]}
          context={pluginContext}
          className="flex flex-col gap-3"
          itemClassName="rounded-lg border border-border p-3"
          missingBehavior="placeholder"
        />
      </nav>

      {/* Bottom: Company switcher */}
      <div className="shrink-0 mt-auto px-3 pb-3" style={{ borderTop: "1px solid hsl(0 0% 100% / 0.06)", paddingTop: "12px" }}>
        <div className="relative">
          <button
            onClick={() => setCompanyMenuOpen(!companyMenuOpen)}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl transition-colors"
            style={{
              background: "hsl(0 0% 100% / 0.04)",
              border: "1px solid hsl(0 0% 100% / 0.08)",
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "hsl(0 0% 100% / 0.08)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "hsl(0 0% 100% / 0.04)"}
          >
            {selectedCompany ? (
              <CompanyPatternIcon
                companyName={selectedCompany.name}
                logoUrl={selectedCompany.logoUrl ?? null}
                brandColor={selectedCompany.brandColor ?? null}
                className="rounded-lg !w-8 !h-8"
              />
            ) : (
              <div className="w-8 h-8 rounded-lg" style={{ background: "hsl(270 60% 50%)" }} />
            )}
            <div className="flex-1 min-w-0 text-left">
              <div className="text-sm font-medium text-foreground truncate">
                {selectedCompany?.name ?? "Seleziona"}
              </div>
              {session?.user?.email && (
                <div className="text-[11px] text-muted-foreground/50 truncate">
                  {session.user.email}
                </div>
              )}
            </div>
            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground/40 transition-transform ${companyMenuOpen ? "rotate-180" : ""}`} />
          </button>

          {companyMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setCompanyMenuOpen(false)} />
              <div
                className="absolute bottom-full left-0 right-0 mb-1 rounded-xl overflow-hidden z-50"
                style={{
                  background: "rgba(15, 22, 36, 0.85)",
                  backdropFilter: "blur(40px) saturate(150%)",
                  WebkitBackdropFilter: "blur(40px) saturate(150%)",
                  border: "1px solid hsl(0 0% 100% / 0.1)",
                  boxShadow: "0 8px 32px hsl(0 0% 0% / 0.5)",
                }}
              >
                <div className="py-1.5">
                  {sidebarCompanies.map((company) => (
                    <button
                      key={company.id}
                      onClick={() => {
                        setSelectedCompanyId(company.id);
                        setCompanyMenuOpen(false);
                      }}
                      className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] text-left transition-colors"
                      style={{
                        background: company.id === selectedCompany?.id ? "hsl(0 0% 100% / 0.06)" : "transparent",
                        color: company.id === selectedCompany?.id ? "hsl(0 0% 98%)" : "hsl(0 0% 70%)",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "hsl(0 0% 100% / 0.08)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = company.id === selectedCompany?.id ? "hsl(0 0% 100% / 0.06)" : "transparent"}
                    >
                      <CompanyPatternIcon
                        companyName={company.name}
                        logoUrl={company.logoUrl ?? null}
                        brandColor={company.brandColor ?? null}
                        className="rounded-md !w-6 !h-6"
                      />
                      <span className="truncate">{company.name}</span>
                    </button>
                  ))}

                  <div style={{ borderTop: "1px solid hsl(0 0% 100% / 0.06)", margin: "4px 0" }} />

                  <button
                    onClick={() => {
                      setCompanyMenuOpen(false);
                      window.location.href = "/companies";
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] transition-colors"
                    style={{ color: "hsl(158 64% 52%)" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "hsl(0 0% 100% / 0.06)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    <Plus className="h-4 w-4" />
                    <span>Nuova impresa</span>
                  </button>

                  <button
                    onClick={async () => {
                      setLoggingOut(true);
                      try {
                        await authApi.signOut();
                        await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
                        localStorage.clear();
                        window.location.href = "/auth";
                      } catch {
                        setLoggingOut(false);
                      }
                    }}
                    disabled={loggingOut}
                    className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] transition-colors"
                    style={{ color: "hsl(0 65% 55%)" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "hsl(0 0% 100% / 0.06)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    <LogOut className="h-4 w-4" />
                    <span>{loggingOut ? "Disconnessione..." : "Logout"}</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

import { useState, useEffect } from "react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Receipt, Send, Loader2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

type TabType = "emesse" | "ricevute";

interface Invoice {
  id: number;
  number?: string;
  date: string;
  entity: { name: string };
  amount_gross: number;
  status: string;
  ei_status?: string;
}

const glass = {
  card: "rounded-2xl",
  cardStyle: {
    background: "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.01) 100%)",
    border: "1px solid rgba(255,255,255,0.1)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
  } as React.CSSProperties,
};

const greenGradient = { background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))" };

function statusBadge(status: string) {
  if (status === "paid")
    return <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-500/20 text-green-400 border border-green-500/30">Pagata</span>;
  if (status === "not_paid")
    return <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">Non pagata</span>;
  return <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-500/20 text-zinc-400 border border-zinc-500/30">{status}</span>;
}

function sdiStatusBadge(eiStatus?: string) {
  if (!eiStatus || eiStatus === "none" || eiStatus === "not_sent")
    return <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-500/20 text-zinc-400 border border-zinc-500/30">Non inviata</span>;
  if (eiStatus === "sent" || eiStatus === "delivered")
    return <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">Inviata SDI</span>;
  if (eiStatus === "accepted")
    return <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-500/20 text-green-400 border border-green-500/30">Accettata SDI</span>;
  if (eiStatus === "rejected")
    return <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-500/20 text-red-400 border border-red-500/30">Rifiutata SDI</span>;
  return <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-500/20 text-zinc-400 border border-zinc-500/30">{eiStatus}</span>;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(amount);
}

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return dateStr;
  }
}

export function Fatturazione() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [tab, setTab] = useState<TabType>("emesse");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [received, setReceived] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [ficConnected, setFicConnected] = useState<boolean | null>(null);
  const [ficCompany, setFicCompany] = useState<string | null>(null);
  const [sendingSdi, setSendingSdi] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Impresa", href: "/dashboard" },
      { label: "Fatturazione" },
    ]);
  }, [selectedCompany?.name, setBreadcrumbs]);

  // Check FIC connection status
  useEffect(() => {
    if (!selectedCompany?.id) return;
    setLoading(true);
    fetch("/api/fic/status?companyId=" + selectedCompany.id, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setFicConnected(d.connected || false);
        setFicCompany(d.companyName || null);
        if (d.connected) {
          // Fetch invoices
          Promise.all([
            fetch("/api/fic/invoices?companyId=" + selectedCompany.id + "&type=invoice", { credentials: "include" })
              .then((r) => r.json())
              .then((d) => setInvoices(d.data || d.invoices || []))
              .catch(() => {}),
            fetch("/api/fic/received?companyId=" + selectedCompany.id, { credentials: "include" })
              .then((r) => r.json())
              .then((d) => setReceived(d.data || d.invoices || []))
              .catch(() => {}),
          ]).finally(() => setLoading(false));
        } else {
          setLoading(false);
        }
      })
      .catch(() => {
        setFicConnected(false);
        setLoading(false);
      });
  }, [selectedCompany?.id]);

  const handleSendSdi = async (invoiceId: number) => {
    if (!selectedCompany?.id) return;
    setSendingSdi(invoiceId);
    try {
      const r = await fetch("/api/fic/send-sdi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ companyId: selectedCompany.id, invoiceId }),
      });
      if (r.ok) {
        setInvoices((prev) =>
          prev.map((inv) => (inv.id === invoiceId ? { ...inv, ei_status: "sent" } : inv))
        );
      }
    } catch {}
    setSendingSdi(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not connected state
  if (ficConnected === false) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Receipt className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Fatturazione</h1>
        </div>
        <div className="rounded-2xl px-6 py-10 text-center" style={glass.cardStyle}>
          <Receipt className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
          <h2 className="text-lg font-medium mb-2">Collega Fatture in Cloud</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            Per visualizzare e gestire le tue fatture, collega il tuo account Fatture in Cloud dalla pagina Connettori.
          </p>
          <a
            href={"/" + (selectedCompany?.issuePrefix || "") + "/plugins"}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white no-underline transition-all"
            style={{ ...greenGradient, boxShadow: "0 4px 20px hsla(158,64%,42%,0.35)" }}
          >
            Vai ai Connettori
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>
    );
  }

  const currentList = tab === "emesse" ? invoices : received;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Receipt className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Fatturazione</h1>
          {ficCompany && (
            <span className="text-xs text-muted-foreground/60 ml-2">({ficCompany})</span>
          )}
        </div>
        <a
          href={"/" + (selectedCompany?.issuePrefix || "") + "/chat?msg=" + encodeURIComponent("Voglio creare una nuova fattura elettronica. Guidami nel processo.")}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white no-underline transition-all"
          style={{ ...greenGradient, boxShadow: "0 4px 20px hsla(158,64%,42%,0.35)" }}
        >
          + Nuova Fattura
        </a>
      </div>

      {/* Tabs */}
      <div className="inline-flex rounded-xl p-1" style={{ background: "rgba(255,255,255,0.06)" }}>
        <button
          onClick={() => setTab("emesse")}
          className={
            "px-5 py-2 rounded-lg text-sm font-medium transition-all " +
            (tab === "emesse" ? "text-white shadow-lg" : "text-muted-foreground hover:text-white/70")
          }
          style={tab === "emesse" ? greenGradient : undefined}
        >
          Emesse ({invoices.length})
        </button>
        <button
          onClick={() => setTab("ricevute")}
          className={
            "px-5 py-2 rounded-lg text-sm font-medium transition-all " +
            (tab === "ricevute" ? "text-white shadow-lg" : "text-muted-foreground hover:text-white/70")
          }
          style={tab === "ricevute" ? greenGradient : undefined}
        >
          Ricevute ({received.length})
        </button>
      </div>

      {/* Invoice list */}
      {currentList.length === 0 ? (
        <div className="rounded-2xl px-6 py-10 text-center" style={glass.cardStyle}>
          <Receipt className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {tab === "emesse" ? "Nessuna fattura emessa trovata." : "Nessuna fattura ricevuta trovata."}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {/* Table header */}
          <div
            className="grid gap-3 px-4 py-2.5 text-[11px] text-muted-foreground/60 font-medium uppercase tracking-wider"
            style={{ gridTemplateColumns: tab === "emesse" ? "80px 90px 1fr 100px 90px 90px 80px" : "90px 1fr 100px 90px" }}
          >
            {tab === "emesse" && <span>Numero</span>}
            <span>Data</span>
            <span>Cliente</span>
            <span className="text-right">Importo</span>
            <span>Stato</span>
            {tab === "emesse" && <span>SDI</span>}
            {tab === "emesse" && <span></span>}
          </div>

          {currentList.map((inv) => (
            <div key={inv.id}>
              <button
                onClick={() => setExpandedId(expandedId === inv.id ? null : inv.id)}
                className="w-full grid gap-3 px-4 py-3 rounded-xl items-center text-left transition-all hover:bg-white/[0.03]"
                style={{
                  gridTemplateColumns: tab === "emesse" ? "80px 90px 1fr 100px 90px 90px 80px" : "90px 1fr 100px 90px",
                  ...(expandedId === inv.id ? { background: "rgba(255,255,255,0.04)" } : {}),
                }}
              >
                {tab === "emesse" && (
                  <span className="text-sm font-mono font-medium">{inv.number || "-"}</span>
                )}
                <span className="text-xs text-muted-foreground">{formatDate(inv.date)}</span>
                <span className="text-sm truncate">{inv.entity?.name || "-"}</span>
                <span className="text-sm font-medium text-right">{formatCurrency(inv.amount_gross)}</span>
                <span>{statusBadge(inv.status)}</span>
                {tab === "emesse" && <span>{sdiStatusBadge(inv.ei_status)}</span>}
                {tab === "emesse" && (
                  <span>
                    {(!inv.ei_status || inv.ei_status === "none" || inv.ei_status === "not_sent") && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSendSdi(inv.id);
                        }}
                        disabled={sendingSdi === inv.id}
                        className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg transition-all"
                        style={{
                          background: "rgba(59, 130, 246, 0.12)",
                          border: "1px solid rgba(59, 130, 246, 0.25)",
                          color: "rgba(147, 197, 253, 0.9)",
                        }}
                      >
                        {sendingSdi === inv.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Send className="h-3 w-3" />
                        )}
                        SDI
                      </button>
                    )}
                  </span>
                )}
              </button>

              {/* Expanded detail */}
              {expandedId === inv.id && (
                <div className="px-4 pb-3 ml-4 space-y-1 text-xs text-muted-foreground border-l border-white/5 ml-6">
                  <div>ID: {inv.id}</div>
                  {inv.number && <div>Numero: {inv.number}</div>}
                  <div>Data: {formatDate(inv.date)}</div>
                  <div>Cliente: {inv.entity?.name || "-"}</div>
                  <div>Importo lordo: {formatCurrency(inv.amount_gross)}</div>
                  <div>Stato pagamento: {inv.status}</div>
                  {tab === "emesse" && <div>Stato SDI: {inv.ei_status || "non inviata"}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

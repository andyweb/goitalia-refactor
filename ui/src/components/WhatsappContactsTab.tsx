import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Upload, ExternalLink, Phone, User, FileText, ChevronDown, ChevronRight, X, Search, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CompanyContact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string;
  sourceId: string | null;
  photoUrl: string | null;
}

// Old whatsapp_contacts detail (for linked contacts)
interface WaContactDetail {
  id: string;
  phoneNumber: string;
  name: string | null;
  notes: string | null;
  customInstructions: string | null;
  autoMode: "auto" | "manual" | "inherit";
  lastSummary: string | null;
  lastSummaryAt: string | null;
  createdAt: string;
  files: ContactFile[];
}

interface ContactFile {
  id: string;
  name: string;
  type: string;
  driveUrl: string | null;
  createdAt: string;
}

const autoModeLabels: Record<string, { label: string; color: string; dot: string }> = {
  auto: { label: "Risposta automatica", color: "bg-white/5 text-white/80 border-white/10 hover:border-green-500/30 hover:bg-green-500/5", dot: "bg-green-400" },
  manual: { label: "Risposta manuale", color: "bg-white/5 text-white/80 border-white/10 hover:border-red-500/30 hover:bg-red-500/5", dot: "bg-red-400" },
  inherit: { label: "Default agente", color: "bg-white/5 text-white/50 border-white/10 hover:border-white/20", dot: "bg-white/30" },
};
const autoModeActive: Record<string, string> = {
  auto: "!bg-green-500/10 !border-green-500/25 !text-green-300",
  manual: "!bg-red-500/10 !border-red-500/25 !text-red-300",
  inherit: "!bg-white/8 !border-white/20 !text-white/70",
};

export function WhatsappContactsTab({ agentId, companyId }: { agentId: string; companyId: string }) {
  const [contacts, setContacts] = useState<CompanyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");


  // Add form state
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newInstructions, setNewInstructions] = useState("");
  const [newAutoMode, setNewAutoMode] = useState<"auto" | "manual" | "inherit">("inherit");

  // WA contact details cache
  const [waDetails, setWaDetails] = useState<Record<string, WaContactDetail | null>>({});

  // File upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [driveUrl, setDriveUrl] = useState("");
  const [driveLinking, setDriveLinking] = useState(false);

  // Load contacts from company_contacts (source=whatsapp)
  const loadContacts = async (q?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ companyId, source: "whatsapp" });
      if (q && q.length >= 2) params.set("q", q);
      const r = await fetch("/api/gmail/contacts/list?" + params, { credentials: "include" });
      if (r.ok) {
        const data = await r.json();
        const sorted = (data.contacts || []).sort((a: CompanyContact, b: CompanyContact) => {
          const nameA = (a.name || a.phone || "").toLowerCase();
          const nameB = (b.name || b.phone || "").toLowerCase();
          return nameA.localeCompare(nameB, "it");
        });
        setContacts(sorted);
      }
    } catch (err) { console.error("Load contacts error:", err); }
    setLoading(false);
  };

  useEffect(() => { loadContacts(); }, [companyId]);

  const doSearch = (q: string) => {
    setSearch(q);
    if (q.length >= 2) loadContacts(q);
    else if (q.length === 0) loadContacts();
  };

  // Load WA detail for a contact (by phone number) - auto-create if missing
  const loadWaDetail = async (phone: string, contactName?: string | null) => {
    if (waDetails[phone] !== undefined) return;
    try {
      const r = await fetch(`/api/whatsapp-contacts?agentId=${agentId}`, { credentials: "include" });
      if (r.ok) {
        const data = await r.json();
        const all = data.contacts || [];
        // Cache all
        const cache: Record<string, WaContactDetail | null> = {};
        for (const c of all) cache[c.phoneNumber] = c;
        
        // If this phone doesn't have a WA record, auto-create one
        if (!cache[phone]) {
          const cr = await fetch("/api/whatsapp-contacts", {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId, agentId,
              phoneNumber: phone,
              name: contactName || null,
              autoMode: "inherit",
            }),
          });
          if (cr.ok) {
            // Reload to get the new record
            const r2 = await fetch(`/api/whatsapp-contacts?agentId=${agentId}`, { credentials: "include" });
            if (r2.ok) {
              const d2 = await r2.json();
              for (const c of (d2.contacts || [])) cache[c.phoneNumber] = c;
            }
          }
        }
        
        setWaDetails(prev => ({ ...prev, ...cache }));
      }
    } catch {}
  };

  // Add contact (to both company_contacts and whatsapp_contacts)
  const addContact = async () => {
    if (!newPhone.trim()) return;
    // Add to company_contacts
    await fetch("/api/gmail/contacts/add", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, source: "whatsapp", phone: newPhone.trim(), name: newName.trim() || null }),
    });
    // Also add to whatsapp_contacts for features
    await fetch("/api/whatsapp-contacts", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId, agentId,
        phoneNumber: newPhone.trim(),
        name: newName.trim() || null,
        notes: newNotes.trim() || null,
        customInstructions: newInstructions.trim() || null,
        autoMode: newAutoMode,
      }),
    });
    setShowAdd(false);
    setNewPhone(""); setNewName(""); setNewNotes(""); setNewInstructions(""); setNewAutoMode("inherit");
    setWaDetails({});
    loadContacts();
  };

  const deleteContact = async (contactId: string, phone: string | null) => {
    if (!confirm("Eliminare questo contatto?")) return;
    await fetch("/api/gmail/contacts/" + contactId, { method: "DELETE", credentials: "include" });
    // Also delete from whatsapp_contacts if exists
    const detail = phone ? waDetails[phone] : null;
    if (detail) {
      await fetch(`/api/whatsapp-contacts/${detail.id}`, { method: "DELETE", credentials: "include" });
    }
    loadContacts(search || undefined);
  };

  const updateWaContact = async (waId: string, data: any) => {
    await fetch(`/api/whatsapp-contacts/${waId}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setWaDetails({});
  };

  const cycleAutoMode = (detail: WaContactDetail) => {
    const modes: Array<"inherit" | "auto" | "manual"> = ["inherit", "auto", "manual"];
    const next = modes[(modes.indexOf(detail.autoMode) + 1) % modes.length];
    updateWaContact(detail.id, { autoMode: next });
  };

  // File operations
  const uploadFile = async (waContactId: string, file: File) => {
    setUploadingFor(waContactId);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("companyId", companyId);
    const r = await fetch(`/api/whatsapp-contacts/${waContactId}/files/upload`, {
      method: "POST", credentials: "include", body: fd,
    });
    if (r.ok) {
      const data = await r.json();
      if (data.isWaChatExport) {
        setUploadingFor("generating-" + waContactId);
        const poll = async (attempts: number) => {
          if (attempts <= 0) { setUploadingFor(null); setWaDetails({}); return; }
          const cr = await fetch(`/api/whatsapp-contacts?agentId=${agentId}`, { credentials: "include" });
          if (cr.ok) {
            const cd = await cr.json();
            const contact = (cd.contacts || []).find((c: any) => c.id === waContactId);
            if (contact) {
              setWaDetails(prev => ({ ...prev, [contact.phoneNumber]: contact }));
              if (data.isWaChatExport && contact.files.length > 1) {
                setUploadingFor(null); return;
              }
            }
          }
          setTimeout(() => poll(attempts - 1), 2000);
        };
        poll(20);
        return;
      }
    }
    setUploadingFor(null);
    setWaDetails({});
  };

  const addDriveLink = async (waContactId: string) => {
    if (!driveUrl.trim()) return;
    setDriveLinking(true);
    await fetch(`/api/whatsapp-contacts/${waContactId}/files/drive-link`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, driveUrl: driveUrl.trim() }),
    });
    setDriveUrl(""); setDriveLinking(false); setWaDetails({});
  };

  const deleteFile = async (waContactId: string, fileId: string) => {
    await fetch(`/api/whatsapp-contacts/${waContactId}/files/${fileId}`, { method: "DELETE", credentials: "include" });
    setWaDetails({});
  };



  if (loading && contacts.length === 0) return <div className="text-sm text-muted-foreground p-4">Caricamento rubrica...</div>;

  return (
    <div className="flex flex-col h-full" style={{ maxHeight: "calc(100vh - 200px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold">Rubrica Contatti</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {contacts.length} contatt{contacts.length === 1 ? "o" : "i"} · Personalizza risposte e automazione
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? <X className="w-4 h-4 mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
          {showAdd ? "Annulla" : "Aggiungi"}
        </Button>
      </div>

      {/* Search */}
      <div className="relative flex items-center mb-3">
        <Search className="absolute left-3 w-4 h-4 text-white/30 pointer-events-none" />
        <input
          placeholder="Cerca per nome o numero..."
          value={search}
          onChange={e => doSearch(e.target.value)}
          className="w-full h-9 rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 focus:bg-white/8 transition-colors"
        />
      </div>

      {/* Add contact form */}
      {showAdd && (
        <div className="glass-card p-5 space-y-4 mb-3">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/70">Numero telefono *</label>
              <input placeholder="+393401234567" value={newPhone} onChange={e => setNewPhone(e.target.value)}
                className="w-full h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 focus:bg-white/8 transition-colors" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/70">Nome</label>
              <input placeholder="Mario Rossi" value={newName} onChange={e => setNewName(e.target.value)}
                className="w-full h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 focus:bg-white/8 transition-colors" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-white/70">Note</label>
            <textarea className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 focus:bg-white/8 transition-colors resize-none" rows={2}
              placeholder="Note sul contatto..." value={newNotes} onChange={e => setNewNotes(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-white/70">Istruzioni personalizzate per l'agente</label>
            <textarea className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 focus:bg-white/8 transition-colors resize-none" rows={2}
              placeholder="Es: Rispondi sempre in inglese con questo cliente..." value={newInstructions} onChange={e => setNewInstructions(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs font-medium text-white/70 mr-1">Modalità risposta:</span>
            {(["inherit", "auto", "manual"] as const).map(mode => (
              <button key={mode} onClick={() => setNewAutoMode(mode)}
                className={`inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg border backdrop-blur-sm transition-all ${newAutoMode === mode ? autoModeLabels[mode].color + " " + autoModeActive[mode] : "border-white/10 text-white/30 hover:text-white/50 hover:border-white/20"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${newAutoMode === mode ? autoModeLabels[mode].dot : "bg-white/20"}`} />
                {autoModeLabels[mode].label}
              </button>
            ))}
          </div>
          <div className="pt-1">
            <Button size="sm" onClick={addContact} disabled={!newPhone.trim()}>Salva contatto</Button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && contacts.length === 0 && !showAdd && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          <Phone className="w-8 h-8 mx-auto mb-2 opacity-30" />
          Nessun contatto. Sincronizza dai Connettori.
        </div>
      )}

      {/* Contact list */}
      {contacts.length > 0 && (
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ maxHeight: "calc(100vh - 340px)" }}>
          {contacts.map(contact => {
            const expanded = expandedId === contact.id;
            const detail = contact.phone ? waDetails[contact.phone] : null;

            // Auto-load WA detail when expanded
            if (expanded && contact.phone && waDetails[contact.phone] === undefined) {
              loadWaDetail(contact.phone, contact.name);
            }

            const mode = detail ? (autoModeLabels[detail.autoMode] || autoModeLabels.inherit) : null;

            return (
              <div key={contact.id} className={`glass-card mb-1.5 transition-all duration-200 ${expanded ? "border-white/15 shadow-lg" : "hover:border-white/12"}`}>
                <div className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer"
                  onClick={() => setExpandedId(expanded ? null : contact.id)}>
                  {contact.photoUrl ? (
                    <img src={contact.photoUrl} className="w-9 h-9 rounded-full object-cover shrink-0" alt="" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-gradient-to-b from-white/15 to-white/5 flex items-center justify-center shrink-0">
                      <span className="text-sm font-semibold text-white/60">
                        {(contact.name || contact.phone || "?").charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-white/90 truncate">{contact.name || contact.phone}</span>
                      {contact.name && <span className="text-[11px] text-white/30">{contact.phone}</span>}
                    </div>
                  </div>
                  {detail && mode && (
                    <button onClick={(e) => { e.stopPropagation(); cycleAutoMode(detail); }}
                      className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg border backdrop-blur-sm shrink-0 transition-all ${mode.color} ${autoModeActive[detail.autoMode] || ""}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${mode.dot}`} />
                      {mode.label}
                    </button>
                  )}
                  {detail && detail.files.length > 0 && (
                    <span className="text-xs text-muted-foreground shrink-0">{detail.files.length} file</span>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); deleteContact(contact.id, contact.phone); }}
                    className="text-red-400/40 hover:text-red-400 shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Expanded details */}
                {expanded && detail && (
                  <div className="border-t border-white/8 p-4 space-y-4 rounded-b-2xl" style={{ background: "rgba(255,255,255,0.04)" }}>
                    {detail.lastSummary && (
                      <div className="rounded-lg bg-amber-500/8 border border-amber-500/15 p-3">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <MessageSquare className="w-3 h-3 text-amber-400/70" />
                          <span className="text-[10px] font-semibold text-amber-400/70 uppercase tracking-wider">Ultimo riassunto</span>
                          {detail.lastSummaryAt && <span className="text-[10px] text-white/25 ml-auto">{new Date(detail.lastSummaryAt).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
                        </div>
                        <p className="text-xs text-white/70 whitespace-pre-line leading-relaxed">{detail.lastSummary}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <EditableField label="Nome" value={detail.name || ""} onSave={v => updateWaContact(detail.id, { name: v || null })} />
                      <EditableField label="Note" value={detail.notes || ""} onSave={v => updateWaContact(detail.id, { notes: v || null })} />
                    </div>
                    <EditableField label="Istruzioni agente" value={detail.customInstructions || ""} onSave={v => updateWaContact(detail.id, { customInstructions: v || null })} multiline />
                    {detail.files.length === 0 && (
                      <div className="rounded-lg bg-blue-500/5 border border-blue-500/15 px-3 py-2.5 flex items-start gap-2.5">
                        <Upload className="w-4 h-4 text-blue-400/60 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-[11px] text-white/70 leading-relaxed">
                            <span className="font-medium text-white/90">Esporta la chat WhatsApp</span> con questo contatto (senza media) e caricala qui.
                          </p>
                          <p className="text-[10px] text-white/30 mt-1">WhatsApp → Chat → Esporta chat → Senza media</p>
                        </div>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-4">
                        <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">File</span>
                        <input type="file" ref={fileInputRef} className="hidden" onChange={e => {
                          if (e.target.files?.[0]) uploadFile(detail.id, e.target.files[0]);
                          e.target.value = "";
                        }} />
                        <button className="text-[10px] text-white/30 hover:text-white/60 transition-colors" onClick={() => fileInputRef.current?.click()} disabled={!!uploadingFor}>
                          {uploadingFor === detail.id ? "Caricamento..." : uploadingFor === "generating-" + detail.id ? <span className="shiny-text">Generando istruzioni AI...</span> : "+ Upload"}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {detail.files.map(file => (
                          <div key={file.id} className="inline-flex items-center gap-1.5 text-[11px] rounded-md bg-white/5 border border-white/8 px-2 py-1 group">
                            <FileText className="w-3 h-3 text-amber-400/70 shrink-0" />
                            <span className="text-white/60 max-w-[120px] truncate">{file.name}</span>
                            {file.driveUrl && (
                              <a href={file.driveUrl} target="_blank" rel="noopener" className="text-blue-400/50 hover:text-blue-400" onClick={e => e.stopPropagation()}>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            )}
                            <button onClick={() => deleteFile(detail.id, file.id)} className="text-white/0 group-hover:text-white/30 hover:!text-red-400 transition-colors">
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input placeholder="Link Google Drive..." className="flex-1 h-6 rounded border border-white/8 bg-transparent px-2 text-[11px] text-white/50 placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors"
                          value={driveUrl} onChange={e => setDriveUrl(e.target.value)} />
                        {driveUrl.trim() && (
                          <button className="text-[10px] text-white/40 hover:text-white/70" onClick={() => addDriveLink(detail.id)} disabled={driveLinking}>
                            {driveLinking ? "..." : "Aggiungi"}
                          </button>
                        )}
                      </div>
                    </div>
                    <ConversationHistory contactId={detail.id} />
                  </div>
                )}

                {expanded && !detail && waDetails[contact.phone || ""] === null && (
                  <div className="border-t border-white/8 p-4 space-y-2 rounded-b-2xl" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div><span className="text-white/35">Telefono</span> <span className="text-white/75 ml-1">{contact.phone || "—"}</span></div>
                      <div><span className="text-white/35">Email</span> <span className="text-white/75 ml-1">{contact.email || "—"}</span></div>
                    </div>
                  </div>
                )}

                {expanded && !detail && waDetails[contact.phone || ""] === undefined && (
                  <div className="border-t border-white/8 p-3 rounded-b-2xl" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <p className="text-xs text-white/30">Caricamento dettagli...</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Sub-components ---

interface WaMessage {
  message_text: string;
  direction: "incoming" | "outgoing";
  from_name: string;
  message_type: string;
  media_url: string | null;
  created_at: string;
}

function ConversationHistory({ contactId }: { contactId: string }) {
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (messages.length > 0) { setOpen(!open); return; }
    setLoading(true); setOpen(true);
    try {
      const r = await fetch(`/api/whatsapp-contacts/${contactId}/messages?limit=50`, { credentials: "include" });
      if (r.ok) { const data = await r.json(); setMessages(data.messages || []); }
    } catch {}
    setLoading(false);
  };

  const groupByDate = (msgs: WaMessage[]) => {
    const groups: Record<string, WaMessage[]> = {};
    for (const m of msgs) {
      const date = new Date(m.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
      if (!groups[date]) groups[date] = [];
      groups[date].push(m);
    }
    return groups;
  };

  return (
    <div className="space-y-2 pt-2">
      <button onClick={load} className="flex items-center gap-2 text-xs font-medium text-white/70 hover:text-white/90 transition-colors">
        <MessageSquare className="w-3.5 h-3.5" />
        <span>Storico conversazioni</span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {messages.length > 0 && <span className="text-white/30">({messages.length} msg)</span>}
      </button>
      {open && (
        <div className="max-h-80 overflow-y-auto rounded-lg border border-white/8 bg-black/20">
          {loading && <div className="p-3 text-xs text-white/30">Caricamento...</div>}
          {!loading && messages.length === 0 && <div className="p-3 text-xs text-white/30">Nessun messaggio</div>}
          {!loading && Object.entries(groupByDate(messages)).map(([date, msgs]) => (
            <div key={date}>
              <div className="sticky top-0 bg-black/40 backdrop-blur-sm px-3 py-1 text-[10px] text-white/30 font-medium">{date}</div>
              {msgs.map((m, i) => {
                const time = new Date(m.created_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
                const isOut = m.direction === "outgoing";
                return (
                  <div key={i} className={`px-3 py-1.5 flex gap-2 ${isOut ? "flex-row-reverse" : ""}`}>
                    <div className={`max-w-[80%] rounded-lg px-2.5 py-1.5 text-xs ${isOut ? "bg-green-900/30 text-green-200/90 ml-auto" : "bg-white/8 text-white/70"}`}>
                      <div>{m.message_text || `[${m.message_type}]`}</div>
                      <div className={`text-[10px] mt-0.5 ${isOut ? "text-green-300/40 text-right" : "text-white/25"}`}>{time}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EditableField({ label, value, onSave, multiline }: { label: string; value: string; onSave: (v: string) => void; multiline?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  useEffect(() => { setVal(value); }, [value]);

  if (!editing) {
    return (
      <div className="flex items-start gap-2 text-xs cursor-pointer hover:bg-white/5 rounded-lg px-3 py-2 -mx-1 transition-colors" onClick={() => setEditing(true)}>
        <span className="text-white/40 shrink-0 w-28 font-medium">{label}:</span>
        <span className={value ? "text-white/80" : "text-white/25 italic"}>{value || "Clicca per aggiungere"}</span>
      </div>
    );
  }

  const save = () => { onSave(val); setEditing(false); };
  return (
    <div className="space-y-1.5 px-3 -mx-1">
      <span className="text-xs font-medium text-white/50">{label}</span>
      {multiline ? (
        <textarea className="w-full rounded-lg border border-white/15 bg-white/8 px-3 py-2 text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-white/30 transition-colors resize-none" rows={2} value={val} onChange={e => setVal(e.target.value)} onBlur={save} autoFocus />
      ) : (
        <input className="w-full h-7 rounded-lg border border-white/15 bg-white/8 px-3 text-xs text-white focus:outline-none focus:border-white/30 transition-colors" value={val} onChange={e => setVal(e.target.value)} onBlur={save} onKeyDown={e => e.key === "Enter" && save()} autoFocus />
      )}
    </div>
  );
}

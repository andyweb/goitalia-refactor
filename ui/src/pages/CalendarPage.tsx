import { useState, useEffect } from "react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Calendar as CalIcon, ChevronLeft, ChevronRight, Clock, MapPin } from "lucide-react";

interface CalEvent {
  id: string;
  title: string;
  description: string;
  start: string;
  end: string;
  location: string;
  allDay: boolean;
  htmlLink: string;
}

export function CalendarPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  useEffect(() => { setBreadcrumbs([{ label: "Calendario" }]); }, [setBreadcrumbs]);

  const fetchEvents = async () => {
    if (!selectedCompany?.id) return;
    setLoading(true);
    const y = currentMonth.getFullYear();
    const m = currentMonth.getMonth();
    const timeMin = new Date(y, m, 1).toISOString();
    const timeMax = new Date(y, m + 1, 0, 23, 59, 59).toISOString();
    try {
      const res = await fetch(`/api/calendar/events?companyId=${selectedCompany.id}&timeMin=${timeMin}&timeMax=${timeMax}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) { setError(data.error); setLoading(false); return; }
      setEvents(data.events || []);
    } catch { setError("Errore connessione"); }
    setLoading(false);
  };

  useEffect(() => { fetchEvents(); }, [selectedCompany?.id, currentMonth]);

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));

  const monthName = currentMonth.toLocaleDateString("it-IT", { month: "long", year: "numeric" });

  // Group events by day
  const eventsByDay = new Map<number, CalEvent[]>();
  for (const ev of events) {
    const d = new Date(ev.start).getDate();
    if (!eventsByDay.has(d)) eventsByDay.set(d, []);
    eventsByDay.get(d)!.push(ev);
  }

  // Build calendar grid
  const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const offset = firstDay === 0 ? 6 : firstDay - 1; // Monday first
  const today = new Date();
  const isCurrentMonth = today.getMonth() === currentMonth.getMonth() && today.getFullYear() === currentMonth.getFullYear();

  const formatTime = (dateStr: string) => {
    try { return new Date(dateStr).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
  };

  if (error && !events.length) return (
    <div className="p-6">
      <div className="glass-card p-6 text-center space-y-3">
        <CalIcon className="w-10 h-10 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <a href={`/${selectedCompany?.issuePrefix || ""}/plugins`} className="text-sm text-green-400 hover:underline">Vai su Plugin per collegare Google</a>
      </div>
    </div>
  );

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalIcon className="w-5 h-5" />
          <h1 className="text-xl font-semibold">Calendario</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-white/10"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-sm font-medium capitalize min-w-[140px] text-center">{monthName}</span>
          <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-white/10"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      {loading ? <div className="text-sm text-muted-foreground p-4">Caricamento...</div> : (
        <>
          {/* Calendar grid */}
          <div className="glass-card overflow-hidden">
            <div className="grid grid-cols-7 text-xs text-muted-foreground text-center py-2 border-b border-white/5">
              {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((d) => <div key={d}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {Array.from({ length: offset }).map((_, i) => <div key={"e" + i} className="min-h-[80px] border-b border-r border-white/5" />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dayEvents = eventsByDay.get(day) || [];
                const isToday = isCurrentMonth && today.getDate() === day;
                return (
                  <div key={day} className={"min-h-[80px] p-1 border-b border-r border-white/5 " + (isToday ? "bg-green-500/5" : "")}>
                    <div className={"text-xs font-medium mb-1 " + (isToday ? "text-green-400" : "text-muted-foreground")}>{day}</div>
                    {dayEvents.slice(0, 3).map((ev) => (
                      <a key={ev.id} href={ev.htmlLink} target="_blank" rel="noopener noreferrer"
                        className="block text-[10px] leading-tight px-1 py-0.5 mb-0.5 rounded truncate hover:bg-white/10 transition-colors"
                        style={{ background: "rgba(66, 133, 244, 0.15)", color: "rgba(255,255,255,0.85)" }}>
                        {ev.allDay ? "" : formatTime(ev.start) + " "}{ev.title}
                      </a>
                    ))}
                    {dayEvents.length > 3 && <div className="text-[10px] text-muted-foreground px-1">+{dayEvents.length - 3}</div>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Event list */}
          {events.length > 0 && (
            <div className="glass-card divide-y divide-white/5">
              {events.map((ev) => (
                <a key={ev.id} href={ev.htmlLink} target="_blank" rel="noopener noreferrer" className="flex items-start gap-3 px-4 py-3 hover:bg-white/5 transition-colors no-underline">
                  <div className="w-1 h-8 rounded-full bg-blue-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{ev.title}</div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{ev.allDay ? "Tutto il giorno" : formatTime(ev.start) + " - " + formatTime(ev.end)}</span>
                      {ev.location && <span className="flex items-center gap-1 truncate"><MapPin className="w-3 h-3" />{ev.location}</span>}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">{new Date(ev.start).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}</div>
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

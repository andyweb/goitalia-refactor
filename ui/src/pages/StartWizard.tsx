import { useState } from "react";
import { Plus, Trash2, Users, Building2, CreditCard, CheckCircle, ArrowRight, ArrowLeft } from "lucide-react";

// Types
interface TeamMember {
  id: string;
  name: string;
  role: string;
  department: string;
  software: string;
  description: string;
}

interface CompanyData {
  ragioneSociale: string;
  partitaIva: string;
  indirizzo: string;
  citta: string;
  cap: string;
  email: string;
  whatsapp: string;
}

// Step indicator
function StepIndicator({ currentStep }: { currentStep: number }) {
  const steps = [
    { num: 1, label: "Team", icon: Users },
    { num: 2, label: "Organigramma AI", icon: Building2 },
    { num: 3, label: "Dati Azienda", icon: Building2 },
    { num: 4, label: "Pagamento", icon: CreditCard },
  ];

  return (
    <div className="flex items-center justify-center gap-2 mb-10">
      {steps.map((step, i) => (
        <div key={step.num} className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
              currentStep === step.num
                ? "bg-emerald-500 text-white"
                : currentStep > step.num
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-zinc-800 text-zinc-500"
            }`}
          >
            {currentStep > step.num ? <CheckCircle className="w-4 h-4" /> : step.num}
          </div>
          <span
            className={`text-xs font-medium hidden sm:block ${
              currentStep === step.num ? "text-white" : "text-zinc-500"
            }`}
          >
            {step.label}
          </span>
          {i < steps.length - 1 && <div className="w-8 h-px bg-zinc-700 mx-1" />}
        </div>
      ))}
    </div>
  );
}

// Step 1: Team members
function Step1Team({
  members,
  setMembers,
  onNext,
}: {
  members: TeamMember[];
  setMembers: (m: TeamMember[]) => void;
  onNext: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    role: "",
    department: "",
    software: "",
    description: "",
  });

  const resetForm = () => {
    setForm({ name: "", role: "", department: "", software: "", description: "" });
    setEditingId(null);
    setShowForm(false);
  };

  const addOrUpdateMember = () => {
    if (!form.name || !form.role || !form.department) return;

    if (editingId) {
      setMembers(
        members.map((m) =>
          m.id === editingId ? { ...m, ...form } : m
        )
      );
    } else {
      setMembers([
        ...members,
        { id: crypto.randomUUID(), ...form },
      ]);
    }
    resetForm();
  };

  const editMember = (member: TeamMember) => {
    setForm({
      name: member.name,
      role: member.role,
      department: member.department,
      software: member.software,
      description: member.description,
    });
    setEditingId(member.id);
    setShowForm(true);
  };

  const removeMember = (id: string) => {
    setMembers(members.filter((m) => m.id !== id));
  };

  // Group by department
  const departments = members.reduce<Record<string, TeamMember[]>>((acc, m) => {
    if (!acc[m.department]) acc[m.department] = [];
    acc[m.department].push(m);
    return acc;
  }, {});

  return (
    <div>
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">Descrivi il tuo team</h2>
        <p className="text-zinc-400 text-sm">
          Aggiungi i membri della tua azienda. Per ogni persona, indicaci il ruolo, il reparto e cosa fa.
        </p>
      </div>

      {/* Member list grouped by department */}
      {Object.keys(departments).length > 0 && (
        <div className="space-y-6 mb-6">
          {Object.entries(departments).map(([dept, deptMembers]) => (
            <div key={dept}>
              <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-3">
                {dept}
              </h3>
              <div className="space-y-2">
                {deptMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-4 rounded-xl bg-zinc-800/50 border border-zinc-700/50 hover:border-zinc-600 transition-colors cursor-pointer"
                    onClick={() => editMember(member)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white text-sm">{member.name}</span>
                        <span className="text-xs text-zinc-500">·</span>
                        <span className="text-xs text-zinc-400">{member.role}</span>
                      </div>
                      {member.description && (
                        <p className="text-xs text-zinc-500 mt-1 truncate">{member.description}</p>
                      )}
                      {member.software && (
                        <div className="flex gap-1.5 mt-1.5 flex-wrap">
                          {member.software.split(",").map((s, i) => (
                            <span
                              key={i}
                              className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-700/50 text-zinc-400"
                            >
                              {s.trim()}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeMember(member.id);
                      }}
                      className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit form */}
      {showForm ? (
        <div className="rounded-xl border border-zinc-700 bg-zinc-800/50 p-5 mb-6">
          <h3 className="text-sm font-semibold text-white mb-4">
            {editingId ? "Modifica membro" : "Nuovo membro del team"}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Nome *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="es. Marco Rossi"
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-sm placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Ruolo *</label>
              <input
                type="text"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                placeholder="es. Responsabile vendite"
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-sm placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Reparto *</label>
              <input
                type="text"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
                placeholder="es. Commerciale"
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-sm placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Software utilizzati</label>
              <input
                type="text"
                value={form.software}
                onChange={(e) => setForm({ ...form, software: e.target.value })}
                placeholder="es. Excel, Salesforce, WhatsApp"
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-sm placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-zinc-400 mb-1 block">Descrizione del compito</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="es. Gestisce i contatti con i clienti, prepara preventivi, segue il post-vendita"
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-sm placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none resize-none"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={resetForm}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
            >
              Annulla
            </button>
            <button
              onClick={addOrUpdateMember}
              disabled={!form.name || !form.role || !form.department}
              className="px-4 py-2 text-sm font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {editingId ? "Salva modifiche" : "Aggiungi"}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-zinc-700 text-zinc-400 hover:text-emerald-400 hover:border-emerald-500/50 transition-colors text-sm mb-6"
        >
          <Plus className="w-4 h-4" />
          Aggiungi membro del team
        </button>
      )}

      {/* Next button */}
      <div className="flex justify-end">
        <button
          onClick={onNext}
          disabled={members.length === 0}
          className="flex items-center gap-2 px-6 py-3 bg-emerald-500 text-white font-medium rounded-xl hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Genera organigramma AI
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// Step 2: AI Organigramma (placeholder — will call Claude)
function Step2Organigramma({
  members,
  onNext,
  onBack,
}: {
  members: TeamMember[];
  onNext: () => void;
  onBack: () => void;
}) {
  // Group by department for display
  const departments = members.reduce<Record<string, TeamMember[]>>((acc, m) => {
    if (!acc[m.department]) acc[m.department] = [];
    acc[m.department].push(m);
    return acc;
  }, {});

  return (
    <div>
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">Il tuo organigramma AI</h2>
        <p className="text-zinc-400 text-sm">
          Ecco come i tuoi agenti AI sostituiranno il team attuale. Conferma per procedere.
        </p>
      </div>

      {/* CEO node */}
      <div className="flex flex-col items-center mb-6">
        <div className="px-6 py-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-center">
          <p className="text-emerald-400 font-bold text-sm">CEO / Titolare</p>
          <p className="text-zinc-500 text-xs">{members.length} Agenti AI</p>
        </div>
        <div className="w-px h-6 bg-zinc-700" />
      </div>

      {/* Departments */}
      <div className={`grid gap-4 mb-8 ${
        Object.keys(departments).length <= 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
      }`}>
        {Object.entries(departments).map(([dept, deptMembers]) => (
          <div
            key={dept}
            className="rounded-xl border border-zinc-700/50 bg-zinc-800/30 overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-zinc-700/50 bg-zinc-800/50">
              <p className="text-white font-semibold text-sm">{dept}</p>
              <p className="text-zinc-500 text-xs">{deptMembers.length} agenti</p>
            </div>
            <div className="p-3 space-y-2">
              {deptMembers.map((member) => (
                <div
                  key={member.id}
                  className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-700/30"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-6 h-6 rounded-full bg-emerald-500/15 flex items-center justify-center">
                      <Users className="w-3 h-3 text-emerald-400" />
                    </div>
                    <span className="text-white text-sm font-medium">Agente {member.name}</span>
                  </div>
                  <p className="text-zinc-500 text-xs pl-8">{member.role}</p>
                  {member.description && (
                    <p className="text-zinc-600 text-xs pl-8 mt-0.5">{member.description}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2.5 text-zinc-400 hover:text-white transition-colors text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Indietro
        </button>
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-6 py-3 bg-emerald-500 text-white font-medium rounded-xl hover:bg-emerald-600 transition-colors"
        >
          Conferma organigramma
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// Step 3: Company data
function Step3CompanyData({
  companyData,
  setCompanyData,
  onNext,
  onBack,
}: {
  companyData: CompanyData;
  setCompanyData: (d: CompanyData) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const update = (field: keyof CompanyData, value: string) => {
    setCompanyData({ ...companyData, [field]: value });
  };

  const isValid =
    companyData.ragioneSociale &&
    companyData.partitaIva &&
    companyData.email;

  return (
    <div>
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">Dati della tua azienda</h2>
        <p className="text-zinc-400 text-sm">
          Inserisci i dati della tua azienda per completare la registrazione.
        </p>
      </div>

      <div className="space-y-4 max-w-lg mx-auto">
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">Ragione Sociale *</label>
          <input
            type="text"
            value={companyData.ragioneSociale}
            onChange={(e) => update("ragioneSociale", e.target.value)}
            placeholder="es. Mario Rossi S.r.l."
            className="w-full px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-sm placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Partita IVA *</label>
            <input
              type="text"
              value={companyData.partitaIva}
              onChange={(e) => update("partitaIva", e.target.value)}
              placeholder="es. 01234567890"
              className="w-full px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-sm placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">CAP</label>
            <input
              type="text"
              value={companyData.cap}
              onChange={(e) => update("cap", e.target.value)}
              placeholder="es. 00100"
              className="w-full px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-sm placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Indirizzo</label>
            <input
              type="text"
              value={companyData.indirizzo}
              onChange={(e) => update("indirizzo", e.target.value)}
              placeholder="es. Via Roma 1"
              className="w-full px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-sm placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Città</label>
            <input
              type="text"
              value={companyData.citta}
              onChange={(e) => update("citta", e.target.value)}
              placeholder="es. Roma"
              className="w-full px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-sm placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Email *</label>
            <input
              type="email"
              value={companyData.email}
              onChange={(e) => update("email", e.target.value)}
              placeholder="es. info@azienda.it"
              className="w-full px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-sm placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">WhatsApp</label>
            <input
              type="text"
              value={companyData.whatsapp}
              onChange={(e) => update("whatsapp", e.target.value)}
              placeholder="es. +39 333 1234567"
              className="w-full px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-sm placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-between mt-8">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2.5 text-zinc-400 hover:text-white transition-colors text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Indietro
        </button>
        <button
          onClick={onNext}
          disabled={!isValid}
          className="flex items-center gap-2 px-6 py-3 bg-emerald-500 text-white font-medium rounded-xl hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Procedi al pagamento
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// Step 4: Payment (placeholder)
function Step4Payment({ onBack }: { onBack: () => void }) {
  return (
    <div>
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">Completa il pagamento</h2>
        <p className="text-zinc-400 text-sm">
          Dopo il pagamento, i tuoi agenti AI saranno attivi immediatamente.
        </p>
      </div>

      <div className="max-w-md mx-auto rounded-xl border border-zinc-700 bg-zinc-800/50 p-6 text-center">
        <p className="text-zinc-400 text-sm mb-6">
          Integrazione Stripe in arrivo. Per ora contattaci su WhatsApp per attivare il tuo account.
        </p>
        <a
          href="https://wa.me/34625976744?text=Ciao%20Emanuele%2C%20ho%20completato%20l%27onboarding%20su%20GoItalia%20Impresa%20e%20vorrei%20attivare%20il%20mio%20account."
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-500 text-white font-medium rounded-xl hover:bg-emerald-600 transition-colors"
        >
          Contattaci su WhatsApp
          <ArrowRight className="w-4 h-4" />
        </a>
      </div>

      <div className="flex justify-start mt-8">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2.5 text-zinc-400 hover:text-white transition-colors text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Indietro
        </button>
      </div>
    </div>
  );
}

// Main wizard
export function StartWizard() {
  const [step, setStep] = useState(1);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [companyData, setCompanyData] = useState<CompanyData>({
    ragioneSociale: "",
    partitaIva: "",
    indirizzo: "",
    citta: "",
    cap: "",
    email: "",
    whatsapp: "",
  });

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <span className="text-xl font-bold">
            <span className="text-red-500">GO</span>{" "}
            <span className="text-white">ITAL</span>{" "}
            <span className="text-emerald-500">IA</span>
          </span>
          <p className="text-zinc-500 text-xs mt-1">Impresa</p>
        </div>

        <StepIndicator currentStep={step} />

        {step === 1 && (
          <Step1Team
            members={members}
            setMembers={setMembers}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <Step2Organigramma
            members={members}
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
          />
        )}
        {step === 3 && (
          <Step3CompanyData
            companyData={companyData}
            setCompanyData={setCompanyData}
            onNext={() => setStep(4)}
            onBack={() => setStep(2)}
          />
        )}
        {step === 4 && <Step4Payment onBack={() => setStep(3)} />}
      </div>
    </div>
  );
}

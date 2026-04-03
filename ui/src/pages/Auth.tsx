import { useRef, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";

type Mode = "login" | "register";
type AccountType = "privato" | "azienda";

export function AuthPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const justRegistered = useRef(false);
  const loginInProgress = useRef(false);
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>("login");
  const [accountType, setAccountType] = useState<AccountType>("privato");
  const [companyName, setCompanyName] = useState("");
  const [nome, setNome] = useState("");
  const [cognome, setCognome] = useState("");
  const [codiceFiscale, setCodiceFiscale] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const nextPath = useMemo(() => searchParams.get("next") || "/", [searchParams]);
  const { data: session, isLoading } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });

  useEffect(() => {
    if (session && !loginInProgress.current) navigate(justRegistered.current ? "/api-claude" : (searchParams.get("next") || "/"), { replace: true });
  }, [session, navigate, nextPath]);

  const loginMutation = useMutation({
    mutationFn: () => { loginInProgress.current = true; return authApi.signInEmail({ email: email.trim(), password }); },
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      // If explicit next param, use it
      const next = searchParams.get("next");
      if (next && next !== "/" && next !== "/%2F") { navigate(next, { replace: true }); return; }
      // Check if first company has API key, if not go to api-claude
      const companies = await queryClient.fetchQuery({ queryKey: queryKeys.companies.all }) as any[];
      if (companies?.length > 0) {
        const prefix = companies[0].issuePrefix;
        try {
          const res = await fetch("/api/onboarding/claude-key/" + companies[0].id, { credentials: "include" });
          const data = await res.json();
          if (!data.hasKey) { navigate("/" + prefix + "/api-claude", { replace: true }); return; }
        } catch {}
        // Check onboarding step from DB
        try {
          const stepRes = await fetch("/api/onboarding/onboarding-step/" + companies[0].id, { credentials: "include" });
          const stepData = await stepRes.json();
          if (stepData.step === 0) { window.location.href = "/" + prefix + "/api-claude"; return; }
          if (stepData.step === 1) { window.location.href = "/" + prefix + "/chat"; return; }
          if (stepData.step === 2) { window.location.href = "/" + prefix + "/chat"; return; }
          if (stepData.step === 3) { window.location.href = "/" + prefix + "/plugins"; return; }
        } catch {}
        navigate("/" + prefix + "/dashboard", { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Credenziali non valide"),
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      // Call activate which does signup + company creation in one step
      const res = await fetch("/api/onboarding/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: accountType === "azienda" ? companyName.trim() : `${cognome.trim()} ${nome.trim()}`.trim(),
          email: email.trim(),
          password,
          members: [],
          accountType,
          ...(accountType === "privato" ? { nome: nome.trim(), cognome: cognome.trim(), codiceFiscale: codiceFiscale.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Errore nella registrazione");
      }
      // Now sign in to get session
      justRegistered.current = true;
      await authApi.signInEmail({ email: email.trim(), password });
    },
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      // Wait for companies to load, then navigate with prefix
      const companies = queryClient.getQueryData<any[]>(queryKeys.companies.all) ?? [];
      if (companies.length > 0) {
        navigate("/" + companies[0].issuePrefix + "/api-claude", { replace: true });
      } else {
        // Fallback: refetch and try again
        const res = await queryClient.fetchQuery({ queryKey: queryKeys.companies.all });
        const list = (res as any[]) ?? [];
        if (list.length > 0) {
          navigate("/" + list[0].issuePrefix + "/api-claude", { replace: true });
        } else {
          navigate("/api-claude", { replace: true });
        }
      }
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("422") || msg.includes("409")) {
        setError("Questa email è già registrata. Prova ad accedere.");
      } else {
        setError(msg || "Registrazione fallita. Riprova.");
      }
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "login") {
      if (!email.trim() || !password) { setError("Inserisci email e password"); return; }
      loginMutation.mutate();
    } else {
      if (accountType === "privato") {
        if (!cognome.trim()) { setError("Il cognome è obbligatorio"); return; }
        if (!nome.trim()) { setError("Il nome è obbligatorio"); return; }
      } else {
        if (!companyName.trim()) { setError("La ragione sociale è obbligatoria"); return; }
      }
      if (!email.trim()) { setError("L'email è obbligatoria"); return; }
      if (password.length < 8) { setError("La password deve avere almeno 8 caratteri"); return; }
      if (password !== confirmPassword) { setError("Le password non corrispondono"); return; }
      registerMutation.mutate();
    }
  }

  const isPending = loginMutation.isPending || registerMutation.isPending;

  if (isLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Caricamento...</p>
      </div>
    );
  }

  const inputStyle = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "hsl(0 0% 98%)",
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{
      background: `
        radial-gradient(ellipse at 20% 20%, rgba(39, 176, 125, 0.15) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 10%, rgba(64, 191, 170, 0.08) 0%, transparent 40%),
        radial-gradient(ellipse at 50% 60%, rgba(39, 176, 125, 0.06) 0%, transparent 50%),
        linear-gradient(rgb(15, 22, 36), rgb(12, 16, 24), rgb(9, 11, 17))
      `,
    }}>
      <div
        className="w-full max-w-md overflow-hidden"
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.01) 100%)",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(40px)",
          WebkitBackdropFilter: "blur(40px)",
          borderRadius: "2rem",
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
        }}
      >
        {/* Green accent top */}
        <div className="h-1" style={{ background: "linear-gradient(90deg, hsl(158 64% 42%), hsl(170 50% 50%), hsl(158 64% 42%))" }} />

        <div className="p-8">
          {/* Logo */}
          <div className="text-center mb-6">
            <h1 className="text-2xl font-black tracking-tight">
              <span style={{ color: "hsl(0 65% 50%)" }}>GO</span>{" "}
              <span className="text-white">ITAL</span>{" "}
              <span style={{ color: "hsl(158 64% 42%)" }}>IA</span>
            </h1>
            <p className="text-xs mt-2" style={{ color: "hsl(215 20% 55%)" }}>
              La tua impresa, potenziata dall'AI
            </p>
          </div>

          {/* Tab switch */}
          <div className="flex gap-1 p-1 rounded-xl mb-6" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <button
              className="flex-1 py-2 rounded-lg text-sm font-medium transition-all"
              style={mode === "login" ? {
                background: "linear-gradient(135deg, hsl(158 64% 42% / 0.25), hsl(158 64% 42% / 0.15))",
                color: "white",
              } : { color: "hsl(215 20% 55%)" }}
              onClick={() => { setMode("login"); setError(null); }}
            >
              Accedi
            </button>
            <button
              className="flex-1 py-2 rounded-lg text-sm font-medium transition-all"
              style={mode === "register" ? {
                background: "linear-gradient(135deg, hsl(158 64% 42% / 0.25), hsl(158 64% 42% / 0.15))",
                color: "white",
              } : { color: "hsl(215 20% 55%)" }}
              onClick={() => { setMode("register"); setError(null); }}
            >
              Registrati
            </button>
          </div>

          {mode === "register" && accountType === "azienda" ? (
              /* Azienda: SPID only */
              <div className="space-y-5">
                {/* Account type toggle */}
                <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <button
                    type="button"
                    className="flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5"
                    style={{ color: "hsl(215 20% 55%)" }}
                    onClick={() => { setAccountType("privato"); setError(null); }}
                  >
                    👤 Privato
                  </button>
                  <button
                    type="button"
                    className="flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5"
                    style={{
                      background: "linear-gradient(135deg, hsl(158 64% 42% / 0.25), hsl(158 64% 42% / 0.15))",
                      color: "white",
                    }}
                    onClick={() => {}}
                  >
                    🏢 Azienda
                  </button>
                </div>
                <div className="text-center py-4">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: "rgba(0, 102, 204, 0.1)", border: "1px solid rgba(0, 102, 204, 0.2)" }}>
                    <svg width="32" height="32" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="20" cy="20" r="18" fill="#004C99" stroke="#0066CC" strokeWidth="2"/>
                      <text x="20" y="26" textAnchor="middle" fill="white" fontSize="16" fontWeight="bold" fontFamily="Arial">S</text>
                    </svg>
                  </div>
                  <h3 className="text-base font-semibold text-white mb-2">Registrazione Azienda con SPID</h3>
                  <p className="text-xs leading-relaxed" style={{ color: "hsl(215 20% 55%)" }}>
                    La registrazione per le aziende avviene tramite autenticazione SPID per garantire la massima sicurezza e verificare l'identità del titolare.
                  </p>
                </div>

                <button
                  type="button"
                  disabled
                  className="w-full flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-xl text-sm font-semibold transition-all opacity-60 cursor-not-allowed"
                  style={{
                    background: "linear-gradient(135deg, rgba(0, 102, 204, 0.15), rgba(0, 102, 204, 0.08))",
                    border: "1px solid rgba(0, 102, 204, 0.25)",
                    color: "rgba(255,255,255,0.6)",
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="20" cy="20" r="18" fill="#004C99" stroke="#0066CC" strokeWidth="2"/>
                    <text x="20" y="26" textAnchor="middle" fill="white" fontSize="16" fontWeight="bold" fontFamily="Arial">S</text>
                  </svg>
                  Registrati con SPID
                </button>

                <div className="rounded-xl px-4 py-3 text-center" style={{ background: "rgba(251, 191, 36, 0.06)", border: "1px solid rgba(251, 191, 36, 0.15)" }}>
                  <p className="text-xs font-medium" style={{ color: "hsl(45 90% 60%)" }}>
                    🚧 A breve disponibile
                  </p>
                  <p className="text-[11px] mt-1" style={{ color: "hsl(215 20% 50%)" }}>
                    Stiamo completando l'integrazione con il sistema SPID. Riceverai una notifica quando sarà attivo.
                  </p>
                </div>
              </div>
            ) : (
              /* Login + Privato registration form */
              <form className="space-y-4" onSubmit={handleSubmit}>
                {mode === "register" && (
                  <>
                    {/* Account type toggle */}
                    <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <button
                        type="button"
                        className="flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5"
                        style={accountType === "privato" ? {
                          background: "linear-gradient(135deg, hsl(200 60% 40% / 0.25), hsl(200 60% 40% / 0.15))",
                          color: "white",
                        } : { color: "hsl(215 20% 55%)" }}
                        onClick={() => { setAccountType("privato"); setError(null); }}
                      >
                        👤 Privato
                      </button>
                      <button
                        type="button"
                        className="flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5"
                        style={accountType === "azienda" ? {
                          background: "linear-gradient(135deg, hsl(158 64% 42% / 0.25), hsl(158 64% 42% / 0.15))",
                          color: "white",
                        } : { color: "hsl(215 20% 55%)" }}
                        onClick={() => { setAccountType("azienda"); setError(null); }}
                      >
                        🏢 Azienda
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs mb-1.5 block" style={{ color: "hsl(215 20% 65%)" }}>Cognome *</label>
                        <input
                          className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                          style={inputStyle}
                          value={cognome}
                          onChange={(e) => setCognome(e.target.value)}
                          placeholder="Rossi"
                          autoComplete="family-name"
                        />
                      </div>
                      <div>
                        <label className="text-xs mb-1.5 block" style={{ color: "hsl(215 20% 65%)" }}>Nome *</label>
                        <input
                          className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                          style={inputStyle}
                          value={nome}
                          onChange={(e) => setNome(e.target.value)}
                          placeholder="Mario"
                          autoComplete="given-name"
                        />
                      </div>
                    </div>
                  </>
                )}
                <div>
                  <label className="text-xs mb-1.5 block" style={{ color: "hsl(215 20% 65%)" }}>Email *</label>
                  <input
                    className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                    style={inputStyle}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="la-tua@email.it"
                    autoComplete="email"
                    autoFocus
                  />
                </div>
                {mode === "register" && (
                  <div>
                    <label className="text-xs mb-1.5 block" style={{ color: "hsl(215 20% 65%)" }}>Codice Fiscale</label>
                    <input
                      className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors uppercase"
                      style={inputStyle}
                      value={codiceFiscale}
                      onChange={(e) => setCodiceFiscale(e.target.value.toUpperCase())}
                      placeholder="RSSMRA85M01H501Z"
                      maxLength={16}
                    />
                  </div>
                )}
                <div>
                  <label className="text-xs mb-1.5 block" style={{ color: "hsl(215 20% 65%)" }}>Password *</label>
                  <input
                    className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                    style={inputStyle}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === "register" ? "Minimo 8 caratteri" : "La tua password"}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                  />
                </div>
                {mode === "register" && (
                  <div>
                    <label className="text-xs mb-1.5 block" style={{ color: "hsl(215 20% 65%)" }}>Conferma password *</label>
                    <input
                      className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                      style={inputStyle}
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Ripeti la password"
                      autoComplete="new-password"
                    />
                  </div>
                )}

                {error && (
                  <div className="rounded-xl px-3 py-2 text-xs" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "hsl(0 65% 65%)" }}>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isPending}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))",
                    boxShadow: "0 4px 20px hsl(158 64% 42% / 0.3)",
                  }}
                >
                  {isPending
                    ? "Caricamento..."
                    : mode === "login"
                      ? "Accedi"
                      : "Registrati"}
                </button>
              </form>
            )}
        </div>
      </div>
    </div>
  );
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useCompany } from "./CompanyContext";

interface OnboardingState {
  step: number | null; // null = loading, 0-3 = steps, 99 = complete
  loading: boolean;
  advanceStep: (newStep: number) => Promise<void>;
  dismissTooltip: () => void;
  tooltipDismissed: boolean;
}

const OnboardingContext = createContext<OnboardingState | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { selectedCompanyId } = useCompany();
  const [step, setStep] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [tooltipDismissed, setTooltipDismissed] = useState(false);

  // Fetch step on mount / company change
  useEffect(() => {
    if (!selectedCompanyId) {
      setStep(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch("/api/onboarding/onboarding-step/" + selectedCompanyId, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setStep(d.step ?? 99);
        setTooltipDismissed(false);
        setLoading(false);
      })
      .catch(() => {
        setStep(99);
        setLoading(false);
      });
  }, [selectedCompanyId]);

  // Listen for external step-changed events
  useEffect(() => {
    const handler = () => {
      if (!selectedCompanyId) return;
      fetch("/api/onboarding/onboarding-step/" + selectedCompanyId, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => {
          setStep(d.step ?? 99);
          setTooltipDismissed(false);
        })
        .catch(() => {});
    };
    window.addEventListener("onboarding-step-changed", handler);
    return () => window.removeEventListener("onboarding-step-changed", handler);
  }, [selectedCompanyId]);

  const advanceStep = useCallback(async (newStep: number) => {
    if (!selectedCompanyId) return;
    try {
      await fetch("/api/onboarding/onboarding-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ companyId: selectedCompanyId, step: newStep }),
      });
      setStep(newStep);
      setTooltipDismissed(false);
      window.dispatchEvent(new Event("onboarding-step-changed"));
    } catch {}
  }, [selectedCompanyId]);

  const dismissTooltip = useCallback(() => {
    setTooltipDismissed(true);
  }, []);

  const value = useMemo(() => ({
    step,
    loading,
    advanceStep,
    dismissTooltip,
    tooltipDismissed,
  }), [step, loading, advanceStep, dismissTooltip, tooltipDismissed]);

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding must be used within OnboardingProvider");
  return ctx;
}

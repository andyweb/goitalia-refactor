import { Pause, Play } from "lucide-react";

const glassBtn = "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed";
const glassStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "rgba(255,255,255,0.8)",
};

export function RunButton({
  onClick,
  disabled,
  label = "Esegui",
  size: _size = "sm",
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  size?: "sm" | "default";
}) {
  return (
    <button
      className={glassBtn}
      style={glassStyle}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.04) 100%)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = glassStyle.background as string; }}
    >
      <Play className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export function PauseResumeButton({
  isPaused,
  onPause,
  onResume,
  disabled,
  size: _size = "sm",
}: {
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  disabled?: boolean;
  size?: "sm" | "default";
}) {
  if (isPaused) {
    return (
      <button
        className={glassBtn}
        style={glassStyle}
        onClick={onResume}
        disabled={disabled}
        onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.04) 100%)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = glassStyle.background as string; }}
      >
        <Play className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Riprendi</span>
      </button>
    );
  }

  return (
    <button
      className={glassBtn}
      style={glassStyle}
      onClick={onPause}
      disabled={disabled}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.04) 100%)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = glassStyle.background as string; }}
    >
      <Pause className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Pausa</span>
    </button>
  );
}

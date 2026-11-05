import { createContext, useContext, useState, type ReactNode } from "react";

const KEY = "ledger_view";

type ViewMode = "balance" | "app";

interface ViewModeValue {
  balanceOnly: boolean;
  showBalance: () => void;
  showApp: () => void;
}

const ViewModeContext = createContext<ViewModeValue | null>(null);

function readMode(): ViewMode {
  return localStorage.getItem(KEY) === "balance" ? "balance" : "app";
}

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ViewMode>(readMode);

  function showBalance() {
    localStorage.setItem(KEY, "balance");
    setMode("balance");
  }

  function showApp() {
    localStorage.setItem(KEY, "app");
    setMode("app");
  }

  return (
    <ViewModeContext.Provider value={{ balanceOnly: mode === "balance", showBalance, showApp }}>
      {children}
    </ViewModeContext.Provider>
  );
}

export function useViewMode() {
  const ctx = useContext(ViewModeContext);
  if (!ctx) throw new Error("useViewMode must be used within ViewModeProvider");
  return ctx;
}

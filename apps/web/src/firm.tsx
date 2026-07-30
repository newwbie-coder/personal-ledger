import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "./lib/api";
import { useAuth } from "./auth";

export interface Firm {
  firm_id: string;
  firm_name: string;
  status: string;
}

interface FirmState {
  firms: Firm[];
  /** null = Workspace Summary (read-only aggregate) */
  selectedFirmId: string | null;
  selectedFirm: Firm | null;
  isSummary: boolean;
  setSelectedFirmId: (id: string | null) => void;
  refreshFirms: () => Promise<void>;
  loading: boolean;
}

const FirmContext = createContext<FirmState | null>(null);
const STORAGE_KEY = "ledger_selected_firm";

export function FirmProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [firms, setFirms] = useState<Firm[]>([]);
  const [selectedFirmId, setSelectedFirmIdState] = useState<string | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved && saved !== "summary" ? saved : null;
  });
  const [loading, setLoading] = useState(true);

  const refreshFirms = useCallback(async () => {
    const data = await api<{ firms: Firm[] }>("/firms");
    setFirms(data.firms);
    setSelectedFirmIdState((current) => {
      if (current && !data.firms.some((f) => f.firm_id === current)) {
        localStorage.setItem(STORAGE_KEY, "summary");
        return null;
      }
      if (!current && data.firms.length === 1) {
        localStorage.setItem(STORAGE_KEY, data.firms[0].firm_id);
        return data.firms[0].firm_id;
      }
      return current;
    });
  }, []);

  useEffect(() => {
    if (!user) {
      setFirms([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    refreshFirms()
      .catch(() => {
        if (!cancelled) setFirms([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, refreshFirms]);

  const setSelectedFirmId = useCallback((id: string | null) => {
    setSelectedFirmIdState(id);
    localStorage.setItem(STORAGE_KEY, id ?? "summary");
  }, []);

  const selectedFirm = useMemo(
    () => firms.find((f) => f.firm_id === selectedFirmId) ?? null,
    [firms, selectedFirmId],
  );

  const value = useMemo(
    () => ({
      firms,
      selectedFirmId,
      selectedFirm,
      isSummary: selectedFirmId === null,
      setSelectedFirmId,
      refreshFirms,
      loading,
    }),
    [firms, selectedFirmId, selectedFirm, setSelectedFirmId, refreshFirms, loading],
  );

  return <FirmContext.Provider value={value}>{children}</FirmContext.Provider>;
}

export function useFirm() {
  const ctx = useContext(FirmContext);
  if (!ctx) throw new Error("useFirm outside provider");
  return ctx;
}

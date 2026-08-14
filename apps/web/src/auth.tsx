import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, setToken, setWorkspaceSlug, getWorkspaceSlug } from "./lib/api";

export type Role = "owner" | "manager" | "employee";

export interface User {
  user_id: string;
  name: string;
  username: string;
  role: Role;
  assigned_firm_id?: string | null;
  has_pin?: boolean;
}

export interface WorkspaceInfo {
  workspace_id: string;
  slug: string;
  company_name: string;
}

interface AuthState {
  user: User | null;
  workspace: WorkspaceInfo | null;
  loading: boolean;
  login: (workspace: string, username: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  setUserPinFlag: (hasPin: boolean) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem("ledger_token");
        if (token) {
          const me = await api<{ user: User; workspace: WorkspaceInfo }>("/auth/me");
          if (!cancelled) {
            setUser(me.user);
            setWorkspace(me.workspace);
            setWorkspaceSlug(me.workspace.slug);
          }
        }
      } catch {
        setToken(null);
        if (!cancelled) {
          setUser(null);
          setWorkspace(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (ws: string, username: string, password: string) => {
    const result = await api<{
      token: string;
      user: User;
      workspace: WorkspaceInfo;
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ workspace: ws, username, password }),
    });
    setToken(result.token);
    setWorkspaceSlug(result.workspace.slug);
    setUser(result.user);
    setWorkspace(result.workspace);
    sessionStorage.setItem("ledger_pin_unlocked", "1");
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setWorkspace(null);
    sessionStorage.removeItem("ledger_pin_unlocked");
  }, []);

  const refreshUser = useCallback(async () => {
    const me = await api<{ user: User; workspace: WorkspaceInfo }>("/auth/me");
    setUser(me.user);
    setWorkspace(me.workspace);
  }, []);

  const setUserPinFlag = useCallback((hasPin: boolean) => {
    setUser((prev) => (prev ? { ...prev, has_pin: hasPin } : prev));
  }, []);

  const value = useMemo(
    () => ({ user, workspace, loading, login, logout, refreshUser, setUserPinFlag }),
    [user, workspace, loading, login, logout, refreshUser, setUserPinFlag],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}

export { getWorkspaceSlug };

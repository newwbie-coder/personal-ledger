const ROOT = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
export const API_BASE = `${ROOT}/api/v1`;

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function getToken() {
  return localStorage.getItem("ledger_token");
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem("ledger_token", token);
  else localStorage.removeItem("ledger_token");
}

export function getWorkspaceSlug() {
  return localStorage.getItem("ledger_workspace") ?? "";
}

export function setWorkspaceSlug(slug: string | null) {
  if (slug) localStorage.setItem("ledger_workspace", slug);
  else localStorage.removeItem("ledger_workspace");
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }

  if (!res.ok) {
    const err = data as { error?: string | object; code?: string };
    const message =
      typeof err?.error === "string" ? err.error : `Request failed (${res.status})`;
    throw new ApiError(message, res.status, err?.code);
  }
  return data as T;
}

export function money(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

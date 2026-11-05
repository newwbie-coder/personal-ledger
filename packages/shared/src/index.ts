export type UserRole = "owner" | "manager" | "employee";
export type LedgerEntryType = "incoming" | "outgoing";

export const APP_VERSION = "2.0.0";
export const API_PREFIX = "/api/v1";

export interface PublicWorkspace {
  workspace_id: string;
  slug: string;
  company_name: string;
}

export interface Party {
  party_id: string;
  party_name: string;
  phone: string | null;
  opening_balance: number;
  active: boolean;
  created_at: string;
  current_balance?: number;
}

export interface LedgerEntry {
  entry_id: string;
  party_id: string;
  date_time: string;
  type: LedgerEntryType;
  amount: number;
  description: string;
  created_by: string;
  reverse_of_entry: string | null;
  created_at: string;
}

export interface DashboardStats {
  today_incoming: number;
  today_outgoing: number;
  outstanding_balance: number;
  today_transaction_count: number;
}

export interface HealthResponse {
  database: "OK" | "ERROR";
  setup_complete: boolean;
  chain: "OK" | "BROKEN" | "UNCHECKED";
  chain_checked_at: string | null;
  version: string;
}

export type UserRole = "owner" | "manager" | "employee";
export type LedgerEntryType = "incoming" | "outgoing";
export type LedgerEntryKind = "party" | "transfer";
export type FirmStatus = "active" | "archived";
export type TransferStatus = "posted" | "reversed";

export interface Company {
  company_uuid: string;
  company_name: string;
  created_at: string;
}

export interface User {
  user_id: string;
  name: string;
  username: string;
  password_hash: string;
  role: UserRole;
  active: boolean;
  created_at: string;
  assigned_firm_id?: string | null;
  pin_hash?: string | null;
}

export interface Firm {
  firm_id: string;
  firm_name: string;
  status: FirmStatus;
  created_at: string;
}

export interface Party {
  party_id: string;
  party_name: string;
  phone: string | null;
  active: boolean;
  created_at: string;
}

export interface PartyFirmOpening {
  opening_balance_id?: string;
  party_id: string;
  firm_id: string;
  opening_balance: number;
  balance?: number;
  effective_date?: string;
  locked?: boolean;
  created_at: string;
}

export interface OpeningBalance {
  opening_balance_id: string;
  party_id: string;
  firm_id: string;
  balance: number;
  effective_date: string;
  created_by: string | null;
  created_at: string;
  locked: boolean;
}

export interface LedgerEntry {
  entry_id: string;
  firm_id: string;
  party_id: string | null;
  entry_kind: LedgerEntryKind;
  date_time: string;
  type: LedgerEntryType;
  amount: number;
  description: string;
  created_by: string;
  reverse_of_entry: string | null;
  transfer_id: string | null;
  created_at: string;
}

export interface Transfer {
  transfer_id: string;
  source_firm_id: string;
  destination_firm_id: string;
  amount: number;
  description: string;
  created_by: string;
  status: TransferStatus;
  created_at: string;
}

export interface AppNotification {
  notification_id: string;
  user_id: string;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface AppMetadata {
  company_uuid: string;
  schema_version: number;
  license_id: string | null;
  created_at: string;
  encryption?: string | null;
}

export interface PartyWithBalance extends Party {
  current_balance: number;
  firm_balances?: Array<{
    firm_id: string;
    firm_name: string;
    opening_balance: number;
    current_balance: number;
  }>;
}

export interface DashboardStats {
  today_incoming: number;
  today_outgoing: number;
  outstanding_balance: number;
  today_transaction_count: number;
  firm_id: string | null;
  view: "firm" | "workspace_summary";
}

export const SCHEMA_VERSION = 7;

export { MIGRATIONS } from "./migrations.js";

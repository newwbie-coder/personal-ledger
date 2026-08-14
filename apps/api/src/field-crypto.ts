import { openAmount, openText } from "./data-crypto.js";

export function partySignedDelta(type: string, amount: number): number {
  return type === "outgoing" ? amount : -amount;
}

/** Compute party balance for one firm from plaintext openings + entries. */
export function computePartyFirmBalance(input: {
  opening: number;
  entries: Array<{ type: string; amount: number }>;
}): number {
  let bal = input.opening;
  for (const e of input.entries) bal += partySignedDelta(e.type, e.amount);
  return bal;
}

export function decryptPartyRow(
  dek: Buffer | null,
  row: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...row,
    party_name: openText(dek, row.party_name),
    phone: row.phone == null || row.phone === "" ? null : openText(dek, row.phone),
  };
}

export function decryptLedgerRow(
  dek: Buffer | null,
  row: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...row,
    amount: openAmount(dek, row.amount),
    description: openText(dek, row.description ?? ""),
  };
}

export function decryptOpeningRow(
  dek: Buffer | null,
  row: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...row,
    balance: openAmount(dek, row.balance),
  };
}

export function decryptTransferRow(
  dek: Buffer | null,
  row: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...row,
    amount: openAmount(dek, row.amount),
    description: openText(dek, row.description ?? ""),
  };
}

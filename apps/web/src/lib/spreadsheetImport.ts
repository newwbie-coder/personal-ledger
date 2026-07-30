import * as XLSX from "xlsx";

const TEMPLATE_ROWS: unknown[][] = [
  ["party_name", "firm_name", "opening_balance", "effective_date", "phone"],
  ["ABC Traders", "Main Firm", 25000, "29-07-2026", "9876543210"],
  ["XYZ Agencies", "Main Firm", -8500, "29-07-2026", ""],
  ["Ramesh", "Chennai Branch", 3000, "29-07-2026", ""],
];

function cellToString(cell: unknown): string {
  if (cell == null || cell === "") return "";
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).trim();
}

function escapeCsvCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowsToCsv(rows: unknown[][]): string {
  return rows
    .map((row) => row.map((cell) => escapeCsvCell(cellToString(cell))).join(","))
    .join("\n");
}

/** Read .csv / .xlsx / .xls and return CSV text for POST /openings/import */
export async function fileToImportCsv(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();

  if (name.endsWith(".csv")) {
    return new TextDecoder().decode(buf).replace(/^\uFEFF/, "");
  }

  if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
    throw new Error("Use a .csv, .xlsx, or .xls file");
  }

  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no sheets");

  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  const nonEmpty = rows.filter((row) =>
    Array.isArray(row) && row.some((cell) => cellToString(cell) !== ""),
  );
  if (nonEmpty.length < 2) {
    throw new Error("Sheet must include a header row and at least one data row");
  }

  return rowsToCsv(nonEmpty);
}

export function downloadExcelTemplate() {
  const ws = XLSX.utils.aoa_to_sheet(TEMPLATE_ROWS);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Opening balances");
  XLSX.writeFile(wb, "opening-balances-template.xlsx");
}

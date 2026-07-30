/** Build a PostgreSQL URI from discrete fields. Never expose this to the browser after setup. */
export function buildDatabaseUrl(input: {
  host: string;
  port: number | string;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
}): string {
  const host = input.host.trim();
  const database = input.database.trim();
  const username = input.username.trim();
  const password = input.password;
  const port = Number(input.port) || 5432;

  if (!host) throw new Error("Host is required");
  if (!database) throw new Error("Database name is required");
  if (!username) throw new Error("Username is required");
  if (!password) throw new Error("Password is required");
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error("Port must be between 1 and 65535");
  }

  const user = encodeURIComponent(username);
  const pass = encodeURIComponent(password);
  const db = encodeURIComponent(database);
  const base = `postgresql://${user}:${pass}@${host}:${port}/${db}`;
  // SSL is applied via pg Pool config (rejectUnauthorized: false for cloud hosts).
  return base;
}

export function parsePgHost(connectionString: string): string | null {
  try {
    const normalized = connectionString.replace(/^postgresql:/, "https:");
    return new URL(normalized).hostname;
  } catch {
    return null;
  }
}

export function needsPgSsl(connectionString: string, host?: string): boolean {
  const h = host?.trim() || parsePgHost(connectionString) || "";
  return (
    connectionString.includes("sslmode=require") ||
    /supabase|neon\.tech|amazonaws\.com|pooler\.supabase/i.test(connectionString) ||
    /supabase|neon\.tech|pooler\.supabase/i.test(h)
  );
}

/** Pool options for node-pg — Supabase/Neon need SSL without strict CA verification. */
export function pgPoolOptions(
  connectionString: string,
  host?: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const useSsl = needsPgSsl(connectionString, host);
  const config: Record<string, unknown> = {
    ...extra,
    connectionString: connectionString.replace(/([?&])sslmode=[^&]*/g, "").replace(/\?$/, ""),
  };
  if (useSsl) {
    config.ssl = { rejectUnauthorized: false };
  }
  return config;
}

export const dbConnectionFieldsSchema = {
  host: true,
  port: true,
  database: true,
  username: true,
  password: true,
} as const;

export type DbProvider = "supabase" | "existing" | "self_hosted";

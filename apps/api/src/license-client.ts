import type { WorkspaceRecord } from "./workspaces.js";
import { touchLicenseValidation } from "./workspaces.js";

const LICENSE_SERVER_URL = () => process.env.LICENSE_SERVER_URL ?? "http://localhost:4100";
const LICENSE_SERVER_SECRET = () => process.env.LICENSE_SERVER_SECRET ?? "dev-license-secret";
const REVALIDATE_MS = 30 * 24 * 60 * 60 * 1000;

export async function activateLicense(input: {
  license_id: string;
  company_uuid: string;
  company_name: string;
}) {
  const res = await fetch(`${LICENSE_SERVER_URL()}/activate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-license-secret": LICENSE_SERVER_SECRET(),
    },
    body: JSON.stringify(input),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(String(body.error ?? "License activation failed"));
  }
  return body as {
    license_id: string;
    company_uuid: string;
    activation_token: string;
    maximum_users: number;
    edition: string;
    status: string;
  };
}

export async function pingLicenseServer(): Promise<boolean> {
  try {
    const res = await fetch(`${LICENSE_SERVER_URL()}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Issue a new unused license (admin). Used after cloud deploy. */
export async function issueLicense(input?: {
  maximum_users?: number;
  edition?: string;
  company_name?: string;
}) {
  const admin = process.env.LICENSE_ADMIN_SECRET ?? "dev-admin-secret";
  const res = await fetch(`${LICENSE_SERVER_URL()}/admin/issue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-secret": admin,
    },
    body: JSON.stringify({
      maximum_users: input?.maximum_users ?? 10,
      edition: input?.edition ?? "standard",
      company_name: input?.company_name,
    }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(String(body.error ?? "License issue failed"));
  }
  return body as {
    license_id: string;
    maximum_users: number;
    edition: string;
    status: string;
  };
}

export async function validateWorkspaceLicense(
  workspace: WorkspaceRecord,
  force = false,
): Promise<{ valid: boolean; maximum_users?: number; skipped?: boolean; error?: string }> {
  if (!force && workspace.last_license_validation) {
    const last = Date.parse(workspace.last_license_validation);
    if (!Number.isNaN(last) && Date.now() - last < REVALIDATE_MS) {
      return { valid: true, skipped: true };
    }
  }

  try {
    const res = await fetch(`${LICENSE_SERVER_URL()}/validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-license-secret": LICENSE_SERVER_SECRET(),
      },
      body: JSON.stringify({
        license_id: workspace.license_id,
        company_uuid: workspace.company_uuid,
        activation_token: workspace.activation_token,
      }),
    });
    const body = (await res.json()) as {
      valid?: boolean;
      maximum_users?: number;
      error?: string;
    };
    if (!res.ok || !body.valid) {
      return { valid: false, error: body.error ?? "Validation failed" };
    }
    await touchLicenseValidation(workspace.workspace_id);
    return { valid: true, maximum_users: body.maximum_users };
  } catch (err) {
    if (workspace.last_license_validation) {
      const last = Date.parse(workspace.last_license_validation);
      if (!Number.isNaN(last) && Date.now() - last < REVALIDATE_MS * 2) {
        return { valid: true, skipped: true };
      }
    }
    return {
      valid: false,
      error: err instanceof Error ? err.message : "License server unreachable",
    };
  }
}

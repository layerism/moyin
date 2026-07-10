import type { AuthRole } from "./authApi";

export const REMEMBERED_ACCOUNT_KEY = "oa.auth.remembered.v1";

export type RememberedLoginAccount = {
  identifier: string;
  name: string;
};

type RememberedAccountsPayload = {
  accounts: Partial<Record<AuthRole, RememberedLoginAccount>>;
  version: 1;
};

type StorageAdapter = Pick<Storage, "getItem" | "removeItem" | "setItem">;

function parseAccount(value: unknown): RememberedLoginAccount | null {
  if (!value || typeof value !== "object") return null;
  const account = value as Record<string, unknown>;
  if (typeof account.identifier !== "string" || typeof account.name !== "string") return null;
  const identifier = account.identifier.trim();
  const name = account.name.trim();
  return identifier && name ? { identifier, name } : null;
}

function readPayload(storage: StorageAdapter): RememberedAccountsPayload {
  try {
    const raw = storage.getItem(REMEMBERED_ACCOUNT_KEY);
    if (!raw) return { accounts: {}, version: 1 };
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.version !== 1 || !value.accounts || typeof value.accounts !== "object") {
      return { accounts: {}, version: 1 };
    }
    const rawAccounts = value.accounts as Record<string, unknown>;
    const teacher = parseAccount(rawAccounts.teacher);
    const student = parseAccount(rawAccounts.student);
    return {
      accounts: {
        ...(teacher ? { teacher } : {}),
        ...(student ? { student } : {}),
      },
      version: 1,
    };
  } catch {
    return { accounts: {}, version: 1 };
  }
}

export function getRememberedAccount(
  storage: StorageAdapter,
  role: AuthRole,
): RememberedLoginAccount | null {
  return readPayload(storage).accounts[role] ?? null;
}

export function rememberLoginAccount(
  storage: StorageAdapter,
  role: AuthRole,
  account: RememberedLoginAccount,
) {
  const payload = readPayload(storage);
  payload.accounts[role] = {
    identifier: account.identifier.trim(),
    name: account.name.trim(),
  };
  try {
    storage.setItem(REMEMBERED_ACCOUNT_KEY, JSON.stringify(payload));
  } catch {
    // Login must still succeed when storage is unavailable or full.
  }
}

export function forgetRememberedAccount(storage: StorageAdapter, role: AuthRole) {
  const payload = readPayload(storage);
  delete payload.accounts[role];
  if (!payload.accounts.teacher && !payload.accounts.student) {
    try {
      storage.removeItem(REMEMBERED_ACCOUNT_KEY);
    } catch {
      // Storage failures must not block authentication.
    }
    return;
  }
  try {
    storage.setItem(REMEMBERED_ACCOUNT_KEY, JSON.stringify(payload));
  } catch {
    // Storage failures must not block authentication.
  }
}

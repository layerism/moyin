import type { AuthRole } from "./authApi";

export const ACCOUNT_HISTORY_KEY = "oa.auth.account-history.v2";
export const LEGACY_REMEMBERED_ACCOUNT_KEY = "oa.auth.remembered.v1";
export const MAX_REMEMBERED_ACCOUNTS = 5;

export type RememberedLoginAccount = {
  identifier: string;
  name: string;
};

type AccountHistoryPayload = {
  accounts: Partial<Record<AuthRole, RememberedLoginAccount[]>>;
  version: 2;
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

function parseHistory(value: unknown): RememberedLoginAccount[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const accounts: RememberedLoginAccount[] = [];
  for (const item of value) {
    const account = parseAccount(item);
    if (!account || seen.has(account.identifier)) continue;
    seen.add(account.identifier);
    accounts.push(account);
    if (accounts.length === MAX_REMEMBERED_ACCOUNTS) break;
  }
  return accounts;
}

function parseCurrentPayload(raw: string | null): AccountHistoryPayload | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.version !== 2 || !value.accounts || typeof value.accounts !== "object") return null;
    const rawAccounts = value.accounts as Record<string, unknown>;
    return {
      accounts: {
        student: parseHistory(rawAccounts.student),
        teacher: parseHistory(rawAccounts.teacher),
      },
      version: 2,
    };
  } catch {
    return null;
  }
}

function parseLegacyPayload(raw: string | null): AccountHistoryPayload | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.version !== 1 || !value.accounts || typeof value.accounts !== "object") return null;
    const rawAccounts = value.accounts as Record<string, unknown>;
    const teacher = parseAccount(rawAccounts.teacher);
    const student = parseAccount(rawAccounts.student);
    return {
      accounts: {
        ...(teacher ? { teacher: [teacher] } : {}),
        ...(student ? { student: [student] } : {}),
      },
      version: 2,
    };
  } catch {
    return null;
  }
}

function readPayload(storage: StorageAdapter): AccountHistoryPayload {
  try {
    return parseCurrentPayload(storage.getItem(ACCOUNT_HISTORY_KEY))
      ?? parseLegacyPayload(storage.getItem(LEGACY_REMEMBERED_ACCOUNT_KEY))
      ?? { accounts: {}, version: 2 };
  } catch {
    return { accounts: {}, version: 2 };
  }
}

function writePayload(storage: StorageAdapter, payload: AccountHistoryPayload) {
  try {
    storage.setItem(ACCOUNT_HISTORY_KEY, JSON.stringify(payload));
    storage.removeItem(LEGACY_REMEMBERED_ACCOUNT_KEY);
  } catch {
    // Authentication must still succeed when storage is unavailable or full.
  }
}

export function getRememberedAccounts(
  storage: StorageAdapter,
  role: AuthRole,
): RememberedLoginAccount[] {
  return [...(readPayload(storage).accounts[role] ?? [])];
}

export function rememberLoginAccount(
  storage: StorageAdapter,
  role: AuthRole,
  account: RememberedLoginAccount,
) {
  const normalized = parseAccount(account);
  if (!normalized) return;
  const payload = readPayload(storage);
  const current = payload.accounts[role] ?? [];
  payload.accounts[role] = [
    normalized,
    ...current.filter((item) => item.identifier !== normalized.identifier),
  ].slice(0, MAX_REMEMBERED_ACCOUNTS);
  writePayload(storage, payload);
}

export function forgetRememberedAccount(
  storage: StorageAdapter,
  role: AuthRole,
  identifier: string,
) {
  const payload = readPayload(storage);
  payload.accounts[role] = (payload.accounts[role] ?? []).filter(
    (account) => account.identifier !== identifier,
  );
  const hasAccounts = (payload.accounts.teacher?.length ?? 0) > 0
    || (payload.accounts.student?.length ?? 0) > 0;
  if (!hasAccounts) {
    try {
      storage.removeItem(ACCOUNT_HISTORY_KEY);
      storage.removeItem(LEGACY_REMEMBERED_ACCOUNT_KEY);
    } catch {
      // Storage failures must not block authentication.
    }
    return;
  }
  writePayload(storage, payload);
}

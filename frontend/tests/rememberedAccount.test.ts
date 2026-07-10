import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNT_HISTORY_KEY,
  forgetRememberedAccount,
  getRememberedAccounts,
  LEGACY_REMEMBERED_ACCOUNT_KEY,
  rememberLoginAccount,
} from "../src/features/auth/rememberedAccount.ts";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

test("returns empty history for missing or malformed storage", () => {
  const storage = new MemoryStorage();
  assert.deepEqual(getRememberedAccounts(storage, "teacher"), []);

  storage.setItem(ACCOUNT_HISTORY_KEY, "not-json");
  assert.deepEqual(getRememberedAccounts(storage, "teacher"), []);

  storage.setItem(ACCOUNT_HISTORY_KEY, JSON.stringify({ version: 3, accounts: {} }));
  assert.deepEqual(getRememberedAccounts(storage, "teacher"), []);
});

test("reads a legacy remembered account as one history item", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    LEGACY_REMEMBERED_ACCOUNT_KEY,
    JSON.stringify({
      accounts: {
        student: { identifier: "20260001", name: "学生甲" },
        teacher: { identifier: "04170", name: "卢禹锟" },
      },
      version: 1,
    }),
  );

  assert.deepEqual(getRememberedAccounts(storage, "teacher"), [
    { identifier: "04170", name: "卢禹锟" },
  ]);
  assert.deepEqual(getRememberedAccounts(storage, "student"), [
    { identifier: "20260001", name: "学生甲" },
  ]);
});

test("stores role histories independently without a password", () => {
  const storage = new MemoryStorage();
  rememberLoginAccount(storage, "teacher", { identifier: "04170", name: "卢禹锟" });
  rememberLoginAccount(storage, "student", { identifier: "20260001", name: "学生甲" });

  assert.deepEqual(getRememberedAccounts(storage, "teacher"), [
    { identifier: "04170", name: "卢禹锟" },
  ]);
  assert.deepEqual(getRememberedAccounts(storage, "student"), [
    { identifier: "20260001", name: "学生甲" },
  ]);
  assert.equal(storage.getItem(ACCOUNT_HISTORY_KEY)?.includes("password"), false);
});

test("deduplicates by identifier and keeps the five most recent accounts", () => {
  const storage = new MemoryStorage();
  for (let index = 1; index <= 6; index += 1) {
    rememberLoginAccount(storage, "teacher", {
      identifier: `T${index}`,
      name: `教师${index}`,
    });
  }
  rememberLoginAccount(storage, "teacher", { identifier: "T3", name: "教师三（更新）" });

  assert.deepEqual(getRememberedAccounts(storage, "teacher"), [
    { identifier: "T3", name: "教师三（更新）" },
    { identifier: "T6", name: "教师6" },
    { identifier: "T5", name: "教师5" },
    { identifier: "T4", name: "教师4" },
    { identifier: "T2", name: "教师2" },
  ]);
});

test("removes one selected account without changing other history", () => {
  const storage = new MemoryStorage();
  rememberLoginAccount(storage, "teacher", { identifier: "T1", name: "教师一" });
  rememberLoginAccount(storage, "teacher", { identifier: "T2", name: "教师二" });
  rememberLoginAccount(storage, "student", { identifier: "S1", name: "学生一" });

  forgetRememberedAccount(storage, "teacher", "T1");

  assert.deepEqual(getRememberedAccounts(storage, "teacher"), [
    { identifier: "T2", name: "教师二" },
  ]);
  assert.deepEqual(getRememberedAccounts(storage, "student"), [
    { identifier: "S1", name: "学生一" },
  ]);
});

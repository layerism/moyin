import assert from "node:assert/strict";
import test from "node:test";

import {
  forgetRememberedAccount,
  getRememberedAccount,
  REMEMBERED_ACCOUNT_KEY,
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

test("returns no account for empty or malformed storage", () => {
  const storage = new MemoryStorage();
  assert.equal(getRememberedAccount(storage, "teacher"), null);

  storage.setItem(REMEMBERED_ACCOUNT_KEY, "not-json");
  assert.equal(getRememberedAccount(storage, "teacher"), null);

  storage.setItem(REMEMBERED_ACCOUNT_KEY, JSON.stringify({ version: 2, accounts: {} }));
  assert.equal(getRememberedAccount(storage, "teacher"), null);
});

test("stores teacher and student accounts independently without a password", () => {
  const storage = new MemoryStorage();
  rememberLoginAccount(storage, "teacher", { identifier: "04170", name: "卢禹锟" });
  rememberLoginAccount(storage, "student", { identifier: "20260001", name: "学生甲" });

  assert.deepEqual(getRememberedAccount(storage, "teacher"), {
    identifier: "04170",
    name: "卢禹锟",
  });
  assert.deepEqual(getRememberedAccount(storage, "student"), {
    identifier: "20260001",
    name: "学生甲",
  });
  assert.equal(storage.getItem(REMEMBERED_ACCOUNT_KEY)?.includes("password"), false);
});

test("overwrites and removes only the selected role", () => {
  const storage = new MemoryStorage();
  rememberLoginAccount(storage, "teacher", { identifier: "T1", name: "教师一" });
  rememberLoginAccount(storage, "student", { identifier: "S1", name: "学生一" });
  rememberLoginAccount(storage, "teacher", { identifier: "T2", name: "教师二" });

  assert.deepEqual(getRememberedAccount(storage, "teacher"), {
    identifier: "T2",
    name: "教师二",
  });

  forgetRememberedAccount(storage, "teacher");
  assert.equal(getRememberedAccount(storage, "teacher"), null);
  assert.deepEqual(getRememberedAccount(storage, "student"), {
    identifier: "S1",
    name: "学生一",
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  downloadAuditScriptTemplate,
  getAuditScriptFormState,
  getAuditScriptListState,
  validateAuditScriptFileContent,
  validateAuditScriptForm,
  type AuditScriptFormMode,
} from "../src/features/academic-flow/auditScriptManager.ts";

const pythonScript = {
  description: "校验材料内容",
  id: "script-1",
  language: "py" as const,
  name: "材料审核",
  sha256: "abc123",
  updatedAt: "2026-07-17T10:00:00+00:00",
  version: 2,
};

const file = (name: string) => ({ name }) as File;

const fileFromBytes = (name: string, bytes: Uint8Array) => new File([bytes], name);

test("功能名称去除首尾空格后必须填写且最多 120 个字符", () => {
  const mode: AuditScriptFormMode = { kind: "create" };

  assert.equal(validateAuditScriptForm({ mode, name: "   ", description: "说明", file: file("audit.py") }), "请填写功能名称");
  assert.equal(validateAuditScriptForm({ mode, name: "a".repeat(121), description: "说明", file: file("audit.py") }), "功能名称不能超过 120 个字符");
});

test("功能描述必须填写且最多 500 个字符", () => {
  const mode: AuditScriptFormMode = { kind: "create" };

  assert.equal(validateAuditScriptForm({ mode, name: "审核", description: " ", file: file("audit.py") }), "请填写功能描述");
  assert.equal(validateAuditScriptForm({ mode, name: "审核", description: "a".repeat(501), file: file("audit.py") }), "功能描述不能超过 500 个字符");
});

test("新增仅接受 Python 或 JavaScript 脚本", () => {
  const mode: AuditScriptFormMode = { kind: "create" };

  assert.equal(validateAuditScriptForm({ mode, name: "审核", description: "说明", file: file("audit.py") }), null);
  assert.equal(validateAuditScriptForm({ mode, name: "审核", description: "说明", file: file("audit.js") }), null);
  assert.equal(validateAuditScriptForm({ mode, name: "审核", description: "说明", file: file("audit.txt") }), "请选择 .py 或 .js 脚本文件");
});

test("更新时必须保持原脚本语言", () => {
  const mode: AuditScriptFormMode = { kind: "update", script: pythonScript };

  assert.equal(validateAuditScriptForm({ mode, name: pythonScript.name, description: "更新说明", file: file("audit.js") }), "更新版本必须保持 Python 语言");
  assert.equal(validateAuditScriptForm({ mode, name: pythonScript.name, description: "更新说明", file: file("audit.py") }), null);
});

test("更新表单锁定功能名称但允许修改描述", () => {
  const mode: AuditScriptFormMode = { kind: "update", script: pythonScript };

  assert.deepEqual(getAuditScriptFormState(mode), { name: "材料审核", nameLocked: true });
  assert.equal(validateAuditScriptForm({ mode, name: pythonScript.name, description: "新的功能描述", file: file("audit.py") }), null);
});

test("脚本列表读取失败时显示错误态而不是加载态", () => {
  assert.equal(
    getAuditScriptListState({ error: "审核脚本列表读取失败", loading: false, scripts: null }),
    "error",
  );
});

test("空审核脚本文件会在提交前被拒绝", async () => {
  assert.equal(await validateAuditScriptFileContent(fileFromBytes("audit.py", new Uint8Array())), "脚本文件不能为空");
});

test("超过 1 MiB 的审核脚本文件会在提交前被拒绝", async () => {
  assert.equal(
    await validateAuditScriptFileContent(fileFromBytes("audit.py", new Uint8Array(1024 * 1024 + 1))),
    "脚本文件不能超过 1 MiB",
  );
});

test("非 UTF-8 的审核脚本文件会在提交前被拒绝", async () => {
  assert.equal(
    await validateAuditScriptFileContent(fileFromBytes("audit.py", new Uint8Array([0xc3, 0x28]))),
    "脚本文件必须使用 UTF-8 编码",
  );
});

test("合法 UTF-8 审核脚本文件可以通过字节校验", async () => {
  assert.equal(
    await validateAuditScriptFileContent(fileFromBytes("audit.py", new TextEncoder().encode("def run(): pass"))),
    null,
  );
});

test("支持系统文件选择器时先选择保存位置再下载并写入模板", async () => {
  const events: string[] = [];
  const blob = new Blob(["print('ok')"], { type: "text/plain" });

  const result = await downloadAuditScriptTemplate({
    fallbackDownload: () => events.push("fallback"),
    filename: "audit-script-python-template.zip",
    getBlob: async () => {
      events.push("download");
      return blob;
    },
    showSaveFilePicker: async (options) => {
      assert.equal(options.suggestedName, "audit-script-python-template.zip");
      assert.deepEqual(options.types[0]?.accept, { "application/zip": [".zip"] });
      events.push(`picker:${options.suggestedName}`);
      return {
        createWritable: async () => ({
          close: async () => { events.push("close"); },
          write: async (content) => {
            assert.equal(content, blob);
            events.push("write");
          },
        }),
      };
    },
  });

  assert.equal(result, "saved");
  assert.deepEqual(events, ["picker:audit-script-python-template.zip", "download", "write", "close"]);
});

test("用户取消系统保存对话框时不下载也不触发普通下载", async () => {
  let downloaded = false;
  let fallback = false;

  const result = await downloadAuditScriptTemplate({
    fallbackDownload: () => { fallback = true; },
    filename: "audit-script-javascript-template.zip",
    getBlob: async () => {
      downloaded = true;
      return new Blob();
    },
    showSaveFilePicker: async () => {
      throw new DOMException("cancelled", "AbortError");
    },
  });

  assert.equal(result, "cancelled");
  assert.equal(downloaded, false);
  assert.equal(fallback, false);
});

test("不支持系统文件选择器时回退为浏览器普通下载", async () => {
  const blob = new Blob(["fallback"]);
  let fallbackFilename = "";

  const result = await downloadAuditScriptTemplate({
    fallbackDownload: (content, filename) => {
      assert.equal(content, blob);
      fallbackFilename = filename;
    },
    filename: "audit-script-javascript-template.zip",
    getBlob: async () => blob,
  });

  assert.equal(result, "fallback");
  assert.equal(fallbackFilename, "audit-script-javascript-template.zip");
});

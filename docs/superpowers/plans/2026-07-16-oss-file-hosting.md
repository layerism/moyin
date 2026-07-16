# 阿里云 OSS 文件托管 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将文件节点从“仅提交文件名/大小 JSON”升级为后端使用 `.env` 中 AccessKey 将真实附件托管到阿里云 OSS，并在 SQLite 保存可审计元数据。

**Architecture:** FastAPI 接收 multipart 文件并完成节点权限、后缀、大小和哈希校验，再通过独立对象存储服务写入 `aidata-lm/coze/files/...` 私有前缀。SQLite 新增 `uploaded_files` 元数据表，提交接口只接受服务端已确认的 `fileId`；前端选择文件后先上传，成功后才能提交节点。

**Tech Stack:** Python 3.11, FastAPI, `oss2`, SQLite, React/TypeScript, Vite, pytest.

## Global Constraints

- AccessKey 只能从 `backend/.env` 的环境变量读取，不写入代码、测试、文档或 Git。
- 配置变量：`OSS_ENDPOINT`、`OSS_BUCKET`、`OSS_PREFIX=coze/files`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_SIGNED_URL_EXPIRES_SECONDS=600`。
- OSS 对象保持私有；下载必须经过学生权限检查并生成短时签名 URL。
- 对象键格式：`coze/files/{flow_version_id}/{flow_instance_id}/{node_key}/{upload_id}/{sanitized_filename}`。
- 不把二进制写入 SQLite；SQLite 只保存对象键和元数据。
- 保留现有 DAG 节点状态推进逻辑，不由上传动作改变审批或开放状态。
- 每个任务遵循“先写失败测试、确认失败、最小实现、确认通过、提交检查点”。

---

### Task 1: 配置、依赖与 OSS 客户端

**Files:** `backend/app/services/object_storage.py`（新建）、`backend/tests/test_object_storage.py`（新建）、`backend/.env.example`（新建）、`backend/app/core/config.py`、`backend/pyproject.toml`、`docs/00_dependencies.md`。

**Interfaces:** `ObjectStorage.put_object(key, fileobj, content_type) -> UploadedObject`、`delete_object(key)`、`signed_download_url(key, filename)`、`get_object_storage()`；异常为 `ObjectStorageError` 与 `ObjectStorageNotConfigured`。

- [ ] **Step 1: Write the failing tests**

```python
def test_missing_oss_configuration_is_explicit(monkeypatch):
    monkeypatch.setattr(settings, "oss_endpoint", "")
    with pytest.raises(ObjectStorageNotConfigured):
        ObjectStorage(settings)

def test_put_and_sign_delegate_to_bucket():
    bucket = FakeBucket()
    storage = ObjectStorage.from_bucket(bucket, prefix="coze/files", expires=600)
    result = storage.put_object("coze/files/a.txt", io.BytesIO(b"abc"), "text/plain")
    assert result.etag == "etag-1"
    assert storage.signed_download_url("coze/files/a.txt", "a.txt").startswith("https://signed/")
```

- [ ] **Step 2: Run focused tests and verify failure**

Run `cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_object_storage.py`; expected failure is missing module/interfaces.

- [ ] **Step 3: Implement minimally**

Add empty-default settings (`oss_endpoint`, `oss_bucket`, `oss_prefix`, `oss_access_key_id`, `oss_access_key_secret`, `oss_signed_url_expires_seconds=600`). Implement lazy `oss2` import, `oss2.Auth`, `oss2.Bucket`, status-code checks, normalized prefix, and signed download response headers. Add `oss2>=2.18.0` and `python-multipart>=0.0.9`; document variables in `.env.example` without values.

- [ ] **Step 4: Verify**

Run `cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_object_storage.py && ./.venv/bin/ruff check app/services/object_storage.py app/core/config.py`; expect pass and Ruff exit 0.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/object_storage.py backend/tests/test_object_storage.py backend/app/core/config.py backend/pyproject.toml backend/.env.example docs/00_dependencies.md
git commit -m "Add OSS object storage adapter"
```

### Task 2: 文件元数据、权限与学生上传/下载 API

**Files:** `backend/app/repositories/flow_files.py`（新建）、`backend/tests/test_flow_files_api.py`（新建）、`backend/app/core/database.py`、`backend/app/domain/workflow_runtime.py`、`backend/app/repositories/flow_instances.py`、`backend/app/api/routes/student_flows.py`。

**Interfaces:** `get_upload_context(node_instance_id, student_id)`、`replace_uploaded_file(...)`、`get_uploaded_file_for_node(connection, file_id, node_instance_id, student_id)`、`attach_uploaded_file(connection, file_id, submission_id)`、`validate_file_metadata(node, filename, size_bytes)`。

- [ ] **Step 1: Write failing integration tests**

```python
def test_upload_persists_metadata_and_submit_attaches_it(client, fake_storage):
    published = publish_file_flow(client)
    register(client, "20260071", "上传学生")
    instance = client.post(f"/api/student/shared/{published['token']}/enter").json()
    node_id = instance["nodeInstances"][0]["id"]
    uploaded = client.post(
        f"/api/student/node-instances/{node_id}/file",
        files={"file": ("材料.pdf", b"pdf-content", "application/pdf")},
    )
    assert uploaded.status_code == 200
    file_id = uploaded.json()["fileId"]
    submitted = client.post(
        f"/api/student/node-instances/{node_id}/submit",
        json={"payload": {"file": {"fileId": file_id}}, "idempotencyKey": "file-1"},
    )
    assert submitted.status_code == 200
    assert fake_storage.objects[uploaded.json()["storageKey"]] == b"pdf-content"

def test_wrong_extension_and_cross_student_file_id_are_rejected(client):
    published = publish_file_flow(client)
    register(client, "20260072", "权限学生")
    instance = client.post(f"/api/student/shared/{published['token']}/enter").json()
    node_id = instance["nodeInstances"][0]["id"]
    wrong = client.post(
        f"/api/student/node-instances/{node_id}/file",
        files={"file": ("材料.exe", b"x", "application/octet-stream")},
    )
    assert wrong.status_code == 409
    client.post("/api/auth/logout")
    register(client, "20260073", "另一位学生")
    other_instance = client.post(f"/api/student/shared/{published['token']}/enter").json()
    other_node_id = other_instance["nodeInstances"][0]["id"]
    client.post("/api/auth/logout")
    register(client, "20260072", "权限学生")
    valid = client.post(
        f"/api/student/node-instances/{node_id}/file",
        files={"file": ("材料.pdf", b"x", "application/pdf")},
    ).json()
    client.post("/api/auth/logout")
    register(client, "20260073", "另一位学生")
    cross_student = client.post(
        f"/api/student/node-instances/{other_node_id}/submit",
        json={"payload": {"file": {"fileId": valid["fileId"]}}, "idempotencyKey": "cross-1"},
    )
    assert cross_student.status_code == 409

def test_storage_failure_does_not_leave_metadata(client, fake_storage):
    published = publish_file_flow(client)
    register(client, "20260074", "失败学生")
    instance = client.post(f"/api/student/shared/{published['token']}/enter").json()
    node_id = instance["nodeInstances"][0]["id"]
    fake_storage.fail_put = True
    response = client.post(
        f"/api/student/node-instances/{node_id}/file",
        files={"file": ("材料.pdf", b"x", "application/pdf")},
    )
    assert response.status_code == 502
    assert fake_storage.objects == {}
```

- [ ] **Step 2: Run and confirm red**

Run `cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_flow_files_api.py`; expected failure is absent table, endpoint, repository, and `fileId` path.

- [ ] **Step 3: Add schema/repository**

Add `uploaded_files` with UUID `id`, node/student ownership, nullable `submission_id`, `storage_key`, `original_name`, `content_type`, `size_bytes`, `sha256`, `etag`, and `created_at`, plus indexes. Implement published-version/roster/deadline/status context lookup, replacement of unsubmitted files, and ownership lookup. Store no bytes.

- [ ] **Step 4: Add endpoints and validation**

Extract suffix/MB checks into `validate_file_metadata`. Add `POST /api/student/node-instances/{id}/file` with `UploadFile=File(...)`: read 1 MiB chunks, hash, reject limits, upload to a UUID key, insert metadata, and delete OSS object if DB insert fails. Add `GET /api/student/files/{file_id}/download` returning a short-lived signed URL. Map missing config to 503 and OSS failures to 502.

- [ ] **Step 5: Make submission authoritative**

For file nodes, resolve `payload.file.fileId` through the ownership repository, replace client metadata with server metadata, validate, insert submission, and attach the file in the same transaction. Reject missing, cross-node, cross-student, or already-attached IDs.

- [ ] **Step 6: Verify and commit**

Run `cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_flow_files_api.py tests/test_flow_runtime.py`; expect all pass. Then commit the six backend files with `git commit -m "Add OSS-backed student file endpoints"`.

### Task 3: 前端文件上传交互

**Files:** `frontend/tests/fileUploadApi.test.ts`（新建）、`frontend/src/features/academic-flow/api.ts`、`frontend/src/features/academic-flow/StudentRuntimePage.tsx`。

**Interfaces:** `UploadedFile` contains `fileId`, `originalName`, `contentType`, `sizeBytes`, `storageKey`; `workflowApi.uploadFile(nodeInstanceId: string, file: File) -> Promise<UploadedFile>`。

- [ ] **Step 1: Write failing API test**

```typescript
test("uploadFile sends multipart data and returns the server id", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    assert.equal(init?.method, "POST");
    assert.ok(init?.body instanceof FormData);
    return new Response(JSON.stringify({ fileId: "f1", originalName: "材料.pdf", sizeBytes: 3, contentType: "application/pdf", storageKey: "coze/files/f1/材料.pdf" }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await workflowApi.uploadFile("node-1", new File(["abc"], "材料.pdf", { type: "application/pdf" }));
    assert.equal(result.fileId, "f1");
  } finally {
    globalThis.fetch = original;
  }
});
```

- [ ] **Step 2: Run and confirm red**

Run `cd frontend && node --experimental-strip-types --test tests/fileUploadApi.test.ts`; expected failure is absent `uploadFile`.

- [ ] **Step 3: Implement**

Make the shared request helper add JSON headers only for JSON bodies. Add `uploadFile` with `FormData`. On file selection, `StudentRuntimePage` uploads immediately, disables node actions, shows “正在上传文件”, and only writes `draft.file` after a server `fileId` arrives. Submit uses `{file: {fileId, name, size, type}}`; a local filename without `fileId` is never treated as uploaded.

- [ ] **Step 4: Verify and commit**

Run `cd frontend && node --experimental-strip-types --test tests/*.test.ts && npm run build`; expect all pass. Commit with `git commit -m "Upload workflow files before submission"`.

### Task 4: 文档、真实 OSS 冒烟和收尾

**Files:** `docs/04_oa_workflow_runtime_design.md`; temporary smoke artifacts must stay outside the repo.

- [ ] **Step 1: Update docs**

Replace the statement that binary storage is outside this iteration with the implemented OSS boundary, environment variables, metadata table, private-object policy, and cleanup behavior; never include credentials.

- [ ] **Step 2: Install and run complete tests**

Run `cd backend && ./.venv/bin/python -m pip install -e '.[dev]'`, then `PYTHONPATH=. ./.venv/bin/pytest -q`. Run `cd frontend && node --experimental-strip-types --test tests/*.test.ts && npm run build && git diff --check`; all commands must exit 0.

- [ ] **Step 3: Real OSS smoke test**

From `backend`, load `.env` and use a unique key below `coze/files/smoke/` to upload a few bytes, create a signed URL, fetch and verify the bytes, then delete the object. Print only endpoint, bucket, key prefix, HTTP status, and byte count; never print environment values or signed URLs.

- [ ] **Step 4: Browser verification**

Use the current Browser tab to open a file node, select an allowed file, observe upload progress/success, submit, and verify DAG advancement; check a disallowed extension is rejected and Browser console has no relevant errors.

- [ ] **Step 5: Commit docs and verify secret hygiene**

Commit docs with `git commit -m "Document OSS file hosting runtime"`; then run `git status --short --ignored backend/.env` and verify `.env` remains ignored and no staged diff contains credentials.

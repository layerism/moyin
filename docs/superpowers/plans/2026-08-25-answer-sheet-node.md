# Answer Sheet Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task in the current branch. This repository explicitly forbids subagents for this task and requires only a baseline checkpoint plus a final result commit.

**Goal:** Add a versioned `answer_sheet` workflow node with Markdown/KaTeX content, teacher-owned images, single-choice, multiple-choice and fill-blank questions, private answer keys, synchronous deterministic grading, configurable attempts/feedback, and roster-based Excel export.

**Architecture:** Public question content remains in the workflow JSON snapshot while answer keys live in private draft/version tables that student APIs never serialize. Teacher content images use a dedicated OSS-backed asset lifecycle. Student submission uses the existing node transaction and DAG statuses, but invokes a pure answer-sheet grader synchronously and stores an immutable one-to-one grade record.

**Tech Stack:** React 18, TypeScript, Vite 5, Milkdown Crepe, react-markdown, KaTeX, FastAPI, Python 3.11, SQLite, openpyxl, Alibaba Cloud OSS.

**Spec:** `docs/07_answer_sheet_node_design.md`

## Global Constraints

- Use the current branch; do not create a worktree.
- Do not start subagents.
- Create exactly two task-scoped commits: the baseline documentation checkpoint and the final implementation checkpoint.
- Do not run tests, browser automation, or Docker during implementation; write behavior tests first, then perform only static business-logic auditing and `git diff --check`.
- Use project-local Node.js 24.18.0 and npm 11.16.0 through `.local/node/bin`.
- Preserve all unrelated working-tree changes.
- Teacher preview and formal student runtime must reuse the same visible components and behavior.
- Published public question snapshots, private answer keys, grader version, grading hash and referenced images are immutable.
- Standard answers must never appear in student runtime JSON.
- Existing published nodes cannot change answer-sheet structure or answer keys.
- Answer-sheet grading is synchronous and must not create `audit_jobs`.
- Student-facing errors must not expose OSS keys, hashes or private answer data.

---

### Task 1: Pure answer-sheet contracts and deterministic grader

**Files:**
- Create: `backend/app/domain/answer_sheet.py`
- Create: `backend/tests/test_answer_sheet.py`
- Modify: `backend/app/domain/workflow.py`
- Modify: `frontend/src/types.ts`
- Create: `frontend/src/features/academic-flow/answerSheet.ts`
- Create: `frontend/tests/answerSheet.test.ts`

**Interfaces:**
- Produces Python `validate_public_answer_sheet(node, require_publishable)`, `validate_private_answer_key(node, key)`, `normalize_answer_sheet_submission(node, payload, strict)`, `grade_answer_sheet(node, key, payload)`.
- Produces TypeScript `AnswerSheetConfig`, `AnswerSheetPrivateKey`, `AnswerSheetSubmission`, `AnswerSheetGrade`, `createDefaultAnswerSheet()`, `validateAnswerSheetAuthoring()`.
- `grade_answer_sheet` returns a JSON-serializable result containing `schemaVersion`, `graderVersion`, `score`, `maxScore`, `passingScore`, `passed`, and per-question results without standard answers.

- [ ] **Step 1: Write Python behavior tests before production code**

```python
def test_multiple_choice_requires_exact_set():
    node, key = answer_sheet_fixture()
    grade = grade_answer_sheet(node, key, {
        "answers": {"q2": {"selectedOptionIds": ["o3", "o1"]}}
    })
    assert grade["questionResults"][1]["awardedPoints"] == 3


def test_fill_blank_normalizes_nfc_trim_and_casefold():
    node, key = answer_sheet_fixture()
    grade = grade_answer_sheet(node, key, {
        "answers": {"q3": {"blankValues": {"b1": " Four "}}}
    })
    assert grade["questionResults"][2]["awardedPoints"] == 3


def test_student_score_fields_are_rejected():
    with pytest.raises(AnswerSheetSubmissionError):
        normalize_answer_sheet_submission(node, {"answers": {}, "score": 100}, strict=True)
```

- [ ] **Step 2: Write TypeScript authoring-validation tests**

```typescript
test("rejects a single-choice question without exactly one private answer", () => {
  const errors = validateAnswerSheetAuthoring(publicConfig, { answers: {} });
  assert.equal(errors.q1, "请选择唯一正确答案");
});
```

- [ ] **Step 3: Implement the minimal pure domain functions and shared types**

```python
def grade_answer_sheet(node: dict[str, Any], key: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_answer_sheet_submission(node, payload, strict=True)
    question_results = [_grade_question(question, key["answers"][question["id"]], normalized)
                        for question in node["answerSheet"]["questions"]]
    score = sum(item["awardedPoints"] for item in question_results)
    passing_score = node["answerSheet"]["gradingPolicy"]["passingScore"]
    return {"schemaVersion": "1.0", "graderVersion": "answer-sheet-v1",
            "score": score, "maxScore": _max_score(node),
            "passingScore": passing_score, "passed": score >= passing_score,
            "questionResults": question_results}
```

- [ ] **Step 4: Extend workflow validation without exposing private keys**

```python
for node in nodes:
    validate_public_answer_sheet(node, require_publishable=require_publishable)
```

- [ ] **Step 5: Statically audit public/private key agreement**

Check that every question/option/blank ID exists exactly once, unknown payload keys fail, points are positive integers, multiple-choice order is irrelevant, fill answers use NFC/trim/casefold only, and the grade result contains no accepted answers.

---

### Task 2: Database tables and private repositories

**Files:**
- Modify: `backend/app/core/database.py`
- Create: `backend/app/repositories/answer_sheet_keys.py`
- Create: `backend/app/repositories/answer_sheet_grades.py`
- Create: `backend/app/repositories/flow_content_assets.py`
- Modify: `backend/app/repositories/database_admin.py`
- Modify: `backend/tests/test_database_admin.py`

**Interfaces:**
- `replace_answer_sheet_drafts(connection, flow_id, configs, actor_id, now)` stores only private keys for current public answer-sheet node IDs.
- `freeze_answer_sheet_keys(connection, flow_id, flow_version_id, public_config, now)` validates and inserts immutable private snapshots.
- `get_version_answer_key(connection, flow_version_id, node_key)` returns `{gradingKey, gradingHash}`.
- `insert_answer_sheet_grade(connection, submission_id, grade, grading_hash, created_at)` writes one immutable grade.
- Content-asset repository follows the ownership checks used by `flow_templates.py`, but permits multiple images per node.

- [ ] **Step 1: Add schema assertions to database tests**

```python
assert {"answer_sheet_drafts", "flow_version_answer_keys", "flow_content_assets",
        "flow_version_content_assets", "answer_sheet_grades"} <= table_names
```

- [ ] **Step 2: Add the five tables and ownership indexes**

```sql
CREATE TABLE IF NOT EXISTS flow_version_answer_keys (
    flow_version_id TEXT NOT NULL REFERENCES flow_versions(id) ON DELETE CASCADE,
    node_key TEXT NOT NULL,
    grading_snapshot TEXT NOT NULL,
    grading_hash TEXT NOT NULL,
    PRIMARY KEY(flow_version_id, node_key)
);
```

Add equivalent constrained schemas for drafts, content assets, version asset references, and one-to-one grades. `answer_sheet_grades.submission_id` must reference `submissions(id) ON DELETE CASCADE`.

- [ ] **Step 3: Implement private key persistence and canonical SHA-256 hashing**

```python
snapshot = canonical_json(private_key)
grading_hash = hashlib.sha256(snapshot.encode("utf-8")).hexdigest()
```

- [ ] **Step 4: Implement immutable grade persistence and student-safe serialization**

```python
def student_grade_view(result: dict[str, Any], feedback: str, deadline_passed: bool) -> dict[str, Any]:
    # Return only score/pass and the feedback-permitted result fields.
```

- [ ] **Step 5: Register new tables in database admin policies**

Keep private key and grade rows read-only. Add `grading_snapshot` to sensitive columns so the generic row viewer redacts standard answers.

---

### Task 3: Teacher draft, revision, publishing, preview and cloning

**Files:**
- Modify: `backend/app/api/routes/workflows.py`
- Modify: `backend/app/repositories/workflows.py`
- Modify: `backend/app/repositories/flow_previews.py`
- Modify: `backend/app/domain/workflow_revision.py`
- Modify: `backend/tests/test_workflows.py`
- Modify: `backend/tests/test_workflow_revision.py`
- Modify: `backend/tests/test_workflow_republish.py`
- Modify: `frontend/src/features/academic-flow/api.ts`
- Modify: `frontend/src/features/academic-flow/runtimeTypes.ts`

**Interfaces:**
- Teacher draft request becomes `{config, answerSheetKeys}`; teacher flow responses include `answerSheetKeys` only on authenticated teacher endpoints.
- `draftHash` is SHA-256 of canonical `{config, answerSheetKeys}` and replaces public-config-only conflict detection for save/publish/revision impact.
- Publish and preview freeze public config, private answer keys and content-asset references in one transaction.
- Clone creates new private draft keys and new content assets, then rewrites `asset://<oldId>` references to new IDs.

- [ ] **Step 1: Add repository tests for answer-only dirty state and publication**

```python
def test_private_answer_change_marks_flow_unpublished(client, teacher_headers):
    # Save identical public config with a changed q1 key.
    flow = client.get(flow_url, headers=teacher_headers).json()
    assert flow["hasUnpublishedChanges"] is True
```

- [ ] **Step 2: Extend teacher request/response models**

```python
class FlowDraftRequest(BaseModel):
    config: dict[str, Any]
    answerSheetKeys: dict[str, dict[str, Any]] = Field(default_factory=dict)
```

- [ ] **Step 3: Save public and private draft data transactionally**

Call `replace_answer_sheet_drafts` after public validation and before transaction commit. Reject keys for non-answer-sheet or unknown nodes.

- [ ] **Step 4: Compute composite draft hashes and revision conflicts**

```python
draft_hash = sha256(canonical_json({"config": config, "answerSheetKeys": keys}))
```

- [ ] **Step 5: Freeze answer keys and referenced content assets during publish and preview**

Use the newly inserted version ID, then call `freeze_answer_sheet_keys` and `freeze_content_asset_refs` before creating/migrating instances.

- [ ] **Step 6: Enforce published private-key immutability**

For every previously published answer-sheet node, compare its published `grading_hash` with the current draft key hash and raise `PublishedNodeMutationError` on change.

- [ ] **Step 7: Extend clone and delete lifecycles**

Clone OSS objects and asset metadata like existing template cloning, rewrite Markdown asset IDs, copy private keys, and compensate newly copied OSS keys on failure. Delete grade rows before submissions and delete unreferenced content objects after resolving exact storage keys.

---

### Task 4: Teacher image upload and authorized student delivery

**Files:**
- Modify: `backend/app/api/routes/workflows.py`
- Modify: `backend/app/api/routes/student_flows.py`
- Modify: `backend/app/repositories/flow_content_assets.py`
- Modify: `backend/app/services/object_storage.py` only if the current generic signed URL method cannot serve inline content safely
- Modify: `backend/tests/test_object_storage.py`
- Create: `backend/tests/test_answer_sheet_assets.py`
- Modify: `frontend/src/features/academic-flow/api.ts`

**Interfaces:**
- `POST /api/workflows/{flowId}/nodes/{nodeKey}/answer-sheet-assets` accepts one PNG/JPEG/WebP up to 5 MiB and returns public metadata without `storage_key`.
- `DELETE /api/workflows/{flowId}/answer-sheet-assets/{assetId}` rejects assets referenced by any version.
- `GET /api/student/flow-instances/{instanceId}/content-assets/{assetId}` checks runtime identity, roster, version reference and returns a short-lived URL.

- [ ] **Step 1: Write route ownership and validation tests**

```python
def test_student_cannot_read_asset_from_another_flow(...):
    response = client.get(other_asset_url, headers=student_headers)
    assert response.status_code == 404
```

- [ ] **Step 2: Implement teacher upload with compensating OSS deletion**

Follow the existing template route order: validate metadata, put object, insert DB row, delete object if DB insertion fails.

- [ ] **Step 3: Implement deletion protection and authorized signed access**

Reject SVG, GIF, external URLs and cross-flow/node ownership. Never return `storage_key` to the browser.

- [ ] **Step 4: Add frontend multipart upload/delete/download methods**

Keep the API result as `{assetId, originalName, contentType, sizeBytes, sha256}`.

---

### Task 5: Student draft, synchronous grading and feedback

**Files:**
- Modify: `backend/app/domain/workflow_runtime.py`
- Modify: `backend/app/repositories/flow_instances.py`
- Modify: `backend/app/api/routes/student_flows.py`
- Modify: `backend/tests/test_flow_runtime.py`
- Modify: `frontend/src/features/academic-flow/runtimeTypes.ts`

**Interfaces:**
- Drafts call `normalize_answer_sheet_submission(..., strict=False)`.
- Submit reads the private key by `(flow_version_id, node_key)`, enforces `maxAttempts`, grades before inserting, writes submission and grade in the same transaction, then maps `passed` to `approved/rejected`.
- Runtime node serialization adds `grade` and `attemptsRemaining` but never a private key.

- [ ] **Step 1: Add runtime tests for grading, attempts, idempotency and secrecy**

```python
def test_answer_sheet_submit_grades_and_advances_downstream(...):
    result = submit_answer_sheet(correct_answers)
    assert node(result, "quiz")["status"] == "approved"
    assert node(result, "next")["status"] == "available"
    assert "correctOptionId" not in json.dumps(result)
```

- [ ] **Step 2: Normalize answer-sheet drafts**

Add an `answer_sheet` branch next to the existing form normalization branch without changing file/confirmation behavior.

- [ ] **Step 3: Grade synchronously inside `submit_node`**

```python
if node.get("kind") == "answer_sheet":
    key_record = get_version_answer_key(connection, row["flow_version_id"], row["node_key"])
    submission_payload = normalize_answer_sheet_submission(node, payload, strict=True)
    grade = grade_answer_sheet(node, key_record["gradingKey"], submission_payload)
    submission_status = "approved" if grade["passed"] else "rejected"
```

- [ ] **Step 4: Persist the grade and preserve idempotency**

Insert the grade immediately after the submission ID exists. Duplicate idempotency keys must return the original stored grade and must not increment attempts.

- [ ] **Step 5: Serialize only feedback-permitted grade fields**

Apply `score_only`, `question_result`, or `full_after_deadline` on the backend. The default response contains no standard answer.

---

### Task 6: Teacher editor, Markdown math and student answer UI

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/src/features/academic-flow/academicFlowData.ts`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx`
- Modify: `frontend/src/features/academic-flow/StudentFlowTopology.tsx`
- Modify: `frontend/src/styles.css`
- Create: `frontend/src/features/academic-flow/AnswerSheetEditor.tsx`
- Create: `frontend/src/features/academic-flow/CrepeMarkdownEditor.tsx`
- Create: `frontend/src/features/academic-flow/AnswerSheetMarkdown.tsx`
- Create: `frontend/src/features/academic-flow/RuntimeAnswerSheet.tsx`
- Create: `frontend/src/features/academic-flow/ReadonlyAnswerSheet.tsx`
- Create: `frontend/src/features/academic-flow/answerSheetMarkdown.ts`
- Modify: `frontend/tests/answerSheet.test.ts`

**Interfaces:**
- `CrepeMarkdownEditor({value, disabled, onChange, onUploadImage})` dynamically loads Milkdown only while an editable answer-sheet inspector is open.
- `AnswerSheetMarkdown({children, flowId, instanceId})` uses react-markdown and the same formula parser for all teacher/student read-only content.
- `RuntimeAnswerSheet({config, payload, errors, onUpdate})` uses stable question/option/blank IDs.

- [ ] **Step 1: Add exact dependency records using project-local npm**

```bash
export PATH="$PWD/.local/node/bin:$PATH"
npm --prefix frontend install @milkdown/crepe @milkdown/kit katex rehype-katex remark-math
```

- [ ] **Step 2: Write parser tests before the parser implementation**

```typescript
test("parses double-dollar inline math outside code", () => {
  assert.deepEqual(tokenizeAnswerSheetMath("值为 $$x^2$$。"), [
    { type: "text", value: "值为 " },
    { type: "inlineMath", value: "x^2" },
    { type: "text", value: "。" },
  ]);
});
```

- [ ] **Step 3: Implement shared delimiter parsing and serialization**

Parse `$$$$` blocks before `$$` inline formulas and exclude fenced/inline code. Store original Markdown, never generated HTML.

- [ ] **Step 4: Build the teacher editor and answer configuration cards**

Use stable IDs, native accessible radio/checkbox controls, drag handles consistent with the existing form editor, field-level errors and derived total score. Lazy-load Milkdown so the heavy editor is absent from student and home bundles.

- [ ] **Step 5: Integrate node creation, inspector and publish validation**

Add `answer_sheet` to node templates, labels, icons and setting capabilities. Keep answer-sheet settings locked for published nodes.

- [ ] **Step 6: Build the shared student runtime and read-only result**

Render question cards in one scrollable form, fill blanks at marker positions, show answered count, confirm incomplete submissions and render backend-supplied feedback only.

- [ ] **Step 7: Preserve preview/formal-runtime parity**

Use `StudentRuntimePage` for both paths; do not branch visible answer-sheet behavior on preview identity.

---

### Task 7: Teacher detail and roster-based Excel export

**Files:**
- Modify: `backend/app/repositories/flow_instances.py`
- Modify: `backend/app/repositories/teacher_node_exports.py`
- Modify: `backend/app/services/node_submission_workbook.py`
- Modify: `backend/tests/test_flow_runtime.py`
- Modify: `frontend/src/features/academic-flow/TeacherProgressPanel.tsx`
- Modify: `frontend/src/features/academic-flow/runtimeTypes.ts`

**Interfaces:**
- Teacher submission detail includes full answer-sheet grade and submitted answers.
- Export selection joins `answer_sheet_grades` by submission ID.
- Workbook includes `学生成绩`, `学生答案`, and `题目说明`; active roster remains the row source and unsubmitted answer/score cells remain blank.

- [ ] **Step 1: Add workbook behavior tests**

```python
def test_answer_sheet_export_keeps_unsubmitted_cells_blank(...):
    workbook = load_workbook(BytesIO(content))
    row = find_student(workbook["学生成绩"], "20260002")
    assert row["提交时间"].value is None
    assert row["总分"].value is None
```

- [ ] **Step 2: Join immutable grades into teacher export selection**

Do not derive historical scores again from current code; export the stored grade snapshot.

- [ ] **Step 3: Generate the three answer-sheet sheets**

Escape formula-like cell values with the existing `_excel_cell`, keep student number as text, and include Markdown source rather than generated HTML in the question sheet.

- [ ] **Step 4: Extend teacher detail UI**

Show total score, pass state, attempt number and per-question awarded points without exposing storage keys.

---

### Task 8: Static audit, task-scoped result commit and local restart

**Files:**
- Review all files listed above.
- Update: `docs/07_answer_sheet_node_design.md` only if implementation contracts differ from the approved design.

**Interfaces:**
- No new behavior; this task proves scope, call-chain consistency and clean handoff within the repository's no-test constraint.

- [ ] **Step 1: Audit the end-to-end call chains**

```text
teacher editor -> composite draft -> private key draft -> publish/preview freeze
student runtime -> public config -> draft -> submit -> private key -> grade -> status -> DAG
teacher asset upload -> version reference -> authorized student signed URL
teacher export -> active roster -> current submission -> stored grade -> workbook
```

- [ ] **Step 2: Search for exhaustive node-kind branches**

Use `rg` to inspect every `kind ===`, node label map, validation branch, runtime renderer, export branch and revision snapshot field.

- [ ] **Step 3: Check diffs without executing tests or builds**

```bash
git diff --check
git status --short
```

- [ ] **Step 4: Remove only task-generated Python caches**

Delete `.pytest_cache`, `__pycache__`, and `*.egg-info` created by this task only. Do not remove dependency directories.

- [ ] **Step 5: Create the final task-scoped commit**

Stage only answer-sheet implementation, tests, dependency lockfile and documents, then create one result checkpoint commit.

- [ ] **Step 6: Restart local services without Docker**

Use the project-local Node runtime for the frontend, start the backend from `backend/`, and verify only that ports 5173 and 8000 are owned by the expected project processes. Do not issue browser or HTTP requests.

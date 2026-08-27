# OSS Student Material Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock OSS home page with a teacher-authorized, read-only library of current student submission files grouped by published flow, node, and student.

**Architecture:** A single teacher catalog endpoint returns hierarchy metadata from the current published snapshots, active roster, current node attempts, and effective submissions. A separate file endpoint repeats the authorization query before generating a short-lived OSS URL. The React home view loads the catalog once and performs local drill-down and current-level search without exposing storage keys.

**Tech Stack:** FastAPI, SQLite, Python 3.11, React 18, TypeScript, Vite 5, existing OSS storage service.

**Spec:** `docs/superpowers/specs/2026-08-27-oss-material-library-design.md`

## Global Constraints

- Only flows owned by the authenticated teacher with `flows.status = 'published'` and the current `flow_versions.status = 'published'` version are visible.
- Node labels and order come from the immutable published `config_snapshot`; only file nodes and confirmation nodes requiring scans appear.
- Students must have an active roster entry; files must belong to the current node attempt and a submission in `reviewing`, `approved`, `rejected`, or `audit_error`.
- Pending uploads, invalidated attempts, cancelled submissions, historical versions, storage keys, templates, content images, and answer data remain invisible.
- The library is read-only. Do not add create, upload, rename, move, delete, bulk download, pagination, or global search.
- No database migration or OSS object movement is allowed.
- Preserve all unrelated worktree changes and commit only task files.
- Repository instructions override the general TDD workflow: do not run automated tests, frontend builds, browser checks, or HTTP health checks. Use static business-logic audit only.
- The existing design commit `9669152` is the implementation checkpoint. Do not create intermediate commits; create one final scoped implementation commit after all static checks.
- Use project Node.js only when a Node command is explicitly needed: `export PATH="$PWD/.local/node/bin:$PATH"`. This plan does not require a Node command.

---

### Task 1: Teacher material catalog and download authorization

**Files:**
- Modify: `backend/app/repositories/teacher_materials.py`
- Modify: `backend/app/api/routes/workflow_admin.py`

**Interfaces:**
- Consumes: `get_connection()`, `confirmation_requires_scans()`, `node_by_key()`, `get_current_teacher()`, and `get_object_storage().signed_download_url(storage_key, original_name)`.
- Produces: `list_teacher_material_library(teacher_id: int) -> tuple[TeacherMaterialLibraryFlow, ...]` and `get_teacher_material_library_file(file_id: str, teacher_id: int) -> TeacherMaterialLibraryDownload`.
- Produces HTTP: `GET /api/workflow-admin/material-library` and `GET /api/workflow-admin/material-library/files/{file_id}/download`.

- [ ] **Step 1: Add focused immutable catalog records**

Add these records beside the existing teacher material records in `teacher_materials.py`:

```python
@dataclass(frozen=True)
class TeacherMaterialLibraryFile:
    file_id: str
    original_name: str
    content_type: str
    size_bytes: int
    created_at: str
    submitted_at: str
    submission_status: str


@dataclass(frozen=True)
class TeacherMaterialLibraryStudent:
    roster_entry_id: int
    student_no: str
    name: str
    files: tuple[TeacherMaterialLibraryFile, ...]


@dataclass(frozen=True)
class TeacherMaterialLibraryNode:
    node_key: str
    title: str
    students: tuple[TeacherMaterialLibraryStudent, ...]


@dataclass(frozen=True)
class TeacherMaterialLibraryFlow:
    flow_id: str
    version_id: str
    name: str
    nodes: tuple[TeacherMaterialLibraryNode, ...]


@dataclass(frozen=True)
class TeacherMaterialLibraryDownload:
    file_id: str
    original_name: str
    storage_key: str
```

- [ ] **Step 2: Query current published flows and build empty node folders from snapshots**

Implement `list_teacher_material_library()` by first selecting all current published versions for the teacher:

```sql
SELECT f.id AS flow_id, f.name, f.created_at,
       v.id AS version_id, v.config_snapshot
FROM flows f
JOIN flow_versions v ON v.flow_id = f.id AND v.status = 'published'
WHERE f.owner_id = ? AND f.status = 'published'
ORDER BY f.created_at DESC
```

For each row, parse `config_snapshot`, call existing `_material_nodes(config)`, and create the flow and node ordering maps from the snapshot before reading files. This guarantees that published flows and material nodes remain present when their student/file lists are empty.

- [ ] **Step 3: Load only active-roster current-attempt files in one query**

When published version IDs exist, run one parameterized query using an `IN` placeholder list:

```sql
SELECT v.id AS version_id, n.node_key,
       r.id AS roster_entry_id, r.student_no, r.name,
       u.id AS file_id, u.original_name, u.content_type,
       u.size_bytes, u.created_at, u.display_order,
       s.submitted_at, s.status AS submission_status
FROM uploaded_files u
JOIN submissions s ON s.id = u.submission_id
JOIN node_instances n ON n.id = s.node_instance_id
JOIN flow_instances i ON i.id = n.flow_instance_id
JOIN flow_versions v ON v.id = i.flow_version_id
JOIN flows f ON f.id = v.flow_id
JOIN student_accounts a ON a.id = i.student_account_id
JOIN flow_roster_entries r
  ON r.flow_id = f.id
 AND r.student_no = a.student_no
 AND r.name = a.name
 AND r.status = 'active'
WHERE v.id IN ({placeholders})
  AND v.status = 'published'
  AND f.status = 'published'
  AND f.owner_id = ?
  AND a.account_kind = 'normal'
  AND s.attempt_no = n.attempt_no
  AND s.status IN (?, ?, ?, ?)
ORDER BY v.id, n.node_key, r.student_no,
         u.display_order, u.created_at, u.id
```

Pass `*version_ids`, `str(teacher_id)`, and `*CURRENT_MATERIAL_STATUSES`. Ignore rows whose `node_key` is not in the material-node map derived from that version snapshot. Group remaining rows by version, node, and `roster_entry_id`; return tuples in flow snapshot, node snapshot, student-number, and file query order.

- [ ] **Step 4: Add a dedicated single-file authorization query**

Implement `get_teacher_material_library_file()` with the same ownership and effectiveness joins, filtered by `u.id = ?`. Select `v.config_snapshot`, `n.node_key`, `u.storage_key`, and `u.original_name`. After fetching, parse the snapshot, resolve the node with `node_by_key()`, and reject it unless it is a file node or `confirmation_requires_scans(node)` is true:

```python
if row is None:
    raise KeyError(file_id)
config = json.loads(row["config_snapshot"])
try:
    node = node_by_key(config, str(row["node_key"]))
except KeyError as exc:
    raise KeyError(file_id) from exc
if not (node.get("kind") == "file" or confirmation_requires_scans(node)):
    raise KeyError(file_id)
return TeacherMaterialLibraryDownload(
    file_id=str(row["file_id"]),
    original_name=str(row["original_name"]),
    storage_key=str(row["storage_key"]),
)
```

Use `WHERE u.id = ?`, `f.owner_id = ?`, `f.status = 'published'`, `v.status = 'published'`, active roster matching, `a.account_kind = 'normal'`, current attempt matching, and the four effective submission statuses in this query. Do not authorize from a client-supplied flow, version, node, or student identifier.

- [ ] **Step 5: Expose catalog metadata without storage keys**

Add a route before the existing version material routes in `workflow_admin.py`. Serialize the dataclasses explicitly:

```python
@router.get("/material-library")
def material_library(
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    flows = list_teacher_material_library(int(teacher["id"]))
    return {
        "flows": [
            {
                "flowId": flow.flow_id,
                "versionId": flow.version_id,
                "name": flow.name,
                "nodes": [
                    {
                        "nodeKey": node.node_key,
                        "title": node.title,
                        "students": [
                            {
                                "rosterEntryId": student.roster_entry_id,
                                "studentNo": student.student_no,
                                "name": student.name,
                                "files": [
                                    {
                                        "fileId": file.file_id,
                                        "originalName": file.original_name,
                                        "contentType": file.content_type,
                                        "sizeBytes": file.size_bytes,
                                        "createdAt": file.created_at,
                                        "submittedAt": file.submitted_at,
                                        "submissionStatus": file.submission_status,
                                    }
                                    for file in student.files
                                ],
                            }
                            for student in node.students
                        ],
                    }
                    for node in flow.nodes
                ],
            }
            for flow in flows
        ]
    }
```

- [ ] **Step 6: Expose re-authorized signed downloads**

Add the file route with non-leaking errors:

```python
@router.get("/material-library/files/{file_id}/download")
def download_material_library_file(
    file_id: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        record = get_teacher_material_library_file(file_id, int(teacher["id"]))
        return {
            "fileId": record.file_id,
            "originalName": record.original_name,
            "url": get_object_storage().signed_download_url(
                record.storage_key,
                record.original_name,
            ),
        }
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="文件不存在或已失效") from exc
    except ObjectStorageNotConfigured as exc:
        raise HTTPException(status_code=503, detail="文件存储服务未配置") from exc
    except ObjectStorageError as exc:
        raise HTTPException(status_code=503, detail="文件下载链接生成失败") from exc
```

- [ ] **Step 7: Perform the backend static audit**

Run only source searches and whitespace validation:

```bash
rg -n "material-library|list_teacher_material_library|get_teacher_material_library_file|storageKey" backend/app
git diff --check -- backend/app/repositories/teacher_materials.py backend/app/api/routes/workflow_admin.py
```

Read both SQL statements end to end. Confirm catalog and download enforce the same owner, published flow/version, active roster, normal account, current attempt, and effective-status conditions; confirm the catalog serializer contains no `storageKey` or `storage_key` field.

---

### Task 2: Frontend API contract and read-only hierarchy

**Files:**
- Modify: `frontend/src/features/academic-flow/api.ts`
- Create: `frontend/src/features/home/OssMaterialLibraryView.tsx`

**Interfaces:**
- Consumes: `GET /api/workflow-admin/material-library` and `GET /api/workflow-admin/material-library/files/{fileId}/download` from Task 1.
- Produces: `MaterialLibrary`, `MaterialLibraryFlow`, `MaterialLibraryNode`, `MaterialLibraryStudent`, `MaterialLibraryFile`, `workflowApi.getMaterialLibrary()`, and `workflowApi.downloadMaterialLibraryFile(fileId)`.
- Produces UI path state keyed by `flowId`, `nodeKey`, and `rosterEntryId`; no display name is used as an identifier.

- [ ] **Step 1: Define the exact frontend response types**

Add these exported types in `api.ts` near the existing teacher package types:

```typescript
export type MaterialLibraryFile = {
  contentType: string;
  createdAt: string;
  fileId: string;
  originalName: string;
  sizeBytes: number;
  submissionStatus: "reviewing" | "approved" | "rejected" | "audit_error";
  submittedAt: string;
};

export type MaterialLibraryStudent = {
  files: MaterialLibraryFile[];
  name: string;
  rosterEntryId: number;
  studentNo: string;
};

export type MaterialLibraryNode = {
  nodeKey: string;
  students: MaterialLibraryStudent[];
  title: string;
};

export type MaterialLibraryFlow = {
  flowId: string;
  name: string;
  nodes: MaterialLibraryNode[];
  versionId: string;
};

export type MaterialLibrary = { flows: MaterialLibraryFlow[] };
```

- [ ] **Step 2: Add catalog and download methods**

Add methods to `workflowApi`:

```typescript
getMaterialLibrary() {
  return request<MaterialLibrary>("/api/workflow-admin/material-library");
},
downloadMaterialLibraryFile(fileId: string) {
  return request<{ fileId: string; originalName: string; url: string }>(
    `/api/workflow-admin/material-library/files/${encodeURIComponent(fileId)}/download`,
  );
},
```

- [ ] **Step 3: Replace mock HomeView props and state**

Create `OssMaterialLibraryView` with this prop contract:

```typescript
{
  onAcademicFlow: () => void;
  onDatabaseAdmin: () => void;
  onTeacherLogout: () => void;
  teacherIdentity: AuthIdentity;
}
```

Inside the component define:

```typescript
type MaterialLibraryPath =
  | { level: "root" }
  | { level: "flow"; flowId: string }
  | { level: "node"; flowId: string; nodeKey: string }
  | { level: "student"; flowId: string; nodeKey: string; rosterEntryId: number };

const [library, setLibrary] = useState<MaterialLibrary | null>(null);
const [path, setPath] = useState<MaterialLibraryPath>({ level: "root" });
const [query, setQuery] = useState("");
const [loading, setLoading] = useState(true);
const [loadError, setLoadError] = useState("");
const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
const [downloadError, setDownloadError] = useState<{ fileId: string; message: string } | null>(null);
```

Use a `useCallback` loader that clears `loadError`, sets `loading`, calls `workflowApi.getMaterialLibrary()`, stores the result, resets `path` to root if the currently selected IDs no longer resolve, and preserves the old catalog on retry failure. Call it from `useEffect` on mount.

- [ ] **Step 4: Derive the current level from stable IDs**

Resolve selected values from the loaded catalog:

```typescript
const selectedFlow = path.level === "root"
  ? null
  : library?.flows.find((flow) => flow.flowId === path.flowId) ?? null;
const selectedNode = path.level === "node" || path.level === "student"
  ? selectedFlow?.nodes.find((node) => node.nodeKey === path.nodeKey) ?? null
  : null;
const selectedStudent = path.level === "student"
  ? selectedNode?.students.find((student) => student.rosterEntryId === path.rosterEntryId) ?? null
  : null;
```

Reset `query` and `downloadError` whenever `path` changes. Filter only the current level by lowercase display name: flow name, node title, `studentNo-name`, or file original name.

- [ ] **Step 5: Render clickable breadcrumbs and folder rows**

Replace the mock controls and dialogs with:

- Sidebar buttons for “教务流程” and selected “OSS 云盘”; no new/upload buttons and no context-menu handlers.
- Search input with placeholder `搜索当前目录` and value bound to `query`.
- Breadcrumb buttons for `OSS 云盘`, selected flow, selected node, and selected student; clicking a crumb sets the corresponding `MaterialLibraryPath`.
- Root rows set `{ level: "flow", flowId }` and display `${flow.nodes.length} 个节点` plus the sum of file counts.
- Flow rows set `{ level: "node", flowId, nodeKey }` and display `${node.students.length} 名学生` plus the sum of file counts.
- Node rows set `{ level: "student", flowId, nodeKey, rosterEntryId }` and display `studentNo－name` plus `${student.files.length} 个文件`.
- Student file rows display original name, formatted bytes, `new Date(file.submittedAt).toLocaleString("zh-CN")`, a status label, and download button.

Use the exact status mapping:

```typescript
const materialStatusLabels: Record<MaterialLibraryFile["submissionStatus"], string> = {
  reviewing: "审核中",
  approved: "已通过",
  rejected: "已驳回",
  audit_error: "审核异常",
};
```

Use a local byte formatter: `0 B` for zero, bytes below 1024, one decimal KB below 1 MiB, and one decimal MB otherwise.

- [ ] **Step 6: Implement isolated single-file download state**

Use the existing anchor-download pattern:

```typescript
const downloadFile = async (file: MaterialLibraryFile) => {
  setDownloadingFileId(file.fileId);
  setDownloadError(null);
  try {
    const result = await workflowApi.downloadMaterialLibraryFile(file.fileId);
    const anchor = document.createElement("a");
    anchor.href = result.url;
    anchor.download = result.originalName;
    anchor.rel = "noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } catch (reason) {
    setDownloadError({
      fileId: file.fileId,
      message: reason instanceof Error ? reason.message : "文件下载失败",
    });
  } finally {
    setDownloadingFileId(null);
  }
};
```

Disable only the matching file button and label it `下载中`. Render `downloadError.message` only beside the matching file row with `role="alert"`.

- [ ] **Step 7: Implement exact loading, failure, and empty copy**

Use these states:

- Initial loading: `正在读取学生材料…`
- Catalog failure: error text plus button `重新加载`
- Empty root: `暂无已发布流程`
- Empty flow: `该流程暂无学生提交文件`
- Empty node: `该节点暂无学生提交文件`
- Empty search result: `当前目录没有匹配项`

Do not clear a successfully loaded catalog when retrying. If a refreshed catalog removes the current directory, reset to root.

- [ ] **Step 8: Perform the frontend state audit**

Run:

```bash
rg -n "getMaterialLibrary|downloadMaterialLibraryFile|MaterialLibraryPath|rosterEntryId|storageKey" frontend/src
git diff --check -- frontend/src/features/academic-flow/api.ts frontend/src/features/home/OssMaterialLibraryView.tsx
```

Read every path transition and confirm names are display-only, identifiers drive selection, search is current-level only, and only one file button is disabled during download.

---

### Task 3: Remove obsolete mock state and align the existing visual system

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/features/home/HomeView.tsx`
- Modify: `frontend/src/features/home/HomeDialogs.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: the reduced `HomeView` prop contract from Task 2.
- Produces: no mock cloud state, no mock cloud CRUD types/components, and responsive material library styles using existing design tokens.

- [ ] **Step 1: Remove App-level mock cloud state and callbacks**

Delete the `HomeFile` type import and these state values:

```typescript
const [homeFolders, setHomeFolders] = useState<string[]>([]);
const [homeActiveFolder, setHomeActiveFolder] = useState<string | null>(null);
const [homeFiles, setHomeFiles] = useState<HomeFile[]>([]);
```

Import and render the new material library view:

```tsx
<OssMaterialLibraryView
  onAcademicFlow={openAcademicFlow}
  onDatabaseAdmin={openDatabaseAdmin}
  onTeacherLogout={() => void logoutRole("teacher")}
  teacherIdentity={teacherIdentity!}
/>
```

Change the academic-flow `onOssCloud` prop to `onOssCloud={openHome}`. Do not change the student, admin database, legacy workspace, or designer return handlers.

- [ ] **Step 2: Delete the obsolete mock view, types, and dialog components**

Delete the former `HomeView` mock file-management component from `frontend/src/features/home/HomeView.tsx`; preserve the `AcademicFlowView` export and all of its flow-list behavior.

After confirming with `rg`, remove these types from `frontend/src/types.ts`:

```text
HomeMenu
FolderDialog
FileDialog
DeleteDialog
HomeFile
```

Remove `ContextMenu`, `MoveFileDialog`, and `DeleteConfirmDialog` from `HomeDialogs.tsx`, together with their `DeleteDialog` and `HomeMenu` import. Preserve `NameDialog` and `FlowDeleteDialog`, which remain used by the academic-flow list.

- [ ] **Step 3: Replace mock file-grid CSS with library-specific rows**

Add focused selectors without altering academic-flow list styles:

```css
.material-library-table {
  min-width: 0;
  border-top: 1px solid #edf0f5;
}

.material-library-row {
  min-height: 64px;
  display: grid;
  grid-template-columns: minmax(180px, 2fr) minmax(90px, 0.8fr)
    minmax(110px, 0.9fr) minmax(140px, 1fr) minmax(80px, auto);
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid #edf0f5;
}

.material-library-name {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  background: transparent;
  color: #1f2937;
  font-weight: 750;
  text-align: left;
}

.material-library-error {
  color: #b42318;
}
```

Complete the selectors needed by the implemented markup for folder/file icons, counts, status tones, download state, empty state, and retry button. Reuse existing colors (`#2773f6`, `#edf0f5`, `#b42318`) and existing border radii. In the existing narrow-screen media query, collapse `.material-library-row` to one main name column plus action, hide secondary metadata only when necessary, and keep download visible.

Remove `.file-row`, `.file-head`, `.file-name`, `.file-icon`, and `.empty-folder` only after `rg` confirms no remaining JSX uses them. Preserve shared selectors such as `.file-table` or `.link-button` if another component still references them.

- [ ] **Step 4: Audit obsolete symbol removal and unrelated behavior**

Run:

```bash
rg -n "HomeFile|HomeMenu|FolderDialog|FileDialog|DeleteDialog|ContextMenu|MoveFileDialog|DeleteConfirmDialog|homeFolders|homeFiles|homeActiveFolder" frontend/src || true
rg -n "NameDialog|FlowDeleteDialog|onOssCloud|openHome" frontend/src/features/home frontend/src/App.tsx
git diff --check -- frontend/src/App.tsx frontend/src/types.ts frontend/src/features/home/HomeDialogs.tsx frontend/src/styles.css
```

Expected: the first search has no results; the second still shows academic-flow dialog and OSS navigation references. Read `App.tsx` teacher/student route branches to confirm only the OSS view wiring changed.

---

### Task 4: Final static audit, scoped commit, cleanup, and local restart

**Files:**
- Review: all files listed in Tasks 1–3
- Review: `docs/superpowers/specs/2026-08-27-oss-material-library-design.md`
- Review: `docs/superpowers/plans/2026-08-27-oss-material-library.md`

**Interfaces:**
- Consumes: completed backend and frontend changes.
- Produces: one scoped result commit and locally restarted services with verified process ownership.

- [ ] **Step 1: Audit the complete requirement chain**

Run only static commands:

```bash
git diff --check
rg -n "material-library|CURRENT_MATERIAL_STATUSES|attempt_no = n.attempt_no|r.status = 'active'|f.owner_id|v.status = 'published'" backend/app
rg -n "MaterialLibrary|搜索当前目录|暂无已发布流程|下载中|首页导航|⌂ 首页" frontend/src
git status --short
```

Compare the diff line by line with the seven design verification items. Do not claim compilation, test, browser, or HTTP verification.

- [ ] **Step 2: Stage only task files and create the single result commit**

Stage exactly:

```bash
git add \
  backend/app/repositories/teacher_materials.py \
  backend/app/api/routes/workflow_admin.py \
  frontend/src/features/academic-flow/api.ts \
  frontend/src/features/home/HomeView.tsx \
  frontend/src/features/home/OssMaterialLibraryView.tsx \
  frontend/src/App.tsx \
  frontend/src/types.ts \
  frontend/src/features/home/HomeDialogs.tsx \
  frontend/src/styles.css \
  docs/superpowers/specs/2026-08-27-oss-material-library-design.md \
  docs/superpowers/plans/2026-08-27-oss-material-library.md
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: add OSS student material library"
```

Verify the staged-name list contains no pre-existing `.gitignore`, `AGENTS.md`, `README.md`, `docker-compose.yml`, `storage/.gitkeep`, `INSTALL.md`, or `assets/` changes.

- [ ] **Step 3: Remove only allowed project caches**

Inspect first, then remove source caches only:

```bash
find backend/app frontend/src -type d -name __pycache__ -print
find backend/app -depth -type d -name __pycache__ -exec rm -rf -- {} +
find . -maxdepth 3 -type d \( -name .pytest_cache -o -name '*.egg-info' \) \
  -not -path './backend/.venv/*' -not -path './frontend/node_modules/*' -print
```

Remove any printed `.pytest_cache` or `*.egg-info` target only after confirming it is inside this repository and outside `.venv` and `node_modules`.

- [ ] **Step 4: Restart only confirmed Moyin service process groups**

Identify listeners and confirm command plus working directory:

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

Use `ps` and `/proc/<pid>/cwd` to confirm the 8000 group is this repository's Uvicorn process rooted at `backend/` and the 5173 group is this repository's Vite process rooted at `frontend/`. Send `TERM` only to those explicit confirmed process groups, then verify both ports are released.

Start the backend from `backend/`:

```bash
setsid ./.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 \
  > /tmp/moyin-backend.log 2>&1 < /dev/null &
```

Start the frontend from `frontend/` with the project Node path:

```bash
export PATH="$PWD/../.local/node/bin:$PATH"
setsid npm run dev > /tmp/moyin-frontend.log 2>&1 < /dev/null &
```

- [ ] **Step 5: Verify startup evidence and report the boundary**

Run:

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
tail -n 12 /tmp/moyin-backend.log
tail -n 12 /tmp/moyin-frontend.log
git status --short
```

Confirm logs contain `Application startup complete` and Vite `ready`, and process working directories are `backend/` and `frontend/`. Report the two commits, changed behavior, preserved unrelated worktree changes, and that automated tests, build, browser checks, real OSS listing/download, and HTTP checks were not run.

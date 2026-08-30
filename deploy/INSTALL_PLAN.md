# Project-Local Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Subagents are unavailable for this task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a one-command Linux x86_64 installer that places Python and Node.js runtimes and all application dependencies inside the repository, while moving manual service startup into `deploy/run_server.sh`.

**Architecture:** `deploy/install.sh` resolves the repository from its own location, validates the platform, installs pinned runtimes under `.local/`, installs locked Python/npm dependencies, preserves existing secrets and exits without starting services. `deploy/run_server.sh` resolves the same root, exposes project-local runtime paths to both backend and frontend processes, and retains the existing bind addresses and coordinated shutdown behavior.

**Tech Stack:** Bash, uv 0.11.25, CPython 3.11.15, Node.js 24.18.0, npm 11.16.0, FastAPI/Uvicorn, React/Vite.

**Spec:** `deploy/INSTALL_DESIGN.md`

## Global Constraints

- Support Linux x86_64 only; reject every other OS or architecture before installation.
- Install uv, Python, Node.js and npm only under the repository `.local/` directory.
- Use uv 0.11.25, Python 3.11.15, Node.js 24.18.0 and npm 11.16.0 exactly.
- Use `https://mirrors.aliyun.com/pypi/simple` for Python packages and `https://registry.npmmirror.com` for npm commands.
- Do not modify user Shell configuration or write runtimes and packages to system directories.
- Do not overwrite an existing `backend/.env`.
- Do not start services from `deploy/install.sh`.
- Preserve `backend/storage/`, databases, backups, uploaded files and generated files.
- Preserve unrelated worktree changes and do not stage them.
- Per project policy, do not run tests, frontend builds or browser automation. Do not execute the installer against the current workspace; perform static Shell and data-flow audits only.
- The design commit `65e3332` is the implementation checkpoint. Create no intermediate commit; create one scoped result commit after all tasks.

---

## File Map

- Create `deploy/install.sh`: platform validation, pinned local runtime installation, dependency installation, environment bootstrap and final validation.
- Create `deploy/run_server.sh`: manual local-development service entrypoint located under `deploy/`.
- Delete `start_server.sh`: remove the obsolete root entrypoint after its behavior is preserved under `deploy/`.
- Modify `README.md`: document the one-command installer and new manual startup path.
- Modify `INSTALL.md`: replace the long manual procedure with the installer contract, fixed locations, prerequisites and recovery guidance.
- Keep `deploy/INSTALL_DESIGN.md`: source of approved requirements.
- Keep `deploy/INSTALL_PLAN.md`: implementation checklist and verification evidence map.

---

### Task 1: Implement the pinned project-local installer

**Files:**
- Create: `deploy/install.sh`

**Interfaces:**
- Consumes: `backend/pyproject.toml`, `frontend/package-lock.json`, `backend/runtime/javascript/package-lock.json`, `backend/.env.example`.
- Produces: `.local/bin/uv`, `.local/python/`, `.local/node/`, `backend/.venv/`, two local `node_modules/` trees and an optional first-install `backend/.env`.

- [ ] **Step 1: Add strict entrypoint, constants and path resolution**

Start the script with the exact pinned values and paths:

```bash
#!/usr/bin/env bash
set -euo pipefail

uv_version="0.11.25"
python_version="3.11.15"
node_version="24.18.0"
npm_version="11.16.0"
python_index="https://mirrors.aliyun.com/pypi/simple"
npm_registry="https://registry.npmmirror.com"

deploy_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "$deploy_dir/.." && pwd)"
local_dir="$project_dir/.local"
local_bin="$local_dir/bin"
node_dir="$local_dir/node"
python_dir="$local_dir/python"
uv_cache_dir="$local_dir/uv-cache"
backend_dir="$project_dir/backend"
frontend_dir="$project_dir/frontend"
audit_runtime_dir="$backend_dir/runtime/javascript"
```

- [ ] **Step 2: Validate Linux x86_64 and base commands before writing**

Use exact checks and fail with a direct message:

```bash
if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "仅支持 Linux x86_64。" >&2
  exit 1
fi

for command in curl tar grep sha256sum mktemp; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "缺少基础命令：$command" >&2
    exit 1
  fi
done

mkdir -p "$local_bin" "$node_dir" "$python_dir" "$uv_cache_dir"
```

- [ ] **Step 3: Install pinned uv only when the local version is missing or wrong**

Use the pinned official installer and unmanaged project-local destination:

```bash
uv_executable="$local_bin/uv"
if [[ ! -x "$uv_executable" ]] || [[ "$($uv_executable --version 2>/dev/null || true)" != "uv $uv_version" ]]; then
  curl -LsSf "https://astral.sh/uv/$uv_version/install.sh" \
    | env UV_UNMANAGED_INSTALL="$local_bin" sh
fi

if [[ "$($uv_executable --version)" != "uv $uv_version" ]]; then
  echo "uv 版本校验失败。" >&2
  exit 1
fi
```

- [ ] **Step 4: Install and verify pinned Node.js/npm atomically**

Set project-local PATH before invoking npm, and use a temporary extraction directory:

```bash
export PATH="$node_dir/bin:$local_bin:$PATH"
node_ok=false
if [[ -x "$node_dir/bin/node" ]] \
  && [[ "$($node_dir/bin/node --version 2>/dev/null || true)" == "v$node_version" ]] \
  && [[ "$(npm --version 2>/dev/null || true)" == "$npm_version" ]]; then
  node_ok=true
fi

if [[ "$node_ok" != true ]]; then
  install_tmp="$(mktemp -d "$local_dir/install.XXXXXX")"
  archive="node-v$node_version-linux-x64.tar.xz"
  curl --fail --location --output "$install_tmp/$archive" \
    "https://nodejs.org/dist/v$node_version/$archive"
  curl --fail --location --output "$install_tmp/SHASUMS256.txt" \
    "https://nodejs.org/dist/v$node_version/SHASUMS256.txt"
  (
    cd "$install_tmp"
    grep " $archive\$" SHASUMS256.txt | sha256sum --check
  )
  mkdir -p "$install_tmp/node"
  tar --extract --file="$install_tmp/$archive" --strip-components=1 \
    --directory="$install_tmp/node"
  rm -rf "$node_dir"
  mv "$install_tmp/node" "$node_dir"
  rm -rf "$install_tmp"
fi

export PATH="$node_dir/bin:$local_bin:$PATH"
[[ "$(node --version)" == "v$node_version" ]]
[[ "$(npm --version)" == "$npm_version" ]]
```

Before implementation, retain the resolved `node_dir` safety boundary exactly; never generalize the removal target or use an unresolved environment variable.

- [ ] **Step 5: Install pinned project-local Python and repair the backend venv only when necessary**

Pin every uv path to `.local/`, install the managed interpreter, then inspect both version and `pyvenv.cfg`:

```bash
export UV_PYTHON_INSTALL_DIR="$python_dir"
export UV_PYTHON_BIN_DIR="$local_bin"
export UV_CACHE_DIR="$uv_cache_dir"

"$uv_executable" python install "$python_version" \
  --install-dir "$python_dir" --managed-python

venv_python="$backend_dir/.venv/bin/python"
venv_ok=false
if [[ -x "$venv_python" ]] \
  && [[ "$($venv_python --version 2>&1)" == "Python $python_version" ]] \
  && grep -Fq "home = $python_dir/" "$backend_dir/.venv/pyvenv.cfg"; then
  venv_ok=true
fi

if [[ "$venv_ok" != true ]]; then
  "$uv_executable" venv --clear --python "$python_version" \
    --managed-python "$backend_dir/.venv"
fi
```

- [ ] **Step 6: Install Python and npm dependencies from declared manifests**

Execute the project-required linear commands with pinned mirrors:

```bash
"$uv_executable" pip install \
  --python "$venv_python" \
  --index-url "$python_index" \
  --editable "$backend_dir[dev]"

npm --prefix "$frontend_dir" ci --registry="$npm_registry"
npm --prefix "$audit_runtime_dir" ci --registry="$npm_registry"
```

- [ ] **Step 7: Preserve existing secrets and validate the completed install without starting services**

Copy the example only on first install, then run dependency checks and print the manual command:

```bash
if [[ ! -f "$backend_dir/.env" ]]; then
  cp "$backend_dir/.env.example" "$backend_dir/.env"
fi

[[ "$($uv_executable --version)" == "uv $uv_version" ]]
[[ "$($venv_python --version 2>&1)" == "Python $python_version" ]]
[[ "$(node --version)" == "v$node_version" ]]
[[ "$(npm --version)" == "$npm_version" ]]
"$uv_executable" pip check --python "$venv_python"
npm --prefix "$frontend_dir" ls --depth=0
npm --prefix "$audit_runtime_dir" ls --depth=0

echo "安装完成。请检查 backend/.env，然后手动运行："
echo "  $project_dir/deploy/run_server.sh"
```

Do not invoke `run_server.sh`, Uvicorn, Vite or Docker Compose from the installer.

---

### Task 2: Move and harden the manual startup entrypoint

**Files:**
- Create: `deploy/run_server.sh`
- Delete: `start_server.sh`

**Interfaces:**
- Consumes: `backend/.venv/bin/uvicorn`, `.local/node/bin/npm`, backend relative environment/database configuration.
- Produces: coordinated backend PID and frontend PID with shared project-local `PATH` and existing signal cleanup.

- [ ] **Step 1: Move the existing behavior and resolve the parent project directory**

Use this location-aware beginning:

```bash
#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "$deploy_dir/.." && pwd)"
export PATH="$project_dir/.local/node/bin:$project_dir/.local/bin:$PATH"

backend_pid=""
frontend_pid=""
```

- [ ] **Step 2: Preserve backend/frontend commands and make cleanup safe under strict mode**

Use guarded PID cleanup and the existing bind addresses:

```bash
cleanup() {
  trap - EXIT INT TERM
  if [[ -n "$backend_pid" ]]; then kill "$backend_pid" 2>/dev/null || true; fi
  if [[ -n "$frontend_pid" ]]; then kill "$frontend_pid" 2>/dev/null || true; fi
  if [[ -n "$backend_pid" ]]; then wait "$backend_pid" 2>/dev/null || true; fi
  if [[ -n "$frontend_pid" ]]; then wait "$frontend_pid" 2>/dev/null || true; fi
}

(
  cd "$project_dir/backend"
  exec ./.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
) &
backend_pid=$!

(
  cd "$project_dir/frontend"
  exec npm run dev
) &
frontend_pid=$!

trap cleanup EXIT INT TERM
wait -n "$backend_pid" "$frontend_pid"
```

The globally exported project-local Node path is required by both frontend npm and backend JavaScript audit subprocesses.

- [ ] **Step 3: Remove the obsolete root script only after the deploy copy is complete**

Delete `start_server.sh`; do not leave a symlink or compatibility wrapper because the approved public entrypoint is `deploy/run_server.sh`.

---

### Task 3: Align installation and startup documentation

**Files:**
- Modify: `README.md`
- Modify: `INSTALL.md`

**Interfaces:**
- Consumes: completed `deploy/install.sh` and `deploy/run_server.sh` behavior.
- Produces: one canonical installation command and one canonical manual startup command.

- [ ] **Step 1: Update README directory structure and local installation section**

Document:

```bash
bash deploy/install.sh
./deploy/run_server.sh
```

State that installation supports Linux x86_64, writes runtimes only under `.local/`, creates `backend/.env` only when absent, and never starts services automatically. Remove the old system `python -m venv`, `pip install`, `npm install` local-development sequence so there is only one canonical path.

- [ ] **Step 2: Rewrite INSTALL.md around the executable installer contract**

Retain the fixed-version/location table and prerequisites, but replace manual multi-step installation with:

```bash
cd /path/to/moyin
bash deploy/install.sh
```

Document idempotent reruns, `.env` preservation, the two npm dependency locations, manual startup, ports, and the fact that Docker Compose remains a separate production deployment path.

- [ ] **Step 3: Search all tracked documentation for the obsolete root command**

Run the read-only audit:

```bash
rg -n "(^|[ /])start_server\.sh|python -m venv|pip install -e|npm install" \
  README.md INSTALL.md deploy docs --glob '!deploy/INSTALL_PLAN.md'
```

Every user-facing local startup reference must resolve to `deploy/run_server.sh`; references describing historical architecture may remain only when clearly labeled historical.

---

### Task 4: Perform static verification, restart through the relocated script and create the result commit

**Files:**
- Verify: `deploy/install.sh`
- Verify: `deploy/run_server.sh`
- Verify: `README.md`
- Verify: `INSTALL.md`
- Verify: `deploy/INSTALL_DESIGN.md`
- Verify: `deploy/INSTALL_PLAN.md`

**Interfaces:**
- Consumes: all implementation outputs.
- Produces: static verification evidence, confirmed project-owned listeners and one scoped result commit.

- [ ] **Step 1: Run static Shell and Git checks only**

Run:

```bash
bash -n deploy/install.sh
bash -n deploy/run_server.sh
git diff --check -- deploy/install.sh deploy/run_server.sh start_server.sh README.md INSTALL.md deploy/INSTALL_DESIGN.md deploy/INSTALL_PLAN.md
```

Do not execute `deploy/install.sh`, npm install/ci, uv install, tests, frontend build or browser automation during implementation.

- [ ] **Step 2: Audit exact pins, mirrors, paths and non-start behavior**

Run:

```bash
rg -n "0\.11\.25|3\.11\.15|24\.18\.0|11\.16\.0|mirrors\.aliyun\.com|registry\.npmmirror\.com|backend/storage/app\.db|deploy/run_server\.sh" \
  deploy/install.sh deploy/run_server.sh README.md INSTALL.md
rg -n "uvicorn|npm run dev|docker compose" deploy/install.sh
```

The second command must return no service-start command from `deploy/install.sh`; wording in comments or the final printed manual command is acceptable only when it does not execute a service.

- [ ] **Step 3: Stage only task files and create the single result commit**

Stage exactly:

```bash
git add deploy/install.sh deploy/run_server.sh deploy/INSTALL_PLAN.md README.md INSTALL.md
git add -u start_server.sh
git commit -m "feat: add project-local installer"
```

Before committing, confirm that `.gitignore`, `docker-compose.yml`, `storage/.gitkeep`, `assets/` and `backend/storage/` are not staged.

- [ ] **Step 4: Restart local services through the relocated script and verify ownership**

Stop only the confirmed existing Moyin Vite/Uvicorn session, verify ports 5173 and 8000 are released, then launch:

```bash
./deploy/run_server.sh
```

Verify `5173` and `8000` listeners, process commands and `/proc/<pid>/cwd`. Expected working directories are `frontend/` for Vite and `backend/` for Uvicorn. Do not send browser requests or claim full installer validation.

- [ ] **Step 5: Clean only generated Python caches and report boundaries**

Remove `.pyc`, `.pyo` and empty `__pycache__` directories only under `backend/app/`. Do not delete `.local/`, `backend/.venv/`, either `node_modules/`, databases, backups or user files.

Final handoff must state:

- the result commit hash;
- the exact install and manual start commands;
- confirmed listener ports and process working directories;
- that tests, build, browser automation and a real clean-machine installer run were not executed.

# Task 1 Implementation Report

## RED

Command:

```bash
cd backend && .venv/bin/pytest tests/test_workflow_revision.py -q
```

Output:

```text
ERROR collecting tests/test_workflow_revision.py
ModuleNotFoundError: No module named 'app'
```

The failure was caused by the repository virtualenv pytest entry point not exposing `backend/` on `sys.path`; the requested domain module was also absent at this point. Running with the interpreter module entry point confirmed the intended missing-module failure:

```text
ModuleNotFoundError: No module named 'app.domain.workflow_revision'
```

## GREEN

Focused command:

```bash
cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_workflow_revision.py -q
```

Output:

```text
....                                                                     [100%]
4 passed in 0.01s
```

Additional verification:

```bash
cd backend && PYTHONPATH=. .venv/bin/ruff check app/domain/workflow_revision.py tests/test_workflow_revision.py
```

Output:

```text
All checks passed!
```

Full backend suite:

```text
42 passed in 2.35s
```

## Changed Files

- `backend/app/domain/workflow_revision.py`
- `backend/tests/test_workflow_revision.py`

The implementation provides business-field snapshots, predecessor-set comparison, successor propagation on the current DAG, deterministic impact lists, and published-node deletion protection.

## Self-Review

- Business comparison excludes layout, deadline, and preview status fields.
- Successor traversal is performed on the current configuration and terminates for a valid DAG.
- Added nodes and predecessor changes are included in the initial invalidation set.
- Published-node deletion errors identify the missing node and use the required Chinese message prefix.
- No unrelated files were staged or changed by the commit.

## Commit

`353be96` (`Add workflow revision impact analysis`)

## Concerns

- The documented pytest command requires `PYTHONPATH=.` in this checkout because `.venv/bin/pytest` does not expose `backend/` on `sys.path`; the implementation and tests pass with that environment correction.

## Review Fix

Changed `predecessorChangedNodeIds` to use current-configuration node order for consistency with every other impact list. Updated the rewired-node test to expect `["review", "join"]`.

Command:

```bash
cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_workflow_revision.py -q && PYTHONPATH=. .venv/bin/ruff check app/domain/workflow_revision.py tests/test_workflow_revision.py && git diff --check
```

Exact result:

```text
....                                                                     [100%]
4 passed in 0.01s
All checks passed!
```

Changed files:

- `backend/app/domain/workflow_revision.py`
- `backend/tests/test_workflow_revision.py`

New commit hash: `90d0fd6` (`Fix workflow revision impact ordering`)

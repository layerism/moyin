### Task 1: Pure DAG revision impact calculation

**Files:**
- Create: `backend/app/domain/workflow_revision.py`
- Create: `backend/tests/test_workflow_revision.py`

**Interfaces:**
- Produces: `PublishedNodeDeletionError(ValueError)`.
- Produces: `analyze_revision(previous: dict, current: dict) -> dict[str, list[str]]` with keys `addedNodeIds`, `changedNodeIds`, `predecessorChangedNodeIds`, and `invalidatedNodeIds`.
- Produces: `assert_published_nodes_present(previous: dict, current: dict) -> None`.

- [ ] **Step 1: Write failing domain tests**

Create fixtures for a branched DAG `root -> left -> join` and `root -> right -> join`. Assert:

```python
def test_content_change_invalidates_only_changed_node_and_successors():
    current = deepcopy(BASE_CONFIG)
    current["nodes"][1]["requirement"] = "修改后的要求"

    impact = analyze_revision(BASE_CONFIG, current)

    assert impact["changedNodeIds"] == ["left"]
    assert impact["invalidatedNodeIds"] == ["left", "join"]


def test_layout_and_deadline_changes_do_not_invalidate_progress():
    current = deepcopy(BASE_CONFIG)
    current["nodes"][0].update({"x": 320, "y": 160, "deadlineAt": "2030-01-01", "status": "ready"})
    assert analyze_revision(BASE_CONFIG, current)["invalidatedNodeIds"] == []


def test_new_node_and_rewired_target_invalidate_their_successors():
    current = insert_node_between(BASE_CONFIG, "left", "join", "review")
    impact = analyze_revision(BASE_CONFIG, current)
    assert impact["addedNodeIds"] == ["review"]
    assert impact["predecessorChangedNodeIds"] == ["join", "review"]
    assert impact["invalidatedNodeIds"] == ["review", "join"]


def test_published_node_deletion_is_rejected():
    current = without_node(BASE_CONFIG, "left")
    with pytest.raises(PublishedNodeDeletionError, match="已发布节点不可删除"):
        assert_published_nodes_present(BASE_CONFIG, current)
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd backend && .venv/bin/pytest tests/test_workflow_revision.py -q`

Expected: collection fails because `app.domain.workflow_revision` does not exist.

- [ ] **Step 3: Implement deterministic impact analysis**

Implement:

```python
BUSINESS_NODE_FIELDS = (
    "kind", "title", "requirement", "infoFields", "fileExtensions",
    "fileLimitMb", "auditScriptType", "auditScriptName", "autoApprove",
)


def business_node_snapshot(node: dict[str, Any]) -> dict[str, Any]:
    return {field: node.get(field) for field in BUSINESS_NODE_FIELDS}


def predecessor_sets(config: dict[str, Any]) -> dict[str, set[str]]:
    result = {node["id"]: set() for node in config["nodes"]}
    for edge in config.get("edges", []):
        result[edge["target"]].add(edge["source"])
    return result


def reachable_successors(config: dict[str, Any], starts: set[str]) -> set[str]:
    outgoing = {node["id"]: set() for node in config["nodes"]}
    for edge in config.get("edges", []):
        outgoing[edge["source"]].add(edge["target"])
    visited = set(starts)
    pending = list(starts)
    while pending:
        for target in outgoing[pending.pop()]:
            if target not in visited:
                visited.add(target)
                pending.append(target)
    return visited
```

Return node IDs in current-config node order for stable API and test output.

- [ ] **Step 4: Run domain tests and verify GREEN**

Run: `cd backend && .venv/bin/pytest tests/test_workflow_revision.py -q`

Expected: all revision-domain tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add backend/app/domain/workflow_revision.py backend/tests/test_workflow_revision.py
git commit -m "Add workflow revision impact analysis"
```

---


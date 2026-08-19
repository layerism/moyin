from copy import deepcopy

import pytest

from app.domain.workflow_revision import (
    PublishedEdgeDeletionError,
    PublishedNodeDeletionError,
    PublishedNodeMutationError,
    analyze_revision,
    assert_published_edges_present,
    assert_published_nodes_present,
    assert_valid_revision,
)


BASE_CONFIG = {
    "nodes": [
        {"id": "root", "kind": "form", "title": "根节点", "requirement": "填写根节点"},
        {"id": "left", "kind": "form", "title": "左分支", "requirement": "填写左分支"},
        {"id": "right", "kind": "form", "title": "右分支", "requirement": "填写右分支"},
        {"id": "join", "kind": "confirmation", "title": "汇总", "requirement": "确认汇总"},
    ],
    "edges": [
        {"id": "root-left", "source": "root", "target": "left"},
        {"id": "root-right", "source": "root", "target": "right"},
        {"id": "left-join", "source": "left", "target": "join"},
        {"id": "right-join", "source": "right", "target": "join"},
    ],
}


def insert_node_between(config: dict, source: str, target: str, node_id: str) -> dict:
    current = deepcopy(config)
    target_index = next(index for index, node in enumerate(current["nodes"]) if node["id"] == target)
    current["nodes"].insert(
        target_index,
        {"id": node_id, "kind": "form", "title": "复核", "requirement": "完成复核"},
    )
    current["edges"].remove(
        next(edge for edge in current["edges"] if edge["source"] == source and edge["target"] == target)
    )
    current["edges"].extend(
        [
            {"id": f"{source}-{node_id}", "source": source, "target": node_id},
            {"id": f"{node_id}-{target}", "source": node_id, "target": target},
        ]
    )
    return current


def without_node(config: dict, node_id: str) -> dict:
    current = deepcopy(config)
    current["nodes"] = [node for node in current["nodes"] if node["id"] != node_id]
    current["edges"] = [
        edge
        for edge in current["edges"]
        if edge["source"] != node_id and edge["target"] != node_id
    ]
    return current


def test_content_change_invalidates_only_changed_node_and_successors():
    current = deepcopy(BASE_CONFIG)
    current["nodes"][1]["requirement"] = "修改后的要求"

    impact = analyze_revision(BASE_CONFIG, current)

    assert impact["changedNodeIds"] == ["left"]
    assert impact["invalidatedNodeIds"] == ["left", "join"]


def test_layout_and_deadline_changes_do_not_invalidate_progress():
    current = deepcopy(BASE_CONFIG)
    current["nodes"][0].update(
        {"x": 320, "y": 160, "deadlineAt": "2030-01-01", "status": "ready"}
    )

    assert analyze_revision(BASE_CONFIG, current)["invalidatedNodeIds"] == []


def test_new_node_and_rewired_target_invalidate_their_successors():
    current = insert_node_between(BASE_CONFIG, "left", "join", "review")

    impact = analyze_revision(BASE_CONFIG, current)

    assert impact["addedNodeIds"] == ["review"]
    assert impact["predecessorChangedNodeIds"] == ["review", "join"]
    assert impact["invalidatedNodeIds"] == ["review", "join"]


def test_published_node_deletion_is_rejected():
    current = without_node(BASE_CONFIG, "left")

    with pytest.raises(PublishedNodeDeletionError, match="已发布节点不可删除"):
        assert_published_nodes_present(BASE_CONFIG, current)


def test_published_edge_deletion_is_rejected():
    current = deepcopy(BASE_CONFIG)
    current["edges"] = [
        edge for edge in current["edges"] if edge["id"] != "root-left"
    ]

    with pytest.raises(PublishedEdgeDeletionError, match="已发布连线不可删除"):
        assert_published_edges_present(BASE_CONFIG, current)


def test_published_node_movement_is_layout_only():
    current = deepcopy(BASE_CONFIG)
    current["nodes"][0].update({"x": 640, "y": 320})

    assert analyze_revision(BASE_CONFIG, current)["invalidatedNodeIds"] == []


def test_audit_script_version_change_invalidates_the_published_file_node():
    previous = {
        "nodes": [
            {
                "id": "file",
                "kind": "file",
                "title": "材料",
                "requirement": "上传材料",
                "auditScriptId": "script-1",
                "auditScriptVersion": 1,
                "auditScriptHash": "old-hash",
            }
        ],
        "edges": [],
    }
    current = deepcopy(previous)
    current["nodes"][0].update(
        {"auditScriptVersion": 2, "auditScriptHash": "new-hash"}
    )

    impact = analyze_revision(previous, current)

    assert impact["changedNodeIds"] == ["file"]
    assert impact["invalidatedNodeIds"] == ["file"]


def confirmation_config() -> dict:
    return {
        "nodes": [
            {
                "id": "confirmation-1",
                "kind": "confirmation",
                "title": "确认承诺",
                "requirement": "签署后上传扫描件",
                "infoFields": [],
                "scanAuditEnabled": True,
                "scanAuditMode": "score",
                "scanAuditPrompt": "检查签名和日期",
            },
            {
                "id": "archive-1",
                "kind": "form",
                "title": "归档信息",
                "requirement": "填写归档信息",
                "infoFields": [],
            },
        ],
        "edges": [
            {
                "id": "confirmation-archive",
                "source": "confirmation-1",
                "target": "archive-1",
            }
        ],
    }


def test_published_scan_audit_prompt_can_be_revised() -> None:
    previous = confirmation_config()
    current = deepcopy(previous)
    current["nodes"][0]["scanAuditPrompt"] = "检查签名、日期和印章"

    assert_valid_revision(previous, current)

    impact = analyze_revision(previous, current)

    assert impact["changedNodeIds"] == ["confirmation-1"]
    assert impact["invalidatedNodeIds"] == ["confirmation-1", "archive-1"]


def test_published_scan_audit_mode_remains_locked() -> None:
    previous = confirmation_config()
    current = deepcopy(previous)
    current["nodes"][0]["scanAuditMode"] = "pass_fail"

    with pytest.raises(PublishedNodeMutationError):
        assert_valid_revision(previous, current)

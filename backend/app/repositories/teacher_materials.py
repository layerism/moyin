import json
from dataclasses import dataclass

from app.core.database import get_connection
from app.domain.workflow import confirmation_requires_scans
from app.domain.workflow_runtime import node_by_key


CURRENT_MATERIAL_STATUSES = ("reviewing", "approved", "rejected", "audit_error")


class TeacherMaterialSelectionError(ValueError):
    pass


@dataclass(frozen=True)
class TeacherMaterial:
    file_id: str
    node_index: int
    node_key: str
    node_title: str
    student_name: str
    student_no: str
    original_name: str
    storage_key: str
    display_order: int
    created_at: str


@dataclass(frozen=True)
class TeacherMaterialSelection:
    scope: str
    flow_name: str
    files: tuple[TeacherMaterial, ...]
    node_title: str | None = None
    student_name: str | None = None
    student_no: str | None = None


def _material_nodes(config: dict[str, object]) -> list[dict[str, object]]:
    nodes = config.get("nodes")
    if not isinstance(nodes, list):
        return []
    return [
        node
        for node in nodes
        if isinstance(node, dict)
        and (node.get("kind") == "file" or confirmation_requires_scans(node))
    ]


def get_version_materials(
    version_id: str,
    teacher_id: int,
    node_key: str | None = None,
) -> TeacherMaterialSelection:
    with get_connection() as connection:
        version = connection.execute(
            """
            SELECT v.config_snapshot, f.name
            FROM flow_versions v
            JOIN flows f ON f.id = v.flow_id
            WHERE v.id = ? AND v.status = 'published' AND f.owner_id = ?
            """,
            (version_id, str(teacher_id)),
        ).fetchone()
        if version is None:
            raise KeyError(version_id)

        config = json.loads(version["config_snapshot"])
        material_nodes = _material_nodes(config)
        node_positions = {
            str(node["id"]): (index, str(node.get("title") or node["id"]))
            for index, node in enumerate(material_nodes, start=1)
        }
        selected_title: str | None = None
        if node_key is not None:
            if node_key not in node_positions:
                raise TeacherMaterialSelectionError("所选节点不产生上传材料")
            selected_title = node_positions[node_key][1]

        parameters: list[object] = [version_id, *CURRENT_MATERIAL_STATUSES]
        node_filter = ""
        if node_key is not None:
            node_filter = "AND n.node_key = ?"
            parameters.append(node_key)
        rows = connection.execute(
            f"""
            SELECT u.id AS file_id, u.original_name, u.storage_key,
                   u.display_order, u.created_at, n.node_key,
                   a.student_no, a.name AS student_name
            FROM uploaded_files u
            JOIN submissions s ON s.id = u.submission_id
            JOIN node_instances n ON n.id = s.node_instance_id
            JOIN flow_instances i ON i.id = n.flow_instance_id
            JOIN student_accounts a ON a.id = i.student_account_id
            WHERE i.flow_version_id = ?
              AND s.attempt_no = n.attempt_no
              AND s.status IN (?, ?, ?, ?)
              {node_filter}
            """,
            tuple(parameters),
        ).fetchall()

    files = tuple(
        sorted(
            (
                TeacherMaterial(
                    file_id=str(row["file_id"]),
                    node_index=node_positions[str(row["node_key"])][0],
                    node_key=str(row["node_key"]),
                    node_title=node_positions[str(row["node_key"])][1],
                    student_name=str(row["student_name"]),
                    student_no=str(row["student_no"]),
                    original_name=str(row["original_name"]),
                    storage_key=str(row["storage_key"]),
                    display_order=int(row["display_order"]),
                    created_at=str(row["created_at"]),
                )
                for row in rows
                if str(row["node_key"]) in node_positions
            ),
            key=lambda item: (
                item.node_index,
                item.student_no,
                item.display_order,
                item.created_at,
                item.file_id,
            ),
        )
    )
    return TeacherMaterialSelection(
        scope="node" if node_key is not None else "all",
        flow_name=str(version["name"]),
        node_title=selected_title,
        files=files,
    )


def get_node_instance_materials(
    node_instance_id: str,
    teacher_id: int,
) -> TeacherMaterialSelection:
    with get_connection() as connection:
        context = connection.execute(
            """
            SELECT n.node_key, n.attempt_no, a.student_no, a.name AS student_name,
                   v.config_snapshot, f.name AS flow_name
            FROM node_instances n
            JOIN flow_instances i ON i.id = n.flow_instance_id
            JOIN student_accounts a ON a.id = i.student_account_id
            JOIN flow_versions v ON v.id = i.flow_version_id
            JOIN flows f ON f.id = v.flow_id
            WHERE n.id = ? AND v.status = 'published' AND f.owner_id = ?
            """,
            (node_instance_id, str(teacher_id)),
        ).fetchone()
        if context is None:
            raise KeyError(node_instance_id)
        config = json.loads(context["config_snapshot"])
        node = node_by_key(config, str(context["node_key"]))
        if not (node.get("kind") == "file" or confirmation_requires_scans(node)):
            raise TeacherMaterialSelectionError("当前节点不产生上传材料")
        rows = connection.execute(
            """
            SELECT u.id AS file_id, u.original_name, u.storage_key,
                   u.display_order, u.created_at
            FROM submissions s
            JOIN uploaded_files u ON u.submission_id = s.id
            WHERE s.node_instance_id = ? AND s.attempt_no = ?
              AND s.status IN (?, ?, ?, ?)
            ORDER BY u.display_order, u.created_at, u.id
            """,
            (node_instance_id, int(context["attempt_no"]), *CURRENT_MATERIAL_STATUSES),
        ).fetchall()

    node_title = str(node.get("title") or context["node_key"])
    files = tuple(
        TeacherMaterial(
            file_id=str(row["file_id"]),
            node_index=1,
            node_key=str(context["node_key"]),
            node_title=node_title,
            student_name=str(context["student_name"]),
            student_no=str(context["student_no"]),
            original_name=str(row["original_name"]),
            storage_key=str(row["storage_key"]),
            display_order=int(row["display_order"]),
            created_at=str(row["created_at"]),
        )
        for row in rows
    )
    return TeacherMaterialSelection(
        scope="student_node",
        flow_name=str(context["flow_name"]),
        node_title=node_title,
        student_name=str(context["student_name"]),
        student_no=str(context["student_no"]),
        files=files,
    )

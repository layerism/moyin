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


def list_teacher_material_library(
    teacher_id: int,
) -> tuple[TeacherMaterialLibraryFlow, ...]:
    with get_connection() as connection:
        version_rows = connection.execute(
            """
            SELECT f.id AS flow_id, f.name, f.created_at,
                   v.id AS version_id, v.config_snapshot
            FROM flows f
            JOIN flow_versions v ON v.flow_id = f.id AND v.status = 'published'
            WHERE f.owner_id = ? AND f.status = 'published'
            ORDER BY f.created_at DESC
            """,
            (str(teacher_id),),
        ).fetchall()
        version_ids = [str(row["version_id"]) for row in version_rows]
        file_rows = []
        if version_ids:
            placeholders = ", ".join("?" for _ in version_ids)
            file_rows = connection.execute(
                f"""
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
                """,
                (*version_ids, str(teacher_id), *CURRENT_MATERIAL_STATUSES),
            ).fetchall()

    material_nodes_by_version: dict[str, list[dict[str, object]]] = {}
    for row in version_rows:
        version_id = str(row["version_id"])
        config = json.loads(row["config_snapshot"])
        material_nodes_by_version[version_id] = _material_nodes(config)

    students_by_node: dict[
        tuple[str, str],
        dict[int, tuple[str, str, list[TeacherMaterialLibraryFile]]],
    ] = {}
    material_node_keys = {
        version_id: {str(node["id"]) for node in nodes}
        for version_id, nodes in material_nodes_by_version.items()
    }
    for row in file_rows:
        version_id = str(row["version_id"])
        node_key = str(row["node_key"])
        if node_key not in material_node_keys.get(version_id, set()):
            continue
        roster_entry_id = int(row["roster_entry_id"])
        students = students_by_node.setdefault((version_id, node_key), {})
        student = students.setdefault(
            roster_entry_id,
            (str(row["student_no"]), str(row["name"]), []),
        )
        student[2].append(
            TeacherMaterialLibraryFile(
                file_id=str(row["file_id"]),
                original_name=str(row["original_name"]),
                content_type=str(row["content_type"]),
                size_bytes=int(row["size_bytes"]),
                created_at=str(row["created_at"]),
                submitted_at=str(row["submitted_at"]),
                submission_status=str(row["submission_status"]),
            )
        )

    flows: list[TeacherMaterialLibraryFlow] = []
    for row in version_rows:
        version_id = str(row["version_id"])
        nodes: list[TeacherMaterialLibraryNode] = []
        for node in material_nodes_by_version[version_id]:
            node_key = str(node["id"])
            students = tuple(
                TeacherMaterialLibraryStudent(
                    roster_entry_id=roster_entry_id,
                    student_no=student_no,
                    name=name,
                    files=tuple(files),
                )
                for roster_entry_id, (student_no, name, files) in students_by_node.get(
                    (version_id, node_key), {}
                ).items()
            )
            nodes.append(
                TeacherMaterialLibraryNode(
                    node_key=node_key,
                    title=str(node.get("title") or node_key),
                    students=students,
                )
            )
        flows.append(
            TeacherMaterialLibraryFlow(
                flow_id=str(row["flow_id"]),
                version_id=version_id,
                name=str(row["name"]),
                nodes=tuple(nodes),
            )
        )
    return tuple(flows)


def get_teacher_material_library_file(
    file_id: str,
    teacher_id: int,
) -> TeacherMaterialLibraryDownload:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT u.id AS file_id, u.original_name, u.storage_key,
                   n.node_key, v.config_snapshot
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
            WHERE u.id = ?
              AND f.owner_id = ?
              AND f.status = 'published'
              AND v.status = 'published'
              AND a.account_kind = 'normal'
              AND s.attempt_no = n.attempt_no
              AND s.status IN (?, ?, ?, ?)
            """,
            (file_id, str(teacher_id), *CURRENT_MATERIAL_STATUSES),
        ).fetchone()
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

import re
import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from app.repositories.teacher_materials import TeacherMaterial, TeacherMaterialSelection
from app.repositories.teacher_node_exports import (
    TeacherNodeExportFile,
    TeacherNodeExportSelection,
    TeacherNodeExportStudent,
)
from app.services.node_submission_workbook import build_node_submission_workbook
from app.services.object_storage import get_object_storage


_UNSAFE_PATH_CHARACTERS = re.compile(r"[\\/\x00-\x1f\x7f]")


class MaterialArchiveEmptyError(ValueError):
    pass


@dataclass(frozen=True)
class MaterialArchive:
    directory: Path
    filename: str
    path: Path


def _safe_component(value: str) -> str:
    component = _UNSAFE_PATH_CHARACTERS.sub("_", value).replace("..", "_").strip(" .")
    return component or "未命名"


def _archive_name(selection: TeacherMaterialSelection) -> str:
    if selection.scope == "all":
        return f"{_safe_component(selection.flow_name)}-全部节点材料.zip"
    if selection.scope == "node":
        return (
            f"{_safe_component(selection.flow_name)}-"
            f"{_safe_component(selection.node_title or '节点')}-材料.zip"
        )
    return (
        f"{_safe_component(selection.student_no or '学生')}-"
        f"{_safe_component(selection.student_name or '未命名')}-"
        f"{_safe_component(selection.node_title or '节点')}.zip"
    )


def _archive_path(selection: TeacherMaterialSelection, material: TeacherMaterial) -> PurePosixPath:
    filename = _safe_component(material.original_name)
    if selection.scope == "all":
        return PurePosixPath(
            _safe_component(selection.flow_name),
            f"{material.node_index:02d}-{_safe_component(material.node_title)}",
            f"{_safe_component(material.student_no)}-{_safe_component(material.student_name)}",
            filename,
        )
    if selection.scope == "node":
        return PurePosixPath(
            _safe_component(material.node_title),
            f"{_safe_component(material.student_no)}-{_safe_component(material.student_name)}",
            filename,
        )
    return PurePosixPath(filename)


def _unique_path(path: PurePosixPath, used: set[str]) -> PurePosixPath:
    candidate = path
    sequence = 2
    while str(candidate) in used:
        suffix = path.suffix
        stem = path.name[: -len(suffix)] if suffix else path.name
        candidate = path.with_name(f"{stem}({sequence}){suffix}")
        sequence += 1
    used.add(str(candidate))
    return candidate


def build_material_archive(selection: TeacherMaterialSelection) -> MaterialArchive:
    if not selection.files:
        raise MaterialArchiveEmptyError("当前范围暂无可下载材料")
    directory = Path(tempfile.mkdtemp(prefix="moyin-materials-"))
    archive_path = directory / "materials.zip"
    object_directory = directory / "objects"
    object_directory.mkdir()
    used_paths: set[str] = set()
    try:
        storage = get_object_storage()
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for index, material in enumerate(selection.files):
                local_path = object_directory / str(index)
                storage.download_to_file(material.storage_key, local_path)
                archive.write(
                    local_path,
                    arcname=str(_unique_path(_archive_path(selection, material), used_paths)),
                )
        return MaterialArchive(directory, _archive_name(selection), archive_path)
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        raise


def _node_package_material_path(
    student: TeacherNodeExportStudent,
    material: TeacherNodeExportFile,
) -> PurePosixPath:
    return PurePosixPath(
        "学生文件",
        f"{_safe_component(student.student_no)}-{_safe_component(student.name)}",
        _safe_component(material.original_name),
    )


def build_node_submission_archive(
    selection: TeacherNodeExportSelection,
    *,
    include_workbook: bool = True,
) -> MaterialArchive:
    workbook_content: bytes | None = None
    workbook_filename: str | None = None
    if include_workbook:
        workbook_content, workbook_filename = build_node_submission_workbook(selection)
    node_title = str(selection.node.get("title") or selection.node.get("id") or "节点")
    materials = tuple(
        (student, material)
        for student in selection.students
        for material in student.files
    )
    directory = Path(tempfile.mkdtemp(prefix="moyin-node-package-"))
    archive_path = directory / "node-package.zip"
    object_directory = directory / "objects"
    if not include_workbook and not materials:
        shutil.rmtree(directory, ignore_errors=True)
        raise MaterialArchiveEmptyError("所选学生暂无可下载文件")
    used_paths = {workbook_filename} if workbook_filename else set()
    try:
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            if workbook_filename and workbook_content is not None:
                archive.writestr(workbook_filename, workbook_content)
            if materials:
                object_directory.mkdir()
                storage = get_object_storage()
                for index, (student, material) in enumerate(materials):
                    local_path = object_directory / str(index)
                    storage.download_to_file(material.storage_key, local_path)
                    archive.write(
                        local_path,
                        arcname=str(
                            _unique_path(
                                _node_package_material_path(student, material),
                                used_paths,
                            )
                        ),
                    )
        suffix = "节点资料包" if include_workbook else "学生文件"
        filename = f"{_safe_component(selection.flow_name)}-{_safe_component(node_title)}-{suffix}.zip"
        return MaterialArchive(directory, filename, archive_path)
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        raise


def cleanup_material_archive(archive: MaterialArchive) -> None:
    shutil.rmtree(archive.directory, ignore_errors=True)

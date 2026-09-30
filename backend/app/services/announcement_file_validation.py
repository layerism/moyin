"""Validate the contents of an announcement attachment before OSS upload."""

import hashlib
import zipfile
from typing import BinaryIO
from xml.etree import ElementTree

import pymupdf as fitz

from app.repositories.flow_announcement_files import ANNOUNCEMENT_FILE_LIMIT_BYTES


_OFFICE_MAIN_PARTS = {
    ".docx": ("word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"),
    ".xlsx": ("xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"),
    ".pptx": ("ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"),
}
_CONTENT_TYPES_NS = "{http://schemas.openxmlformats.org/package/2006/content-types}Override"


class InvalidAnnouncementFile(ValueError):
    pass


def inspect_announcement_file(stream: BinaryIO, suffix: str) -> tuple[int, str]:
    """Return size and digest only when the claimed extension has valid file structure."""
    digest = hashlib.sha256()
    size = 0
    stream.seek(0)
    while chunk := stream.read(1024 * 1024):
        size += len(chunk)
        if size > ANNOUNCEMENT_FILE_LIMIT_BYTES:
            raise InvalidAnnouncementFile("附件大小不能超过 50 MB")
        digest.update(chunk)
    if size == 0:
        raise InvalidAnnouncementFile("附件不能为空")
    stream.seek(0)
    try:
        if suffix == ".pdf":
            if not stream.read(5) == b"%PDF-":
                raise InvalidAnnouncementFile("PDF 文件内容无效")
            stream.seek(0)
            with fitz.open(stream=stream.read(), filetype="pdf") as document:
                if document.page_count < 1:
                    raise InvalidAnnouncementFile("PDF 文件必须包含页面")
        else:
            main_part, expected_content_type = _OFFICE_MAIN_PARTS[suffix]
            with zipfile.ZipFile(stream) as archive:
                members = archive.infolist()
                if len(members) > 2000 or sum(member.file_size for member in members) > 200 * 1024 * 1024:
                    raise InvalidAnnouncementFile("Office 文件结构过大")
                names = {member.filename for member in members}
                if any(
                    name.lower().endswith((".exe", ".js", ".vbs", ".ps1", ".bat", ".cmd", ".scr", "vbaproject.bin"))
                    or "/activex/" in f"/{name.lower()}"
                    or "/embeddings/" in f"/{name.lower()}"
                    for name in names
                ):
                    raise InvalidAnnouncementFile("Office 文件包含不允许的可执行内容")
                if "[Content_Types].xml" not in names or main_part not in names:
                    raise InvalidAnnouncementFile("Office 文件结构无效")
                with archive.open("[Content_Types].xml") as member:
                    content_types = member.read(1024 * 1024 + 1)
                if len(content_types) > 1024 * 1024:
                    raise InvalidAnnouncementFile("Office 文件结构无效")
                root = ElementTree.fromstring(content_types)
                if not any(
                    item.attrib.get("PartName") == f"/{main_part}"
                    and item.attrib.get("ContentType") == expected_content_type
                    for item in root.findall(_CONTENT_TYPES_NS)
                ):
                    raise InvalidAnnouncementFile("Office 文件类型与扩展名不一致")
                with archive.open(main_part) as member:
                    if not member.read(256).lstrip().startswith((b"<?xml", b"<")):
                        raise InvalidAnnouncementFile("Office 文件主体无效")
    except (fitz.FileDataError, zipfile.BadZipFile, ElementTree.ParseError, KeyError, OSError, RuntimeError) as exc:
        raise InvalidAnnouncementFile("附件内容无效或与文件类型不一致") from exc
    finally:
        stream.seek(0)
    return size, digest.hexdigest()

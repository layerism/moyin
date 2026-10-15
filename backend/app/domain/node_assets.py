"""Resource references in current node config and immutable version snapshots."""
import re
from typing import Any


def reference_assets(node: dict) -> list[dict]:
    if 'referenceAssets' in node:
        return node['referenceAssets'] or []
    return [node['referenceAsset']] if node.get('referenceAsset') else []


def asset_entries(node: dict):
    if node.get('templateAsset'):
        yield 'templateAsset', node['templateAsset']
    for asset in reference_assets(node):
        yield 'referenceAsset', asset


ANNOUNCEMENT_FILE_LIMIT_COUNT = 10
_ASSET_TARGET = re.compile(r"asset://[A-Za-z0-9-]+")
_IMAGE_LINK = re.compile(r"!\[[^\]]*\]\(([^)\s]+)\)")
_FILE_LINK = re.compile(r"(?<!!)\[[^\]]*\]\((asset://[^)\s]+)\)")

_ASSET_REFERENCE = re.compile(r"asset://([A-Za-z0-9-]+)")
_MARKDOWN_IMAGE_TARGET = re.compile(r"!\[[^\]]*\]\(([^)\s]+)")


class ContentAssetError(ValueError):
    pass


class AnnouncementFileError(ValueError):
    pass


def referenced_content_asset_ids(node: dict[str, Any]) -> set[str]:
    if node.get("kind") == "announcement":
        targets = _MARKDOWN_IMAGE_TARGET.findall(str(node.get("requirement") or ""))
        if any(_ASSET_REFERENCE.fullmatch(target) is None for target in targets):
            raise ContentAssetError("公告图片必须先上传到当前流程的 OSS")
        return {target.removeprefix("asset://") for target in targets}
    if node.get("kind") != "answer_sheet":
        return set()
    references: set[str] = set()
    for question in node.get("answerSheet", {}).get("questions", []):
        if not isinstance(question, dict):
            continue
        references.update(_ASSET_REFERENCE.findall(str(question.get("content") or "")))
        for option in question.get("options", []):
            if isinstance(option, dict):
                references.update(
                    _ASSET_REFERENCE.findall(str(option.get("content") or ""))
                )
    return references


def referenced_announcement_file_ids(node: dict[str, Any]) -> set[str]:
    if node.get("kind") != "announcement":
        return set()
    markdown = str(node.get("requirement") or "")
    file_links = _FILE_LINK.findall(markdown)
    if any(_ASSET_TARGET.fullmatch(target) is None for target in file_links):
        raise AnnouncementFileError("公告附件引用格式无效")
    remaining = _IMAGE_LINK.sub("", markdown)
    remaining = _FILE_LINK.sub("", remaining)
    if "asset://" in remaining:
        raise AnnouncementFileError("公告包含无法识别的资源引用")
    references = {target.removeprefix("asset://") for target in file_links}
    if len(references) > ANNOUNCEMENT_FILE_LIMIT_COUNT:
        raise AnnouncementFileError("每个公告最多引用 10 份附件")
    return references


def node_asset_references(node: dict) -> set[tuple[str, str]]:
    references = {('template', asset['assetId']) for _, asset in asset_entries(node)}
    references.update(('content', asset_id) for asset_id in referenced_content_asset_ids(node))
    references.update(('announcement', asset_id) for asset_id in referenced_announcement_file_ids(node))
    return references

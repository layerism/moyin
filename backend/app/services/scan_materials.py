from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from PIL import Image, UnidentifiedImageError


MAX_SCAN_FILE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000


class ScanMaterialError(ValueError):
    pass


@dataclass(frozen=True)
class ScanInspection:
    content_type: str
    page_count: int


def inspect_scan_material(
    stream: BinaryIO, filename: str, size_bytes: int
) -> ScanInspection:
    extension = Path(filename).suffix.lower()
    if size_bytes <= 0 or size_bytes > MAX_SCAN_FILE_BYTES:
        raise ScanMaterialError("单个扫描件必须小于 10 MB")
    try:
        stream.seek(0)
        if extension not in {".jpg", ".jpeg", ".png"}:
            raise ScanMaterialError("扫描件仅支持 JPG、JPEG 或 PNG")
        with Image.open(stream) as image:
            actual = (image.format or "").upper()
            expected = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG"}[extension]
            if actual != expected or image.width * image.height > MAX_IMAGE_PIXELS:
                raise ScanMaterialError("图片格式或像素尺寸无效")
            image.verify()
        content_type = "image/png" if extension == ".png" else "image/jpeg"
        return ScanInspection(content_type, 1)
    except ScanMaterialError:
        raise
    except (UnidentifiedImageError, OSError, ValueError):
        raise ScanMaterialError("扫描件内容损坏或格式不符") from None
    finally:
        stream.seek(0)

"""Shared image preparation for visual review and scoring scripts."""
import base64
import io
from pathlib import Path

import pymupdf as fitz
from PIL import Image, ImageOps


def image_url(item, settings):
    if item["extension"].lower() not in {".jpg", ".jpeg", ".png"} or item["pageCount"] != 1:
        raise ValueError("扫描图片格式无效")
    with Image.open(Path(item["path"])) as source:
        image = ImageOps.exif_transpose(source)
        maximum = int(settings["imageMaximumSide"])
        image.thumbnail((maximum, maximum))
        output = io.BytesIO()
        image.convert("RGB").save(output, format="JPEG", quality=int(settings["jpegQuality"]))
    return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def material_images(item, settings):
    if item["extension"].lower() != ".pdf":
        return [image_url(item, settings)]
    with fitz.open(Path(item["path"])) as document:
        if document.needs_pass or not 1 <= document.page_count <= 20 or document.page_count != item["pageCount"]:
            raise ValueError("PDF 页数与上传记录不符")
        images = []
        for page in document:
            scale = int(settings["imageMaximumSide"]) / max(page.rect.width, page.rect.height)
            pixmap = page.get_pixmap(
                matrix=fitz.Matrix(scale, scale), colorspace=fitz.csRGB, alpha=False
            )
            png = pixmap.tobytes("png")
            images.append("data:image/png;base64," + base64.b64encode(png).decode("ascii"))
        return images

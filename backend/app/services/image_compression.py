from io import BytesIO
from typing import BinaryIO

from PIL import Image, ImageOps, UnidentifiedImageError


MAX_JPEG_BYTES = 1_000_000


def compress_image_to_jpeg(stream: BinaryIO) -> bytes:
    """Produce a single-page JPEG strictly below the archive size limit."""
    try:
        stream.seek(0)
        with Image.open(stream) as source:
            if getattr(source, "n_frames", 1) != 1:
                raise ValueError("多页或动态图片请转为 PDF 或单张图片后上传")
            oriented = ImageOps.exif_transpose(source)
            rgba = oriented.convert("RGBA")
            image = Image.new("RGB", rgba.size, "white")
            image.paste(rgba, mask=rgba.getchannel("A"))
        while True:
            for quality in (90, 80, 70, 60):
                with BytesIO() as output:
                    image.save(output, format="JPEG", quality=quality, optimize=True)
                    data = output.getvalue()
                if len(data) < MAX_JPEG_BYTES:
                    return data
            image = image.resize(
                (max(1, int(image.width * 0.8)), max(1, int(image.height * 0.8))),
                Image.Resampling.LANCZOS,
            )
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError) as exc:
        raise ValueError("图片无法转换为 JPEG，请检查文件或重新导出后上传") from exc
    finally:
        stream.seek(0)

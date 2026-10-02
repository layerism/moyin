"""Temporary DOCX conversion for authorized manual-review previews."""
import os
import signal
import subprocess
from pathlib import Path


def convert_docx_preview(source: Path, directory: Path) -> Path:
    profile = directory / 'profile'
    command = [
        'soffice', f'-env:UserInstallation={profile.as_uri()}',
        '--headless', '--norestore', '--nodefault', '--nofirststartwizard',
        '--convert-to', 'pdf:writer_pdf_Export', '--outdir', str(directory), str(source),
    ]
    process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               start_new_session=True)
    try:
        code = process.wait(timeout=90)
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
    result = source.with_suffix('.pdf')
    if code != 0 or not result.is_file() or result.stat().st_size == 0:
        raise ValueError('DOCX 转换未生成有效 PDF')
    return result

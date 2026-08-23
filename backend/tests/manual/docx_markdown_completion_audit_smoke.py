from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[2]
HANDLER_PATH = (
    BACKEND_ROOT / "scripts" / "docx-markdown-completion-audit" / "handler.py"
)
CONFIG_PATH = HANDLER_PATH.with_name("config.json")


def load_handler() -> ModuleType:
    module_name = "docx_markdown_completion_audit_smoke_handler"
    spec = importlib.util.spec_from_file_location(module_name, HANDLER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载 DOCX 完成性审核处理器")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def runtime_settings() -> dict[str, object]:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return {
        str(item["key"]): item["value"]
        for item in config["runtimeSettings"]
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="手动执行真实 DOCX LLM 审核")
    parser.add_argument("--docx", required=True, type=Path, help="待审核 DOCX 路径")
    parser.add_argument(
        "--prompt-file", required=True, type=Path, help="Markdown 审核规则路径"
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    docx_path = args.docx.resolve()
    prompt_path = args.prompt_file.resolve()
    if docx_path.suffix.lower() != ".docx" or not docx_path.is_file():
        raise ValueError("待审核文件必须是存在的 DOCX")
    if not prompt_path.is_file():
        raise ValueError("Markdown 审核规则不存在")

    load_dotenv(BACKEND_ROOT / ".env", override=True)
    handler = load_handler()
    payload = {
        "schemaVersion": "1.0",
        "files": [
            {
                "id": "manual-smoke-docx",
                "name": docx_path.name,
                "path": str(docx_path),
                "extension": ".docx",
            }
        ],
        "context": {
            "scriptParams": {
                "documentReviewPrompt": prompt_path.read_text(encoding="utf-8")
            },
            "scriptSettings": runtime_settings(),
        },
    }
    json.dump(handler.run(payload), sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

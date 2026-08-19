import json
import sys


def run(payload: object) -> dict[str, object]:
    if not isinstance(payload, dict) or payload.get("schemaVersion") != "1.0":
        raise ValueError("不支持的输入协议版本")
    files = payload.get("files")
    if not isinstance(files, list) or not files:
        raise ValueError("files 必须是非空数组")

    file_results: list[dict[str, object]] = []
    issues: list[dict[str, str]] = []
    for item in files:
        valid = (
            isinstance(item, dict)
            and isinstance(item.get("id"), str)
            and bool(item["id"])
            and isinstance(item.get("path"), str)
            and bool(item["path"])
        )
        file_id = str(item.get("id", "")) if isinstance(item, dict) else ""
        file_results.append({"fileId": file_id, "passed": valid})
        if not valid:
            issues.append(
                {
                    "fileId": file_id,
                    "code": "INVALID_FILE_INPUT",
                    "message": "文件输入结构无效",
                }
            )

    return {
        "schemaVersion": "1.0",
        "passed": not issues,
        "reason": "" if not issues else "部分文件输入结构无效",
        "details": {
            "checkedFileCount": len(files),
            "issues": issues,
            "fileResults": file_results,
        },
    }


def main() -> None:
    payload = json.load(sys.stdin)
    json.dump(run(payload), sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()

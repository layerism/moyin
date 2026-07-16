PYTHON_TEMPLATE = '''import json
import sys


def run(payload: dict) -> dict:
    """接收 JSON 对象并返回 JSON 对象。请在此补充材料审核逻辑。"""
    return {"passed": True, "reason": "", "details": {}}


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read())
        result = run(payload)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
'''

JAVASCRIPT_TEMPLATE = '''const { readFileSync } = require("node:fs");


async function run(payload) {
  // 接收 JSON 对象并返回 JSON 对象。请在此补充材料审核逻辑。
  return { passed: true, reason: "", details: {} };
}


async function main() {
  try {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    const result = await run(payload);
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\\n`);
    process.exitCode = 1;
  }
}


void main();
'''


def get_template_source(language: str) -> tuple[str, str]:
    if language == "python":
        return PYTHON_TEMPLATE, "audit_script_template.py"
    if language == "javascript":
        return JAVASCRIPT_TEMPLATE, "audit_script_template.js"
    raise ValueError("仅支持 Python 或 JavaScript 模板")

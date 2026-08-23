# DOCX 审核真实材料 Smoke Test 计划

**目标：** 使用 `assets` 中的专业实习周记 DOCX，通过当前生产处理器真实调用一次 DeepSeek，并输出最终审核 JSON。

## 文件

- 新建 `backend/tests/manual/docx_markdown_completion_audit_smoke.py`
  - 使用命令行参数接收 DOCX 和 Markdown 规则文件。
  - 加载 `backend/.env`，但不输出环境变量或密钥。
  - 动态加载生产 `handler.py`，从生产 `config.json` 读取运行配置默认值。
  - 构造与审核 worker 一致的输入协议，调用 `run()` 并将结果 JSON 输出到标准输出。
- 新建 `backend/tests/manual/prompts/internship-weekly-journal.md`
  - 只检查学生应填写的基本信息及第 1 至第 3 周记录。
  - 明确不检查教师评阅意见和评分。

## 执行边界

- 手动脚本名称不以 `test_` 开头，普通 pytest 不会自动发起付费 API 请求。
- 脚本不硬编码 `assets` 文件名，可复用于任意 DOCX 和 Markdown 规则。
- 实现和静态检查提交后，再运行一次真实 DeepSeek smoke test。
- 真实调用失败时保留原始异常分类，但不输出密钥。

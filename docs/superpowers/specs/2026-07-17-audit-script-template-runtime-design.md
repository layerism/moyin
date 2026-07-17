# 文件审核脚本模板与运行环境设计

## 1. 目标与范围

在现有“超级管理员管理脚本、流程节点固定脚本版本”的基础上，重新设计 Python 与 JavaScript 审核模板，使其能够处理多个文件，并为后续自动执行提供稳定的 JSON 输入输出协议。

本期交付：

- Python、JavaScript ZIP 模板包；
- 后端预装文档解析依赖；
- 统一的多文件输入、审核结果输出协议；
- 文件类型与真实格式校验；
- 受控脚本执行入口及临时文件生命周期；
- Docker 与本地后端运行环境同步。

继续保持以下边界：只有超级管理员可以下载模板、上传或更新审核脚本；流程节点固定使用脚本 ID、版本和 SHA-256，不随最新版自动迁移。

## 2. 设计原则

1. 上传脚本不得自行执行 `pip install` 或 `npm install`，依赖由后端镜像统一安装。
2. 不向脚本传递 OSS AccessKey，也不允许脚本直接访问 OSS；后端负责材料下载。
3. 多文件通过临时本地路径传递，避免 Base64 带来的体积和内存膨胀。
4. Python 与 JavaScript 使用同一输入输出协议。
5. 脚本标准输出只能包含最终 JSON；诊断日志写入标准错误。
6. 先在现有后端进程体系内提供受控 Runner，不提前拆分独立执行服务。
7. 脚本由超级管理员上传并视为受信代码；本期通过进程边界、输入校验和资源上限降低风险，不承诺容器级强隔离。

## 3. 模板下载

### 3.1 下载文件

两个模板接口分别返回：

- `audit-script-python-template.zip`；
- `audit-script-javascript-template.zip`。

使用 ZIP 可同时携带入口文件、协议示例和说明文档，并避免浏览器直接下载 `.py`、`.js` 时常见的可执行文件风险提示。

### 3.2 Python 模板包

```text
python-template/
├── handler.py
├── input.example.json
├── output.example.json
└── README.md
```

`handler.py` 导入并示范使用：

- `python-docx`：读取 `.docx`；
- `openpyxl`：读取 `.xlsx`；
- `PyMuPDF`：读取 `.pdf`；
- `python-pptx`：读取 `.pptx`；
- `Pillow`：读取 `.jpeg`、`.jpg`、`.png`。

### 3.3 JavaScript 模板包

```text
javascript-template/
├── handler.js
├── input.example.json
├── output.example.json
└── README.md
```

`handler.js` 导入并示范使用：

- `mammoth`：读取 `.docx`；
- `xlsx`：读取 `.xlsx`；
- `pdf-parse`：读取 `.pdf`；
- `jszip` 与 `fast-xml-parser`：解析 `.pptx` 的 OOXML；
- `sharp`：读取 `.jpeg`、`.jpg`、`.png` 元数据。

管理员解压模板后只修改入口文件，最终仍上传单个 `handler.py` 或 `handler.js`。模板中的 README 明确列出后端已提供的依赖，不允许脚本声明或动态安装额外依赖。

## 4. 后端运行环境

### 4.1 Python 依赖

在 `backend/pyproject.toml` 的正式依赖中增加：

```text
python-docx
openpyxl
PyMuPDF
python-pptx
Pillow
```

### 4.2 JavaScript 依赖

新增固定的 JavaScript Runtime 依赖清单，由后端 Docker 镜像构建阶段统一安装：

```text
mammoth
xlsx
pdf-parse
jszip
fast-xml-parser
sharp
```

Docker 镜像必须同时提供 Python 3.12 与受支持的 Node.js LTS。部署构建失败时不得跳过 JavaScript 依赖安装，否则 JavaScript 审核脚本不可发布为可用状态。

## 5. 文件输入与校验

### 5.1 允许格式

允许的规范化扩展名为：

```text
.docx .xlsx .pdf .pptx .jpeg .jpg .png
```

扩展名比较不区分大小写，因此 `.JPEG` 规范化为 `.jpeg`。不支持旧版 `.doc`、`.xls`、`.ppt`。

后端不能只校验扩展名，还应结合文件头、ZIP OOXML 结构或解析器探测结果确认真实格式。扩展名与真实格式不一致时，在进入脚本前直接拒绝。

### 5.2 临时目录

每次审核创建独立目录：

```text
<audit_temp_root>/<execution_id>/
├── files/
│   ├── <file_id>.docx
│   └── <file_id>.pdf
└── result.json
```

后端从 OSS 下载节点提交的全部材料，文件名只使用系统生成的文件 ID 与规范化扩展名，原始名称保留在 JSON 元数据中，避免路径穿越和同名覆盖。

无论执行成功、失败或超时，都必须在结果持久化后清理该目录。

## 6. 统一输入协议

后端通过标准输入向脚本发送一个 JSON 对象：

```json
{
  "schemaVersion": "1.0",
  "executionId": "uuid",
  "files": [
    {
      "id": "file-1",
      "name": "申请表.docx",
      "extension": ".docx",
      "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "path": "/tmp/audit/uuid/files/file-1.docx",
      "size": 102400,
      "sha256": "..."
    }
  ],
  "context": {
    "workflowId": "uuid",
    "flowInstanceId": "uuid",
    "nodeId": "uuid",
    "submitterId": "uuid"
  }
}
```

模板必须：

1. 验证 `schemaVersion`；
2. 确认 `files` 为非空数组；
3. 遍历全部文件，按规范化扩展名调用相应解析器；
4. 将单文件异常转换为结构化问题，不因一个损坏文件丢失其他文件的审核结果；
5. 拒绝清单之外的路径或不支持的扩展名。

## 7. 统一输出协议

脚本标准输出必须是唯一一个 JSON 对象：

```json
{
  "schemaVersion": "1.0",
  "passed": false,
  "reason": "材料不完整",
  "details": {
    "checkedFileCount": 2,
    "issues": [
      {
        "fileId": "file-1",
        "code": "MISSING_FIELD",
        "message": "申请表缺少负责人字段"
      }
    ]
  }
}
```

约束：

- `passed` 必须为布尔值；
- `reason` 必须为字符串；
- `details.checkedFileCount` 必须等于实际处理文件数；
- `details.issues` 必须为数组，问题必须关联 `fileId`；
- 解析失败、协议错误、脚本退出码非零与超时均由后端转换为系统审核失败，不伪装成业务不通过。

## 8. 后续执行入口

流程节点继续保存：

```json
{
  "auditScriptId": "uuid",
  "auditScriptVersion": 2,
  "auditScriptHash": "sha256"
}
```

统一服务入口：

```python
execute_audit_script(script_descriptor, files, context) -> AuditResult
```

执行顺序：

1. 根据 ID、版本和 SHA-256 解析不可变脚本；
2. 校验材料元数据与允许格式；
3. 从 OSS 下载到独立临时目录；
4. 生成输入 JSON；
5. Python 使用当前后端 Python 解释器，JavaScript 使用固定 Node.js 可执行文件；
6. 将 JSON 写入标准输入并采集标准输出、标准错误与退出码；
7. 默认限制单次执行 60 秒、标准输出 1 MiB、标准错误 256 KiB，超限立即终止；
8. 校验输出 JSON Schema；
9. 持久化审核结果；
10. 清理临时目录。

脚本运行时使用显式环境变量白名单，不继承完整项目 `.env`，也不注入 OSS 或其他业务密钥。本期不向模板提供网络客户端或网络配置；由于仍在主后端容器内执行，不把操作系统级断网作为本期能力。

## 9. 错误处理

- 无文件：拒绝执行并返回输入错误；
- 不支持或伪造格式：在启动脚本前拒绝；
- OSS 下载失败：记录系统错误，不启动脚本；
- 单文件解析失败：脚本返回对应 `fileId` 的结构化问题；
- 脚本超时、崩溃、输出非 JSON 或超限：记录运行错误；
- 结果持久化失败：保留错误日志并执行临时目录清理；
- 任何对外错误均不得泄漏服务器绝对路径、OSS 凭据或完整标准错误内容。

## 10. 验收标准

1. Python、JavaScript 按钮分别下载 ZIP 模板包。
2. ZIP 中包含入口脚本、输入示例、输出示例与 README。
3. 两种模板都能遍历多个文件并覆盖七种允许扩展名。
4. 后端本地环境和 Docker 镜像具备模板所需解析依赖。
5. 不支持格式、扩展名伪造和路径越界在脚本执行前被拒绝。
6. Python、JavaScript 使用相同的 JSON 输入输出协议。
7. Runner 能解析固定脚本版本、执行脚本、校验结果并清理临时目录。
8. 上传脚本无法动态安装依赖，也不能获得 OSS 密钥或完整项目 `.env`。

## 11. 非目标

- 普通教师上传或更新审核脚本；
- 上传脚本自行声明、下载或安装第三方依赖；
- 将文件内容编码为 Base64 后塞入 JSON；
- 脚本直接访问 OSS；
- 在线脚本编辑器；
- 当前阶段拆分独立容器化 Runner、任务队列或弹性执行集群。

# 审核脚本配置管理设计

## 1. 目标

为 `backend/scripts` 下全部预置审核脚本建立统一的 `v1` 配置管理能力。超级管理员从首页点击“审核脚本”后，可以查看脚本并通过结构化表单修改允许调整的节点参数默认值与运行配置；浏览器不能直接读取、覆盖或定位服务器文件。

本次按用户要求直接维护各脚本的 `v1`，不新增脚本版本。

## 2. 当前脚本范围

### `confirmation-visual-audit`

- 保留节点参数：审核模式、教师审核标准。
- 提取运行配置：业务系统提示词、模型名称、模型思考开关、模型温度、最大审核页数、图片最长边、JPEG 质量、PDF 渲染倍率、模型请求超时。
- `VISION_API_BASE_URL` 与 `VISION_API_KEY` 继续由后端 `.env` 提供，不写入脚本 JSON、不通过接口返回，也不允许前端修改。
- 模型返回 JSON 协议、针对不可信材料的安全指令、响应大小上限和审核输出协议由脚本固定追加，不作为可调配置。管理员编辑的是系统提示词中的业务角色与审核指导部分。

### `docx-word-count-check`

- 保留节点参数“最低字数”。
- 管理页面允许修改其默认值。
- 参数键、类型以及程序安全上限不可修改。
- 当前没有额外运行配置。

### `material-basic-check`

- 新增统一格式的 `versions/1/config.json`。
- 当前没有实际业务参数，`parameters` 与 `runtimeSettings` 均为空。
- 管理页面显示“当前脚本暂无可调参数”，不人为增加无意义配置。

## 3. 文件结构

每个脚本的 `versions/1/config.json` 统一采用以下顶层结构：

```json
{
  "acceptedExtensions": [],
  "parameters": [],
  "runtimeSettings": []
}
```

- `acceptedExtensions`：脚本允许处理的文件扩展名。
- `parameters`：流程节点级参数定义；发布或预览时把具体值固定到流程快照。
- `runtimeSettings`：超级管理员维护的脚本级运行配置；发布或预览时把当前值固定到流程快照。

运行配置定义示例：

```json
{
  "key": "systemPrompt",
  "label": "系统提示词",
  "description": "定义模型的业务审核角色和指导规则",
  "type": "string",
  "value": "你是材料视觉审核器……",
  "minimumLength": 1,
  "maximumLength": 4000,
  "multiline": true
}
```

允许的字段类型与现有参数系统一致：`string`、`integer`、`number`、`boolean`、`select`。`multiline` 仅用于决定字符串字段的前端控件，不改变值类型。

## 4. 后端目录与校验模型

`audit_script_parameters.py` 扩展版本配置模型，读取并规范化 `runtimeSettings`。配置哈希覆盖：

- `acceptedExtensions`
- `parameters`
- `runtimeSettings` 的定义与当前值

参数键、类型、标签、范围、选项和安全上限由仓库配置定义约束。管理接口只接收允许修改的 `default` 或 `value`，不能从浏览器新增、删除或改变定义。

后端采用临时文件、刷新文件内容、文件系统同步和原子替换写回 `config.json`。写入前后都通过同一规范化器校验，禁止部分写入或保存无效 JSON。

## 5. 管理接口

### 5.1 获取管理列表

```http
GET /api/workflow-admin/audit-scripts/manage
```

- 权限：仅超级管理员。
- 返回所有有效脚本，包括 `visibility="internal"` 的确认承诺视觉审核脚本。
- 仅返回摘要与可调项数量，不返回 `.env`、文件路径或敏感字段。

### 5.2 获取脚本配置

```http
GET /api/workflow-admin/audit-scripts/{script_id}/versions/1/config
```

- 权限：仅超级管理员。
- 返回脚本基本信息、版本、当前配置哈希、节点参数定义和运行配置定义。
- 固定读取当前脚本清单声明的 `v1`；脚本 ID 必须通过目录服务解析，不能拼接任意路径。

响应示例：

```json
{
  "id": "confirmation-visual-audit",
  "name": "确认承诺视觉审核",
  "description": "内部使用的多扫描件视觉审核程序",
  "language": "py",
  "version": 1,
  "configSha256": "abc123",
  "parameters": [],
  "runtimeSettings": []
}
```

### 5.3 保存脚本配置

```http
PUT /api/workflow-admin/audit-scripts/{script_id}/versions/1/config
```

- 权限：仅超级管理员。
- 请求只包含旧配置哈希、节点参数默认值和运行配置值。
- 后端从磁盘重新读取定义，通过键名合并允许修改的值，不接受完整 JSON 覆盖。

请求示例：

```json
{
  "expectedConfigSha256": "abc123",
  "parameterDefaults": {
    "minimumWordCount": 1200
  },
  "runtimeSettings": {
    "systemPrompt": "你是材料视觉审核器……",
    "thinkingEnabled": false,
    "temperature": 0
  }
}
```

响应与配置详情接口一致，并返回新 `configSha256`。

错误语义：

- `403`：不是超级管理员。
- `404`：脚本或 `v1` 不存在。
- `409`：`expectedConfigSha256` 与磁盘当前哈希不一致。
- `422`：未知参数、类型错误、越界、空系统提示词或配置定义无效。
- `500`：配置文件无法原子保存。

原有 `GET /api/workflow-admin/audit-scripts` 继续只服务流程设计器，不返回内部脚本；原有元信息修改接口继续处理名称与说明。

## 6. 前端数据流

```text
点击首页“审核脚本”
  → GET /audit-scripts/manage
  → 展示所有脚本摘要
  → 点击脚本“配置”
  → GET /audit-scripts/{id}/versions/1/config
  → 根据字段类型生成表单
  → 用户修改并保存
  → PUT /audit-scripts/{id}/versions/1/config
  → 使用响应替换本地详情和哈希
```

前端 API 层新增管理摘要、配置详情和保存请求类型。管理弹窗不直接处理文件路径或原始 JSON。

## 7. 管理界面

沿用现有白色弹窗、灰色边框、蓝色主按钮、红色错误语义以及既有圆角和间距。

### 7.1 脚本列表

每行显示：

- 脚本名称与说明
- 语言与 `v1`
- 节点参数数量
- 运行配置数量
- “配置”或“查看”按钮

没有可调项的脚本显示“暂无可调参数”，按钮文案为“查看”。

### 7.2 配置详情

分为三个区域：

1. 基本信息：公开脚本的名称、说明继续通过原有能力修改；内部脚本的名称、说明以及所有脚本的语言、版本只读。
2. 节点参数：只修改默认值。
3. 运行配置：修改当前运行值。

动态控件映射：

```text
string + multiline → textarea
string             → text input
integer / number   → number input
boolean            → checkbox or switch
select             → select
```

字段失焦或提交时执行前端校验，错误显示在字段下方。前端校验只用于交互反馈，后端校验是最终边界。

### 7.3 保存状态

- 保存期间禁用关闭和重复提交。
- 保存成功后采用服务器响应更新表单值与配置哈希。
- `409` 提示“配置已被其他管理员修改，请重新加载”。
- `422` 尽可能映射到对应字段；无法映射时显示表单级错误。
- 保存失败时保留当前输入。

底部固定提示：

> 配置变更会更新脚本 v1 哈希；已有预览需重新打开，已发布流程需重新发布。

## 8. 运行时快照

发布或创建预览时，后端将配置拆分并固定到节点快照：

- `auditScriptParams`：节点参数具体值。
- `auditScriptSettings`：脚本运行配置具体值。
- `auditScriptConfigHash`：包含参数定义与运行配置的配置哈希。

worker 领取任务后：

1. 校验脚本 ID、`v1`、入口脚本哈希和配置哈希。
2. 校验快照中的参数和运行配置。
3. 将二者作为 `context.scriptParams` 和 `context.scriptSettings` 传给脚本。

脚本读取方式统一为：

```python
params = payload["context"]["scriptParams"]
settings = payload["context"]["scriptSettings"]
```

确认承诺视觉审核脚本不再硬编码已开放的运行参数。DOCX 脚本继续读取节点参数。材料基础校验脚本不读取空配置。

## 9. 版本与历史影响

用户已明确要求直接修改全部脚本的 `v1`。保存 `v1/config.json` 会改变配置哈希：

- 已打开的旧预览必须关闭后重新打开。
- 已发布流程必须重新发布后才能采用新配置。
- 使用旧配置哈希的审核任务按现有安全规则拒绝执行，不静默套用新配置。

管理页面必须在保存前持续展示这一影响，不把配置修改描述为对历史快照即时生效。

## 10. 验证边界

按项目规范，实施过程中不运行自动化测试、构建或浏览器插件。完成后执行：

- 后端与前端静态业务逻辑审计。
- Python 和 TypeScript 相关源码的差异检查；不声称构建或测试通过。
- 配置 JSON 的解析与规范化检查。
- 本地非 Docker 服务重启与 `8000`、`5173` 端口进程核对。
- 清理项目源码产生的 `.pytest_cache`、`__pycache__` 和 `*.egg-info`。

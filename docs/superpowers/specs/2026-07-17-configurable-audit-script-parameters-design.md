# 可配置审核脚本参数与 DOCX 字数审核设计

## 目标

为本地预置审核脚本增加版本化参数定义，使不同脚本可以声明不同的管理员配置表单，并将每个流程节点的参数值随流程版本固化。同时新增“DOCX 字数审核”脚本：统计正文段落和表格内容，未达到管理员配置的最低字数时返回业务不通过。

本设计保持现有脚本 JSON stdin/stdout 协议、固定版本代码哈希、SQLite 审核任务队列和学生端轮询机制不变。

## 已确认需求

- 参数作用域为流程节点，同一脚本在不同 OA、不同节点可以配置不同值。
- DOCX 字数审核的默认最低字数为 `1000`，管理员可设置 `1–1,000,000` 的整数。
- 中文字符按 1 字计算；连续英文字母或数字组成的字母数字串按 1 个词计算；空格、标点和换行不计。
- 统计正文段落和正文表格，忽略页眉与页脚。
- 选择 DOCX 字数脚本后，节点允许格式自动设为 `.docx` 并锁定；取消脚本后解除锁定但保留 `.docx`。
- 通用参数类型首期支持 `integer`、`number`、`string`、`boolean` 和 `select`。
- 每个脚本版本拥有独立 `config.json`，防止脚本升级后旧流程读取新参数结构。

## 方案选择

采用“脚本版本配置文件 + 通用动态表单”。

未采用按脚本 ID 写死管理员界面，因为脚本与前端强耦合，每增加脚本都需要发布应用代码。未采用所有文件节点统一增加最低字数字段，因为没有使用字数脚本的节点会出现无意义配置。未采用完整 JSON Schema，因为当前只需要有限标量类型、约束和下拉选项，完整规范会增加不必要的解析与安全边界。

## 脚本目录与版本模型

现有目录结构扩展为：

```text
backend/scripts/<script-id>/
├── manifest.json
└── versions/
    └── <version>/
        ├── <entry>
        └── config.json        # 可选
```

顶层 `manifest.json` 继续负责脚本身份、当前版本、语言和入口文件名。`versions/<version>/config.json` 负责该版本的输入扩展名和参数定义。

没有 `config.json` 的既有脚本等价于：

```json
{
  "acceptedExtensions": [],
  "parameters": []
}
```

其中空 `acceptedExtensions` 表示脚本本身不附加格式约束，保持 `material-basic-check` 向后兼容。

### 版本配置哈希

目录解析器对 `config.json` 解析后的规范 JSON 计算 SHA-256，称为 `configSha256`。无配置文件时，对规范空配置计算固定哈希。

流程节点选择脚本时固定：

```json
{
  "auditScriptId": "docx-word-count-check",
  "auditScriptVersion": 1,
  "auditScriptHash": "入口文件哈希",
  "auditScriptConfigHash": "版本配置哈希",
  "auditScriptParams": {
    "minimumWordCount": 1000
  }
}
```

入口代码哈希和配置哈希分离，避免改变现有 `auditScriptHash` 的语义。发布与运行时都校验固定版本配置哈希；脚本版本升级不得改变旧版本目录中的 `handler.py` 或 `config.json`。

## 通用参数定义

`config.json` 顶层结构固定为：

```json
{
  "acceptedExtensions": [".docx"],
  "parameters": []
}
```

### 公共字段

每个参数包含：

| 字段 | 约束 | 含义 |
|---|---|---|
| `key` | `[A-Za-z][A-Za-z0-9_]{0,63}`，版本内唯一 | 脚本读取的稳定键 |
| `label` | 1–80 字符 | 管理员界面标签 |
| `type` | 五种首期类型之一 | 控件与校验类型 |
| `required` | 布尔值，默认 `true` | 是否必须提供 |
| `default` | 必须符合该参数全部约束 | 首次选择脚本时的值 |
| `description` | 可选，最多 200 字符 | 管理员辅助说明 |

单版本最多声明 20 个参数，参数值规范 JSON 总大小不得超过 16 KiB。

### 类型约束

- `integer`：JSON 整数；可声明 `minimum`、`maximum`。
- `number`：有限 JSON 数字；可声明 `minimum`、`maximum`。
- `string`：字符串；可声明 `minimumLength`、`maximumLength`，最大长度上限为 2000。
- `boolean`：JSON 布尔值。
- `select`：字符串；必须声明 1–100 个唯一 `options`，每项为 `{label, value}`，默认值必须属于选项集合。

未知字段、未知类型、重复 key、无效默认值、非有限数字、倒置范围或不合法扩展名会使该脚本版本不进入目录列表。

扩展名统一转为小写，以点开头，只允许 `.docx` 这类简单后缀，不接受路径、通配符或 MIME 表达式。

## DOCX 字数审核脚本

新增：

```text
backend/scripts/docx-word-count-check/
├── manifest.json
└── versions/1/
    ├── handler.py
    └── config.json
```

`config.json`：

```json
{
  "acceptedExtensions": [".docx"],
  "parameters": [
    {
      "key": "minimumWordCount",
      "label": "最低字数",
      "description": "正文段落和表格内容需要达到的最低字数",
      "type": "integer",
      "default": 1000,
      "minimum": 1,
      "maximum": 1000000,
      "required": true
    }
  ]
}
```

### 文本提取

脚本使用项目已有 `python-docx`：

1. 打开唯一 DOCX 文件；
2. 提取 `document.paragraphs` 的文本；
3. 遍历 `document.tables` 的行和单元格；
4. 以底层 XML 单元格身份去重，避免合并单元格重复统计；
5. 不遍历 section 的 header/footer；
6. 将提取文本交给统一计数函数。

### 计数规则

计数器匹配两类 token：

- CJK 统一表意文字范围内的每个中文字符；
- 连续 ASCII 字母数字串 `[A-Za-z0-9]+`。

例如：

```text
“本项目使用 GPT4，共 12 个样本。” = 11
```

其中中文字符逐字计数，`GPT4` 计 1，`12` 计 1，空格与标点不计。首期不统计文本框、批注、脚注、尾注、修订删除内容和嵌入对象中的文字。

### 输出

不足时返回正常业务结果：

```json
{
  "schemaVersion": "1.0",
  "passed": false,
  "reason": "文档字数不足：当前 826 字，最低要求 1000 字",
  "details": {
    "checkedFileCount": 1,
    "issues": [
      {
        "fileId": "...",
        "code": "WORD_COUNT_BELOW_MINIMUM",
        "message": "当前 826 字，最低要求 1000 字"
      }
    ],
    "wordCount": 826,
    "minimumWordCount": 1000
  }
}
```

达到要求时 `passed=true`、`reason` 说明实际字数、`issues=[]`，并保留 `wordCount` 与 `minimumWordCount`。

以下情况抛出脚本技术异常，由现有 worker 自动重试：

- 文件数量不是 1；
- 文件扩展名不是 `.docx`；
- DOCX 损坏或无法读取；
- `scriptParams.minimumWordCount` 缺失、不是整数或越界；
- 输入协议版本不正确。

## 目录 API 与管理员界面

审核脚本列表项扩展为：

```json
{
  "id": "docx-word-count-check",
  "name": "DOCX 字数审核",
  "language": "py",
  "version": 1,
  "sha256": "...",
  "configSha256": "...",
  "acceptedExtensions": [".docx"],
  "parameters": []
}
```

管理员选择脚本时：

1. 将脚本 ID、版本、入口哈希和配置哈希写入节点；
2. 根据参数定义生成默认 `auditScriptParams`；
3. 使用通用组件按类型渲染数字输入、文本输入、复选框或下拉框；
4. 每次修改即时执行客户端约束校验；
5. `acceptedExtensions` 非空时，将节点 `fileExtensions` 设为规范扩展名列表并锁定输入。

切换脚本时丢弃旧脚本参数并加载新脚本默认值，防止同名 key 跨脚本意外继承。取消脚本时移除配置哈希和参数值，解除格式锁定，但保留当前文件扩展名文本。

固定旧版本脚本即使不在当前脚本列表中，节点仍保留已固化的参数值；管理员重新选择脚本时只能选择目录当前可解析的版本。

## 发布校验与版本影响

后端发布时对每个启用脚本的节点执行：

1. 解析固定脚本 ID 和版本；
2. 校验入口 SHA-256；
3. 校验 `configSha256`；
4. 按该版本参数定义校验 `auditScriptParams`，拒绝缺失、额外、类型错误和越界字段；
5. 校验节点是文件节点；
6. 当 `acceptedExtensions` 非空时，要求节点格式与版本配置严格一致。

`auditScriptConfigHash` 与 `auditScriptParams` 加入冻结节点字段和流程修订比较。修改参数视为节点定义变化，发布新版本时沿用现有修订影响规则：对应学生节点及可达下游失效并重新计算。

未启用脚本的节点不得残留 `auditScriptConfigHash` 或 `auditScriptParams`。

## 审核运行时接入

`audit_jobs` 继续只保存 Submission、脚本 ID、版本和入口哈希，不重复保存节点参数。任务领取时已能获得固定 `flowVersionId`、`nodeKey` 和 `attemptNo`，仓储层额外读取该版本 `config_snapshot` 中对应节点：

- 再次校验脚本 ID、版本、入口哈希和配置哈希；
- 按版本配置校验参数；
- 将参数加入脚本 context。

脚本输入示例：

```json
{
  "schemaVersion": "1.0",
  "files": [],
  "context": {
    "flowId": "...",
    "flowVersionId": "...",
    "flowInstanceId": "...",
    "nodeInstanceId": "...",
    "nodeKey": "...",
    "submissionId": "...",
    "attemptNo": 1,
    "scriptParams": {
      "minimumWordCount": 1000
    }
  }
}
```

无参数脚本接收 `scriptParams={}`。参数不来自学生请求，也不允许脚本从环境变量覆盖。

配置解析失败、哈希不一致或参数无效均属于技术异常，使用现有 1、5、15 秒自动重试并最终进入 `audit_error`；不得把管理员配置错误显示为学生业务不通过。

## 安全与一致性

- 参数表单由受信任的版本配置生成，但发布 API 仍执行完整服务端校验。
- 字符串参数作为普通 JSON 数据传入 stdin，不拼接命令行、路径、SQL 或环境变量。
- 参数定义和取值均有数量与大小上限。
- `config.json` 必须是普通文件，解析后的路径必须位于对应脚本版本目录，拒绝符号链接越界。
- 配置哈希固定版本语义；已发布流程不受顶层 manifest 元信息修改影响。
- 审核输出继续通过现有协议校验，脚本不能直接写数据库或改变节点状态。

## 文件边界

- `backend/app/services/audit_script_catalog.py`：解析版本配置、校验通用参数定义、计算配置哈希；
- `backend/app/domain/workflow_runtime.py` 或专用校验模块：校验节点脚本参数；
- `backend/app/domain/workflow_revision.py`：参数与配置哈希纳入修订影响；
- `backend/app/repositories/audit_jobs.py`：从固定流程快照读取并传递 `scriptParams`；
- `backend/scripts/docx-word-count-check/**`：新脚本与版本配置；
- `frontend/src/types.ts`：节点参数、配置哈希和参数定义类型；
- `frontend/src/features/academic-flow/auditScripts.ts`：脚本选择与默认参数转换；
- `frontend/src/features/academic-flow/AuditScriptSelector.tsx`：动态参数表单和扩展名锁定；
- `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`：节点更新接入；
- 相关样式文件：最小参数表单布局。

不新增数据库表，不引入表单库、JSON Schema 库或新的前端状态库。

## 验收标准

1. 无 `config.json` 的现有脚本仍能列出、选择、发布和执行。
2. 不同脚本、不同版本可以声明不同参数，管理员页面无需按脚本 ID 添加专用代码。
3. DOCX 字数脚本选择后自动限制 `.docx`，默认最低字数为 1000，并允许节点级修改。
4. 参数值、入口哈希和配置哈希随流程版本固化；修改最低字数触发现有修订影响机制。
5. worker 从固定流程快照读取参数，学生请求不能覆盖。
6. 正文段落和去重后的表格单元格按确认口径计数，页眉页脚不计。
7. 字数不足返回 `rejected` 业务结果并展示实际字数与最低要求；达到要求进入 `approved` 并推进下游。
8. 文件损坏、格式错误或管理员参数异常进入技术重试，最终为 `audit_error`。
9. 参数定义和取值均经过前后端校验，未知参数不会传入脚本。
10. 按项目规则不运行自动化测试、构建或浏览器测试，完成后交由用户手动验收。

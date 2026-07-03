# 腾讯文档收集表简化版架构草案

## 需求定位

本项目不是通用网盘，也不是单纯的 DOCX 上传系统，而是构建“腾讯文档收集表”的简化实现。核心目标是让管理员像创建在线问卷或收集表一样，配置一个材料收集页面；填报用户打开链接后填写基础信息、上传指定材料，并提交到系统归档。

在标准收集表能力之外，系统增加一个专用能力：对用户上传的 `.docx` 文档执行 AI 格式检测、自动评语填写、批注生成和结果归档。该能力由管理员上传若干个 Python 脚本实现。平台负责任务编排、文件调度、脚本运行隔离、结果入库和 OSS 归档；具体检测规则、AI 调用逻辑和评语生成逻辑由脚本提供。

## 产品形态

系统参考腾讯文档收集表的基本交互，保留三个核心工作区：

| 工作区 | 作用 |
| --- | --- |
| 编辑 | 创建收集表，添加题目，配置上传材料项，配置 AI 检查脚本 |
| 统计 | 查看提交人数、提交明细、文件状态、检查结果、导出数据 |
| 设置 | 配置权限、截止时间、是否允许重复提交、结果可见性 |

第一版不追求完整复刻腾讯文档，只实现收集表闭环和 DOCX AI 增强能力。

## 用户角色

| 角色 | 主要能力 |
| --- | --- |
| 管理员 | 创建收集表、配置题目、配置 DOCX 上传项、上传 Python 脚本、查看统计结果 |
| 填报用户 | 打开收集表链接，填写基础信息，上传 DOCX 文档，查看提交和检查状态 |
| 审核人员 | 查看提交记录，下载原始文档、批注文档和检查报告，标记审核状态 |

## 收集表题型

第一版支持最小但完整的题型集合：

| 题型 | 用途 | 是否必需 |
| --- | --- | --- |
| 单行文本 | 姓名、学号、班级、手机号等短文本 | 是 |
| 多行文本 | 备注、说明、补充材料说明 | 可选 |
| 单选题 | 固定分类选择 | 可选 |
| 多选题 | 多标签或多项选择 | 可选 |
| 日期题 | 提交日期、材料时间 | 可选 |
| 文件题 | 上传 DOCX 材料 | 是 |

文件题是本项目的关键题型。管理员可以为每个文件题配置：

1. 文件名称，例如“毕业论文正文”“实习材料”“课程设计报告”。
2. 是否必传。
3. 文件数量上限。
4. 文件大小上限。
5. 允许的文件类型，第一版限定为 `.docx`。
6. 绑定的 AI 检查脚本集合。

## 核心功能边界

第一版需要完成以下闭环：

1. 管理员创建一个收集表。
2. 管理员添加基础题目和若干 DOCX 文件题。
3. 管理员上传一个或多个 Python 脚本，并绑定到指定文件题。
4. 管理员发布收集表，生成可访问链接。
5. 填报用户打开链接，填写必填项并上传必需 DOCX 文档。
6. 系统在前端和后端同时校验必填项、文件类型、文件数量和文件大小。
7. 校验通过后生成提交记录。
8. 系统将原始 DOCX 上传到阿里云 OSS。
9. 系统异步运行绑定的 Python 脚本，执行 AI 格式检测和自动评语填写。
10. 系统保存检查结果 JSON、带批注 DOCX、自动评语和运行日志。
11. 管理员在统计页查看提交状态、检查状态和审核状态。
12. 审核人员下载原始文档、批注文档和检查报告。

## 非目标

第一版暂不实现以下功能：

1. 多人实时协同编辑收集表。
2. 类似在线 Word 的正文编辑器。
3. 通用文件格式检查。
4. 任意脚本无约束运行。
5. 复杂工作流审批引擎。
6. 完整 AI Agent 平台。

## 核心模块

| 模块 | 职责 |
| --- | --- |
| 认证与权限 | 登录、角色区分、收集表访问控制 |
| 收集表编辑器 | 管理题目、分组、必填规则、文件题配置 |
| 发布与填写 | 生成填写链接，渲染收集表，处理用户提交 |
| 提交校验 | 校验必填项、字段格式、文件数量、文件类型和大小 |
| 文件归档 | 将原始文档、批注文档和报告归档到阿里云 OSS |
| 脚本管理 | 上传、版本化、校验和启停 Python 脚本 |
| AI DOCX 检查 | 编排脚本运行，执行格式检测、评语填写和批注生成 |
| 统计与审核 | 展示提交明细、检查结果、审核状态和导出数据 |

## 数据流

### 收集表创建流程

1. 管理员新建收集表。
2. 管理员配置标题、说明、截止时间和提交规则。
3. 管理员添加基础题目和 DOCX 文件题。
4. 管理员上传 Python 脚本，并将脚本绑定到指定 DOCX 文件题。
5. 系统校验脚本输入输出协议。
6. 管理员发布收集表。

### 用户提交流程

1. 用户打开收集表链接。
2. 前端根据表单 schema 渲染题目。
3. 用户填写基础信息并上传 DOCX。
4. 前端执行必填和文件规则校验。
5. 后端再次校验表单 schema 与上传文件。
6. 后端创建提交记录。
7. 后端上传原始 DOCX 到阿里云 OSS。
8. 后端在 `ai_docx_runs` 表中创建 AI DOCX 检查任务。
9. Worker 从 PostgreSQL 任务表领取任务，下载原始 DOCX，运行绑定脚本。
10. Worker 上传批注文档、评语结果和检查报告。
11. 系统更新提交状态和统计结果。

## AI DOCX 检查与自动评语填写

AI DOCX 能力由若干 Python 脚本组合实现。脚本可以完成以下任务：

1. 读取 DOCX，检查标题、字体、字号、段落、页边距、页眉页脚、表格格式等规则。
2. 调用指定 AI 模型，对正文内容、摘要、结论、格式说明等进行评估。
3. 根据检测结果生成自动评语。
4. 将评语写入 DOCX 指定位置，或以批注、修订痕迹、附录形式写入。
5. 输出结构化 JSON，供统计页展示。

### 脚本绑定方式

一个 DOCX 文件题可以绑定多个脚本。脚本按顺序执行：

```text
原始 DOCX
  -> 脚本 A：基础格式检测
  -> 脚本 B：AI 内容评估
  -> 脚本 C：自动评语填写
  -> 批注文档 + 检查报告
```

每个脚本应声明：

| 字段 | 说明 |
| --- | --- |
| `name` | 脚本名称 |
| `version` | 脚本版本 |
| `entrypoint` | 入口文件 |
| `required_env` | 需要的环境变量，例如 AI API Key |
| `input_contract` | 输入文件和元数据约定 |
| `output_contract` | 输出 DOCX、JSON 和日志约定 |
| `timeout_seconds` | 最大运行时间 |

### 脚本输入

平台向脚本提供统一输入：

| 参数 | 含义 |
| --- | --- |
| `input_docx` | 当前待处理 DOCX 文件路径 |
| `output_docx` | 当前脚本输出 DOCX 文件路径 |
| `output_json` | 当前脚本输出 JSON 文件路径 |
| `metadata_json` | 收集表、题目、提交用户和脚本配置 |
| `workdir` | 当前脚本可读写工作目录 |

### 脚本输出

每个脚本至少输出一个 JSON 文件。需要修改或批注文档时，同时输出 DOCX。

```json
{
  "passed": false,
  "summary": "文档存在格式问题，已生成修改建议。",
  "comments": [
    {
      "target": "第 1 页标题",
      "comment": "标题字号应调整为三号黑体。"
    }
  ],
  "issues": [
    {
      "code": "title_font_size_error",
      "level": "warning",
      "location": "第 1 页标题",
      "message": "标题字号不符合要求",
      "suggestion": "建议改为三号黑体"
    }
  ],
  "artifacts": {
    "output_docx": "output.docx"
  }
}
```

## 脚本安全边界

用户上传的 Python 脚本必须运行在隔离环境中：

1. 默认禁止访问业务数据库。
2. 默认禁止访问任务目录之外的文件。
3. 默认禁止访问内网服务。
4. 限制运行时间、内存、CPU 和输出文件大小。
5. AI API Key 通过受控环境变量注入，不写入脚本文档。
6. 脚本运行失败时，不影响原始提交归档，只将检查状态标记为失败。
7. 每次运行保留脚本版本、输入文件 hash、输出文件 hash 和错误日志。

## OSS 归档设计

OSS 保存所有大文件，数据库只保存元数据和 object key。

```text
forms/{form_id}/submissions/{submission_id}/raw/{field_key}/{filename}.docx
forms/{form_id}/submissions/{submission_id}/ai/{field_key}/{run_id}/annotated.docx
forms/{form_id}/submissions/{submission_id}/ai/{field_key}/{run_id}/report.json
forms/{form_id}/submissions/{submission_id}/ai/{field_key}/{run_id}/logs.txt
scripts/{script_id}/{version}/package.zip
```

## 推荐数据表

### 收集表：`forms`

| 字段 | 说明 |
| --- | --- |
| `id` | 收集表 ID |
| `title` | 标题 |
| `description` | 说明 |
| `status` | 草稿、已发布、已关闭 |
| `deadline_at` | 截止时间 |
| `allow_resubmit` | 是否允许重复提交 |
| `created_by` | 创建人 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

### 表单题目：`form_fields`

| 字段 | 说明 |
| --- | --- |
| `id` | 题目 ID |
| `form_id` | 收集表 ID |
| `field_key` | 字段唯一标识 |
| `field_type` | 题型，例如 text、textarea、select、file |
| `label` | 题目标题 |
| `required` | 是否必填 |
| `options` | 选项配置 JSON |
| `validation_rules` | 校验规则 JSON |
| `sort_order` | 排序 |

### AI 脚本：`ai_docx_scripts`

| 字段 | 说明 |
| --- | --- |
| `id` | 脚本 ID |
| `name` | 脚本名称 |
| `version` | 脚本版本 |
| `package_oss_key` | 脚本包 OSS key |
| `entrypoint` | 入口文件 |
| `runtime_config` | 运行配置 JSON |
| `status` | 启用状态 |
| `created_by` | 上传人 |
| `created_at` | 创建时间 |

### 文件题脚本绑定：`field_script_bindings`

| 字段 | 说明 |
| --- | --- |
| `id` | 绑定 ID |
| `field_id` | 文件题 ID |
| `script_id` | AI 脚本 ID |
| `run_order` | 执行顺序 |
| `config` | 该绑定的脚本参数 JSON |
| `enabled` | 是否启用 |

### 提交记录：`submissions`

| 字段 | 说明 |
| --- | --- |
| `id` | 提交 ID |
| `form_id` | 收集表 ID |
| `user_id` | 填报用户 ID |
| `form_data` | 非文件题答案 JSON |
| `submit_status` | 提交状态 |
| `ai_status` | AI 检查总体状态 |
| `review_status` | 审核状态 |
| `submitted_at` | 提交时间 |

### 提交文件：`submission_files`

| 字段 | 说明 |
| --- | --- |
| `id` | 文件 ID |
| `submission_id` | 提交 ID |
| `field_id` | 文件题 ID |
| `original_filename` | 原始文件名 |
| `raw_oss_key` | 原始 DOCX OSS key |
| `file_hash` | 文件哈希 |
| `file_size` | 文件大小 |
| `ai_status` | AI 检查状态 |
| `created_at` | 创建时间 |

### AI 检查运行记录：`ai_docx_runs`

| 字段 | 说明 |
| --- | --- |
| `id` | 运行 ID |
| `submission_file_id` | 提交文件 ID |
| `script_id` | 脚本 ID |
| `run_order` | 执行顺序 |
| `status` | pending、running、success、failed |
| `input_oss_key` | 输入 DOCX OSS key |
| `output_docx_oss_key` | 输出 DOCX OSS key |
| `report_oss_key` | 检查报告 OSS key |
| `log_oss_key` | 运行日志 OSS key |
| `summary` | 检查摘要 |
| `started_at` | 开始时间 |
| `finished_at` | 结束时间 |

## 推荐接口

| 接口 | 方法 | 功能 |
| --- | --- | --- |
| `/api/forms` | `POST` | 创建收集表 |
| `/api/forms/{form_id}` | `GET` | 获取收集表配置 |
| `/api/forms/{form_id}/fields` | `POST` | 添加题目 |
| `/api/forms/{form_id}/publish` | `POST` | 发布收集表 |
| `/api/forms/{form_id}/submissions` | `POST` | 提交收集表 |
| `/api/forms/{form_id}/stats` | `GET` | 查看统计结果 |
| `/api/submissions/{submission_id}` | `GET` | 查看提交详情 |
| `/api/submission-files/{file_id}/download` | `GET` | 下载原始或批注文档 |
| `/api/ai-docx-scripts` | `POST` | 上传 AI DOCX 脚本 |
| `/api/ai-docx-scripts/{script_id}/validate` | `POST` | 校验脚本协议 |
| `/api/ai-docx-runs/{run_id}` | `GET` | 查看脚本运行结果 |

## 部署形态

生产环境建议采用：

1. Web 入口：提供前端静态资源与 `/api` 反向代理；如云平台已有入口代理，可不单独安装 Nginx。
2. FastAPI：提供收集表、提交、文件、脚本和认证接口。
3. PostgreSQL：保存用户、表单、提交、脚本和运行记录。
4. PostgreSQL 任务表：使用 `ai_docx_runs` 托管 AI DOCX 异步任务。
5. Worker：轮询并领取 PostgreSQL 中的待处理任务，运行 AI DOCX 检查。
6. 阿里云 OSS：保存原始文件、批注文档、报告、日志和脚本包。
7. 隔离脚本运行环境：使用受限子进程、独立工作目录、超时和资源限制，避免脚本影响主服务。

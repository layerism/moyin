# 学生审核结果 Markdown 展示设计

## 1. 目标

学生查看自动审核结果时，只展示面向学生的文字说明，不再直接展示 `details` 结构化 JSON。文字说明使用 Markdown 渲染，以支持标题、段落、列表、强调、引用、链接和代码等格式。

本设计复用现有审核脚本输出协议，不改变审核任务、结果持久化、节点状态机或 DAG 推进逻辑。

## 2. 当前问题

当前审核脚本返回：

```json
{
  "passed": false,
  "reason": "文档字数不足：当前 219 字，最低要求 1000 字",
  "details": {
    "checkedFileCount": 1,
    "issues": []
  }
}
```

后端将 `reason` 和 `details` 同时返回学生端，学生端分别使用段落和 `<pre>` 展示。结果是学生在可读说明之后继续看到内部字段、文件 ID、问题代码和完整 JSON，增加理解成本，也暴露了不属于学生操作界面的结构化数据。

## 3. 字段职责

继续沿用现有字段，不增加 `resultMarkdown` 等重复字段：

- `reason`：面向学生的 Markdown 文字结果，是学生审核结果区域唯一的业务说明来源；
- `details`：供系统审计、教师统计和后续结构化处理使用，继续存入 `audit_jobs.result_json` 并保留在现有 API 响应中，但学生页面不渲染；
- `passed`：继续决定审核通过或退回；
- `schemaVersion`：继续用于脚本输出协议校验。

审核脚本作者需要在 `reason` 中组织完整的学生可读结果。需要展示多项问题时，应使用 Markdown 列表，而不是依赖学生端解释 `details.issues`。

示例：

```markdown
## 审核未通过

请修改以下问题后重新提交：

- 文档当前 **219 字**，最低要求 **1000 字**。
- 请补充研究内容和经费使用说明。
```

## 4. Markdown 支持范围

前端使用 `react-markdown` 渲染 `reason`，支持 CommonMark 基础语法：

- 标题；
- 段落和 CommonMark 换行；
- 有序列表和无序列表；
- 粗体和斜体；
- 引用；
- 链接；
- 行内代码和围栏代码块；
- 分隔线。

本次不启用 GFM 表格、任务列表、数学公式、流程图或原始 HTML，以控制依赖和展示复杂度。后续只有在审核脚本出现明确需求时再扩展。

## 5. 安全边界

审核结果即使来自版本化内部脚本，也按不可信展示内容处理：

- 不启用 `rehype-raw`，并显式跳过原始 HTML；
- Markdown 图片不渲染，避免加载外部跟踪资源；
- 链接沿用 `react-markdown` 的安全 URL 转换，并使用新窗口打开；
- 外部链接增加 `rel="noopener noreferrer"`；
- 不使用 `dangerouslySetInnerHTML`；
- 不将 `details` 拼接进 Markdown；
- 不把 OSS 对象键、文件内部 ID、脚本路径或技术异常信息展示给学生。

## 6. 学生端展示规则

`AuditResult` 的状态行为保持如下：

- `reviewing`：继续显示“自动审核中”，不渲染 Markdown；
- `rejected`：渲染 `reason` Markdown，允许学生按意见重新上传；
- `approved`：如果存在非空 `reason`，渲染审核通过说明；
- `audit_error`：继续使用后端固定的脱敏提示，不显示脚本结果和技术错误。

`reason` 在去除首尾空白后为空时：

- `rejected` 显示“审核未提供具体说明，请根据节点要求修改后重新提交。”；
- 其他状态不额外显示空白 Markdown 区域。

学生页面不再根据 `details` 是否存在决定审核结果区域是否出现，也不再渲染 JSON `<pre>`。

## 7. 视觉规范

Markdown 内容位于现有 `.runtime-audit-result` 卡片内，沿用审核状态边框和背景，不新增嵌套卡片。

- 正文字号和颜色与现有审核说明一致；
- 首尾元素无额外外边距；
- 标题使用紧凑层级，不能接近页面主标题尺寸；
- 列表保持清晰缩进和合理行距；
- 引用使用左边框，不使用大面积装饰；
- 行内代码和代码块使用中性背景，长内容可换行或横向滚动；
- 链接使用现有蓝色强调色，并保留可见焦点状态。

## 8. 实现范围

### 前端依赖

- `frontend/package.json`：增加 `react-markdown`；
- `frontend/package-lock.json`：由 npm 更新锁文件；
- 不增加 `remark-gfm`、`rehype-raw` 或 HTML 清洗库。

### 前端代码

- `frontend/src/features/academic-flow/StudentRuntimePage.tsx`：新增聚焦的审核 Markdown 渲染组件，移除 `JSON.stringify(audit.details)`；
- `frontend/src/styles.css`：增加审核 Markdown 排版样式，删除不再使用的 `.runtime-audit-result pre` JSON 样式或将代码块样式限定到 Markdown 容器。

### 文档

- `docs/06_check_scripts.md`：明确 `reason` 是支持基础 Markdown 的学生可见结果，`details` 不由学生端直接展示。

后端、数据库和审核脚本协议验证代码不修改。

## 9. 历史兼容

- 现有纯文本 `reason` 是合法 Markdown，将按普通段落显示；
- 历史 `details` 继续保留，不迁移、不删除；
- 当前字数审核脚本无需修改即可正常显示现有文字；
- 新脚本可以逐步在 `reason` 中使用基础 Markdown；
- API 结构保持不变，不影响其他潜在调用方。

## 10. 错误与降级

- Markdown 中的无效语法按普通文本或 CommonMark 容错规则展示；
- 原始 HTML 被忽略，不执行脚本或内联事件；
- 图片语法不发起网络请求；
- 超长结果继续受审核脚本标准输出大小上限保护；
- 结构化 `details` 解析失败时不影响已有 `reason` 的展示。

## 11. 验收标准

1. 学生审核结果区域不再显示 JSON、内部文件 ID 或问题代码。
2. 现有纯文本 `reason` 正常显示。
3. Markdown 标题、段落、列表、加粗、引用、链接、行内代码和代码块正常排版。
4. Markdown 原始 HTML不执行，图片不加载。
5. `rejected` 且 `reason` 为空时显示固定兜底说明。
6. `reviewing`、`approved` 和 `audit_error` 的原有状态语义保持不变。
7. `details` 继续存在于数据库和 API 中，不因 UI 调整丢失。
8. 学生重新上传、提交、审核轮询和 DAG 开放逻辑不受影响。
9. 历史纯文本审核结果无需迁移即可查看。

## 12. 验证约束

遵循仓库规则，实施阶段不运行自动化测试、构建、浏览器或 Playwright。只执行静态调用链审计、依赖锁文件检查、差异范围检查、缓存清理和本地非 Docker 服务重启，由用户按验收标准手动验证。

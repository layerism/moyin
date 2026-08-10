# 签署文件模板与 AI 审核解耦设计

## 目标

确认承诺节点的签署文件模板、扫描件提交和 AI 视觉审核不再由同一个开关控制。教师可独立配置 DOCX 模板，并选择扫描件上传后直接通过、AI 通过/不通过或 AI 评分。

## 教师端交互

“签署文件模板（DOCX）”区域始终显示，不再受 `scanAuditEnabled` 控制。教师可随时上传、替换或删除模板；确认承诺节点模板必须为 `.docx`。

原“扫描件视觉审核”开关改为三个互斥审核方式：

1. 上传扫描件后直接通过；
2. AI 通过／不通过；
3. AI 评分（0–100 分）。

现有字段保持不变：

- 直接通过：`scanAuditEnabled=false`，`scanAuditMode` 为空，`scanAuditPrompt` 为空；
- AI 通过／不通过：`scanAuditEnabled=true`，`scanAuditMode="pass_fail"`；
- AI 评分：`scanAuditEnabled=true`，`scanAuditMode="score"`。

只有 AI 模式显示审核标准输入框并要求非空。直接通过不调用视觉模型，也不产生评分或审核原因。

模板与审核方式的有效组合：

- 无模板且未启用 AI：普通确认承诺节点，仅记录学生确认；
- 有模板且未启用 AI：下载模板、上传扫描件，保存成功后直接通过；
- 有模板且启用 AI：下载模板、上传扫描件，再执行选定的 AI 审核；
- 无模板但启用 AI：不可发布，提示上传 DOCX 签署文件模板。

## 数据语义与兼容性

不新增数据库列或流程 JSON 字段。

`templateAsset` 是否存在决定确认承诺节点是否要求签署扫描件；`scanAuditEnabled` 只表示是否绑定和执行 AI 视觉审核脚本。`scanAuditMode` 与 `scanAuditPrompt` 仅在 AI 启用时有效。

旧版本中已启用 AI 的确认承诺节点按照原配置继续工作。旧的普通确认承诺节点没有模板，仍保持只确认即可通过。文件上传节点的模板逻辑不变。

## 模板生命周期

后端模板能力由节点类型决定：文件上传节点和所有确认承诺节点均可配置模板。确认承诺模板无论 AI 是否启用都强制为 DOCX。

发布时，模板资产仍绑定到具体流程版本。学生下载权限继续受名单、前置节点、开放时间、截止时间和版本状态控制；“始终可下载”指节点可访问后不受 AI 开关限制，不突破流程访问控制。

教师删除模板时：

- 若 AI 未启用，节点恢复为普通确认承诺；
- 若 AI 已启用，发布校验阻止发布并提示补充模板。

## 学生运行时

学生端根据运行时 `template` 是否存在展示模板下载和扫描件上传区域，不再读取 `scanAuditEnabled` 决定是否展示。

有模板时：

1. 学生先下载模板；
2. 上传 JPG、PNG 或 PDF 扫描件；
3. 确认承诺并提交节点。

模板下载事件仍是扫描件上传前置条件。文件格式、数量、页数和大小校验保持现有规则。

只要确认承诺节点存在模板，提交载荷必须包含扫描件：

- 直接通过模式没有审核脚本，提交记录和节点立即标记为 `approved`，随后推进下游节点；
- AI 模式绑定现有视觉审核脚本，提交进入 `reviewing`，等待审核结果。

只在文件成功校验、持久化并完成提交后直接通过；上传失败、文件不合规或未确认承诺时不得通过。

只要提交载荷包含扫描件，已提交详情都显示扫描件清单和教师下载入口。AI 通过/不通过模式继续向学生展示不通过原因；AI 评分模式继续隐藏分数和评分说明。

## 后端职责调整

以下判断由“`scanAuditEnabled` 为真”改为“确认承诺节点存在 `templateAsset`”：

- 确认承诺节点支持模板；
- 学生节点支持 `scan_set` 文件上传；
- 提交时必须收集并绑定扫描件；
- 学生端和教师进度中的扫描件提交识别。

以下判断继续依据 `scanAuditEnabled`：

- 发布时绑定视觉审核脚本；
- 校验 AI 审核模式和提示词；
- 创建审核任务并进入 `reviewing`；
- AI 结果的通过、不通过或评分处理。

在 `backend/app/domain/workflow.py` 提供共享谓词 `confirmation_requires_scans(node)`，统一表达“确认承诺节点存在模板并要求扫描件”。模板校验、文件上传和流程提交均调用该谓词，不在各仓储模块重复拼接条件。

## 预计修改范围

前端：

- `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- `frontend/src/features/academic-flow/StudentRuntimePage.tsx`
- `frontend/src/features/academic-flow/ScanUploadWorkspace.tsx`
- `frontend/src/features/academic-flow/TeacherProgressPanel.tsx`
- `frontend/src/features/academic-flow/publishButtonState.ts`
- `frontend/src/styles.css`

后端：

- `backend/app/domain/workflow.py`
- `backend/app/repositories/flow_templates.py`
- `backend/app/repositories/flow_files.py`
- `backend/app/repositories/flow_instances.py`
- 其他直接以 `scanAuditEnabled` 判断扫描件提交能力的调用点。

不修改数据库表结构，不新增依赖，不改变视觉模型供应商配置。

## 静态审计标准

按仓库规则不运行测试、构建或浏览器插件，仅检查：

- 教师关闭 AI 后仍可上传和发布 DOCX 模板；
- 有模板的直接通过节点仍强制下载、上传和确认；
- 直接通过不会创建审核脚本或审核任务；
- AI 模式仍要求模板、审核方式和审核标准；
- 学生端、上传上下文、提交载荷和教师详情使用同一“模板存在”语义；
- 旧的 AI 节点和普通确认节点保持兼容；
- 文件上传节点模板能力不受影响。

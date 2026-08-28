# 学生密码重置与强制改密设计

> 状态：书面规格已于 2026-08-29 经用户确认。

## 目标

超级管理员可以在数据库管理页为普通学生账号重置密码。重置后的临时密码固定为 `123`；学生使用临时密码登录后，只能先设置至少 8 位的新密码，完成后才能继续访问原有流程、草稿、提交、成绩和文件。

本功能必须使用独立服务端操作，不开放 `password_hash` 编辑，不依赖前端隐藏实现权限控制。

## 非目标

- 不删除或重建学生账号；
- 不改变 `student_account_id`；
- 不删除、迁移或重新计算流程实例、节点状态、草稿、提交、答题卡成绩、上传文件或审核记录；
- 不为学生预览账号重置密码；
- 不为教师账号增加相同功能；
- 不把临时密码、明文新密码或密码哈希写入响应、日志或审计记录；
- 不在通用数据库行编辑接口中增加 `password_hash` 修改权限。

## 数据模型

在 `student_accounts` 增加：

```sql
must_change_password INTEGER NOT NULL DEFAULT 0
    CHECK (must_change_password IN (0, 1))
```

现有账号迁移后取默认值 `0`，保持当前登录行为。管理员重置时写入 `1`；学生设置新密码成功后写回 `0`。

密码继续使用现有 `hash_password()` 的 PBKDF2-SHA256 格式保存。数据库中不新增明文临时密码字段。

## 管理员操作

### 界面

仅当数据库管理页满足以下条件时显示“重置密码”按钮：

- 当前表为 `student_accounts`；
- 当前记录 `account_kind = "normal"`；
- 当前操作者为已通过后端鉴权的超级管理员。

按钮位于学生账号记录详情页脚，与“取消”“保存修改”分开。点击后打开确认弹窗，明确显示：

- 学号与姓名；
- 临时密码将重置为 `123`；
- 学生现有登录状态会失效；
- 已填写流程和提交记录不会删除；
- 必填的操作原因。

确认成功后关闭确认弹窗和记录详情，刷新当前表并显示操作结果。预览账号不显示按钮；服务端仍必须独立拒绝预览账号，不能只依赖界面判断。

### 专用接口

```http
POST /api/admin/database/student-accounts/{student_id}/reset-password
Content-Type: application/json

{
  "reason": "学生忘记密码"
}
```

接口继续使用 `get_current_super_admin`。不得复用通用 `PATCH /tables/{table}/rows`，避免把密码哈希纳入通用字段编辑体系。

### 重置事务

服务端先创建与当前数据库管理修改一致的备份，然后在单一数据库事务内：

1. 查询目标 `student_accounts` 记录；
2. 不存在时返回 `404`；
3. `account_kind != "normal"` 时返回 `422`；
4. 将 `password_hash` 更新为 `hash_password("123")`；
5. 将 `must_change_password` 更新为 `1`；
6. 更新 `updated_at`；
7. 删除该 `student_account_id` 对应的全部 `student_sessions`；
8. 写入 `audit_logs`。

审计记录使用：

```text
action      = student_password_reset
entity_type = student_account
entity_id   = 学生账号 ID
```

审计前后数据只记录学号、姓名、`mustChangePassword` 状态和会话失效事实；不包含 `123`、新密码或任何密码哈希。

## 学生登录与受限会话

### 凭证模型拆分

当前学生注册和登录共用“密码至少 8 位”的请求模型，无法提交临时密码 `123`。应拆分为：

- 学生注册：密码长度 `8..128`；
- 学生普通登录：密码长度 `3..128`，仅用于允许提交固定临时密码；
- 教师注册与登录：保持现有至少 8 位规则，不随本功能放宽。

学生登录前端同步采用相同条件：注册至少 8 位；学生登录至少 3 位。该调整必须同时覆盖学生首页登录和分享链接中的学生登录。

### 登录响应

学生身份响应增加：

```json
{
  "id": 11,
  "studentNo": "202308764230",
  "name": "吴木河",
  "mustChangePassword": true
}
```

验证 `123` 成功后仍创建学生会话，但该会话属于“待改密”状态。状态来源始终是 `student_accounts.must_change_password`，不在 Cookie 或前端本地状态中单独复制权限事实。

### 后端访问边界

学生会话解析拆成两层：

1. 身份解析：验证 Cookie、会话有效期、账号状态和 `account_kind = "normal"`，返回 `mustChangePassword`；
2. 正式学生依赖：若 `mustChangePassword = true`，返回 `403`，提示先修改初始密码。

仅以下认证接口允许待改密会话：

- `GET /api/auth/student/me`；
- `POST /api/auth/student/change-password`；
- `POST /api/auth/student/logout`。

学生流程列表、分享链接进入、流程实例、暂存、提交、上传、下载和审核重试继续使用正式学生依赖，因此待改密会话无法绕过前端直接访问业务接口。

## 强制修改密码

### 接口

```http
POST /api/auth/student/change-password
Content-Type: application/json

{
  "newPassword": "至少八位的新密码"
}
```

约束：

- 必须具有有效学生会话；
- 当前账号必须 `must_change_password = 1`；
- 新密码长度为 `8..128`；
- 新密码不得等于 `123`；
- 目标必须是普通学生账号。

成功时在单一事务中更新密码哈希、写回 `must_change_password = 0`、更新 `updated_at`，并删除该学生全部旧会话。随后创建并设置一个新的学生会话 Cookie，实现会话轮换，响应返回 `mustChangePassword = false` 的学生身份。

## 前端流程

新增共享的学生强制改密表单，包含：

- 新密码；
- 确认新密码；
- 至少 8 位提示；
- 提交错误；
- 退出登录。

两个学生入口必须使用同一组件和接口：

### 学生首页登录

1. `/auth/login?role=student` 登录返回身份；
2. `mustChangePassword = true` 时进入 `/student/change-password`；
3. 改密成功后进入 `/student`；
4. 页面刷新时，`/me` 仍能返回待改密身份并恢复改密页面。

### 分享链接登录

1. 学生在 `/s/{token}` 登录；
2. 返回待改密身份时，在分享链接页面内显示同一改密表单；
3. 改密成功后继续调用原分享链接的 `enterShared(token)`；
4. 改密前不得创建或进入流程实例。

注册成功的新学生账号默认 `mustChangePassword = false`，按现有流程直接进入。

## 数据保留不变量

密码重置和强制改密过程中，以下表不得执行 `DELETE`、`UPDATE` 或重建操作：

- `flow_instances`；
- `node_instances`；
- `node_drafts`；
- `submissions`；
- `answer_sheet_grades`；
- `uploaded_files`；
- `audit_jobs` 及审核结果相关表。

唯一允许删除的是目标学生的 `student_sessions`。学生改密后仍使用原 `student_accounts.id`，所有通过该 ID 关联的历史数据自然保持不变。

## 错误处理

- 目标学生不存在：`404 学生账号不存在`；
- 目标为预览账号：`422 预览学生账号不能重置密码`；
- 操作原因为空：`422`；
- 非超级管理员调用：沿用 `403`；
- 待改密会话访问业务接口：`403 请先修改初始密码`；
- 普通账号调用强制改密接口：`409 当前账号不需要重置密码`；
- 新密码不足 8 位或仍为 `123`：`422`；
- 重置事务失败：整体回滚，不出现密码已改但会话未失效的中间状态。

## 安全边界

- 临时密码 `123` 是已确认的业务要求，其风险通过强制改密和业务接口封锁降低，但不能视为安全密码；
- 密码重置按钮仅用于超级管理员，后端鉴权是最终边界；
- 重置后立即使全部旧学生会话失效；
- 新密码成功保存后再次轮换会话；
- API、前端状态、日志、审计和数据库管理列表均不显示密码或哈希；
- 通用数据库行修改接口仍将 `password_hash` 视为只读敏感字段。

## 影响范围

- `backend/app/core/database.py`：增加迁移字段；
- `backend/app/services/security.py`：区分身份解析与正式学生访问；
- `backend/app/api/routes/auth.py`：拆分登录/注册模型并增加改密接口；
- `backend/app/repositories/database_admin.py`：实现专用重置事务；
- `backend/app/api/routes/database_admin.py`：增加超级管理员重置接口；
- `frontend/src/features/admin/DatabaseAdminPage.tsx`：重置按钮和确认弹窗；
- `frontend/src/features/admin/databaseAdminApi.ts`：重置请求；
- `frontend/src/features/auth/AuthPortal.tsx`、`authApi.ts`：待改密身份分发；
- `frontend/src/features/auth/StudentAccessGate.tsx`：分享入口待改密分支；
- 新增共享的学生改密组件；
- `frontend/src/App.tsx` 与相关类型：刷新恢复和页面路由。

## 验收标准

1. 超级管理员能为普通学生账号重置密码，预览账号不能重置；
2. 重置后旧学生会话全部失效，临时密码 `123` 可以通过学生登录；
3. 使用 `123` 登录后只能修改密码，无法列出、进入、暂存、提交或上传流程数据；
4. 新密码不足 8 位或等于 `123` 时拒绝；
5. 改密成功后会话已轮换，可以继续进入原学生首页或原分享流程；
6. 首页登录和分享链接登录使用相同改密语义；
7. 教师密码规则与教师会话不受影响；
8. 学生账号 ID、流程实例、草稿、提交、成绩、文件和审核记录均保持不变；
9. 审计日志记录操作者、目标学生、原因和状态变化，但不包含任何密码或哈希；
10. `password_hash` 继续无法通过通用数据库编辑接口读取或修改。

# 双角色认证与流程软删除设计

## 1. 目标

为现有项目增加独立的教师、学生注册与登录页面，并将教师管理端和学生填写端进行权限隔离。同时为教务流程列表增加安全删除能力：前端二次确认，后端只归档流程，不删除任何流程版本、学生实例或提交记录。

## 2. 认证页面

### 2.1 路由

- `/auth/login`：统一登录入口，可切换教师和学生身份。
- `/auth/register`：统一注册入口，可切换教师和学生身份。
- `/auth/forgot-password`：占位页面，不提供真实密码重置能力。

### 2.2 字段

教师注册与登录使用：姓名、工号、密码。注册时增加确认密码。

学生注册与登录使用：姓名、学号、密码。注册时增加确认密码。

姓名和身份编号均需去除首尾空格。工号、学号在各自账号表中唯一；教师和学生身份不可通过客户端参数互换。

### 2.3 页面行为

- 登录页默认展示教师登录，并提供教师/学生分段切换。
- 注册页保留当前身份选择，并允许返回登录页。
- 密码至少 8 位，前端和后端同时校验。
- 登录失败统一提示“姓名、工号/学号或密码不正确”，避免泄露账号是否存在。
- “忘记密码”只进入占位页面，展示“密码找回功能待开发，请联系管理员”。
- 占位页面不请求密码重置接口，不写入数据库。

## 3. 账号与会话

保留现有 `student_accounts` 和 `student_sessions`，新增：

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `teacher_accounts` | `id`, `employee_no`, `name`, `password_hash`, `status`, `created_at`, `updated_at` | 教师账号 |
| `teacher_sessions` | `id`, `teacher_account_id`, `token_hash`, `expires_at`, `created_at` | 教师会话 |

密码统一使用 PBKDF2-HMAC-SHA256 和随机盐。教师会话 Cookie 使用 `teacher_session`，学生会话 Cookie 使用现有 `oa_session`；二者均设置 `HttpOnly`、`SameSite=Lax`，生产环境设置 `Secure`。

教师接口从 `teacher_session` 获取身份，学生接口从 `oa_session` 获取身份。客户端提交的工号、学号或角色字段不能作为授权依据。

## 4. 登录后导航

- 教师登录成功后进入 `/`，展示材料收集和教务流程管理端。
- 学生从普通登录页登录后进入 `/student`，展示学生账户首页和已参与流程列表。
- 学生从 `/s/{token}` 进入时，登录或注册成功后继续创建或读取该学生的流程实例，并进入 `/student/flows/{instanceId}`。
- 未登录教师访问 `/academic-flow` 或流程设计页时跳转 `/auth/login?role=teacher`。
- 学生会话不能访问教师管理页面；教师会话不代替学生身份提交材料。

## 5. 流程软删除

### 5.1 前端

- 每条教务流程右侧增加删除图标按钮，点击删除按钮不得触发进入流程。
- 第一次点击只打开确认对话框。
- 对话框显示流程名称和说明：“删除后将从列表隐藏，历史数据不会清除”。
- 用户确认后调用归档接口；取消时不产生任何状态变化。
- 归档成功后从当前列表移除该流程。

### 5.2 后端

- 接口：`DELETE /api/workflows/{flowId}`。
- 删除操作只将 `flows.status` 更新为 `archived`，并更新 `updated_at`。
- 写入 `audit_logs`，记录教师、流程、原状态、归档状态和时间。
- `GET /api/workflows` 默认排除 `archived`。
- 不删除 `flow_versions`、`share_tokens`、`flow_instances`、`node_instances`、`submissions` 或附件元数据。
- 已归档流程的教师设计和发布接口返回不可操作错误；历史学生实例仍可读取，是否允许继续提交由流程运行状态控制，不由列表可见性决定。

## 6. API

### 6.1 教师认证

- `POST /api/auth/teacher/register`
- `POST /api/auth/teacher/login`
- `GET /api/auth/teacher/me`
- `POST /api/auth/teacher/logout`

### 6.2 学生认证

保留并明确现有接口：

- `POST /api/auth/student/register`
- `POST /api/auth/student/login`
- `GET /api/auth/student/me`
- `POST /api/auth/student/logout`

为兼容第一版分享链接，可在过渡期保留现有 `/api/auth/register` 等别名，由新前端统一使用带角色前缀的接口。

### 6.3 学生账户

- `GET /api/student/flow-instances`：返回当前学生已参与流程，供学生账户首页展示。

## 7. 错误处理

- 重复工号或学号：返回 `409 Conflict`。
- 未认证：返回 `401 Unauthorized`。
- 身份权限不匹配：返回 `403 Forbidden`。
- 已归档流程再次归档：幂等返回成功，不重复删除数据。
- 已归档流程保存或发布：返回 `409 Conflict`。
- 忘记密码占位页不得产生任何网络写操作。

## 8. 测试

### 8.1 后端

- 教师和学生分别注册、登录、恢复会话和退出。
- 工号、学号唯一性。
- 学生 Cookie 不能访问教师流程管理接口。
- 教师 Cookie 可以创建、保存和归档流程。
- 归档后列表不显示流程，数据库中的版本和学生实例仍存在。
- 重复归档保持幂等。

### 8.2 前端与浏览器

- 教师/学生登录和注册切换正确，字段名称随身份变化。
- 忘记密码页面只显示占位信息。
- 未登录访问教师页面跳转登录，教师登录后返回管理端。
- 学生通过分享链接登录后返回原流程。
- 删除按钮不会进入流程；取消确认不删除；确认后列表隐藏流程。
- 桌面与移动端页面无布局溢出，控制台无错误或警告。

## 9. 模块边界

- 后端教师认证独立于学生流程运行仓库。
- 前端认证页面放入 `features/auth/`，不将角色表单逻辑继续堆入 `App.tsx`。
- 路由解析和登录回跳使用明确的返回路径，不依赖组件内部状态。
- 流程归档逻辑放入 workflow repository，前端只消费 API 结果。


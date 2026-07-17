# 数据库管理全部表可见设计

## 目标

超级管理员进入数据库管理页面后，可以查看当前 SQLite 数据库中的全部数据表。后续新增数据表应自动出现，不再依赖手工加入展示白名单。

“全部表可见”仅表示能够读取表结构和记录。现有业务表继续按既有策略开放字段编辑；没有显式管理策略的表默认只读且不可删除。

## 当前问题

数据库管理后端仅遍历静态 `TABLE_POLICIES`。因此，数据库中已经存在但未加入该字典的 `uploaded_files`、`audit_scripts`、`audit_script_versions`、`schema_migrations` 和 `sqlite_sequence` 不会返回给前端。

静态策略目前同时承担表名准入和字段编辑控制。如果直接取消准入校验，动态表名可能进入 SQL；如果简单把全部表加入既有策略，前端又会为这些表显示通用删除入口，可能造成 OSS 孤立对象或破坏迁移状态。

## 设计

### 表发现与访问控制

后端从 `sqlite_master` 查询 `type = 'table'` 的全部表，按表名排序后返回。该查询结果是数据库管理接口可接受表名的唯一来源，所有读取、修改和删除操作在拼接表名之前都必须验证目标表仍然存在于该集合中。

`TABLE_POLICIES` 不再决定表是否可见，只负责声明显式管理权限：

- 已配置表保留现有 `editable_columns`；
- 未配置表的 `editable_columns` 为空；
- 未配置表默认 `deletable = false`；
- 已配置表保持当前删除能力，避免改变既有数据库管理行为。

由 SQLite 自动维护的 `sqlite_sequence` 以及迁移表 `schema_migrations` 同样展示，但由于没有显式策略，只能查看。

### API 返回结构

`GET /api/admin/database/tables` 的每个表增加 `deletable` 布尔字段，并继续返回：

- `name`：真实表名；
- `rowCount`：记录数；
- `editableColumns`：允许修改的字段；
- `deletable`：是否允许通过通用管理接口删除记录。

`GET /api/admin/database/tables/{table}/schema` 同样返回 `deletable`，使页面在单独加载表结构后仍能依据服务端权限渲染操作。

PATCH 接口继续以 `editable_columns` 拒绝未授权字段；DELETE 接口在执行备份或 SQL 前检查 `deletable`，只读表返回 `422`，不执行删除。

### 前端行为

左侧表目录展示 API 返回的全部表，计数文案由“业务表”调整为“数据表”。

记录表格保留“查看”入口。“删除”按钮仅在当前表 `deletable = true` 时显示。只读表的查看抽屉仍展示全部字段，但没有可保存字段；现有敏感字段脱敏规则保持不变。

### 安全与一致性

- 表名必须来自当前连接查询到的 `sqlite_master`，不能仅依赖字符串转义。
- `password_hash`、`token_hash`、`token_value` 继续返回脱敏值。
- `uploaded_files` 默认只读，避免绕过对象存储服务直接删除元数据并遗留 OSS 对象。
- `schema_migrations` 和 `sqlite_sequence` 默认只读，避免破坏数据库初始化及自增状态。
- 表在列表加载后被删除时，后续结构或记录请求返回现有的 404 语义。

## 变更范围

- `backend/app/repositories/database_admin.py`：动态表发现、默认只读策略、删除权限校验；
- `frontend/src/features/admin/databaseAdminApi.ts`：补充权限字段类型；
- `frontend/src/features/admin/DatabaseAdminPage.tsx`：全部表展示文案及按权限隐藏删除入口。

不修改数据库结构，不迁移已有数据，不改变 OSS 文件生命周期，也不新增依赖。

## 验收标准

1. 管理页能看到当前数据库的全部 20 张表，包括 `uploaded_files` 和 `sqlite_sequence`。
2. 后续新建表会自动出现在管理页。
3. 未配置策略的表可以查看结构和记录，但不能编辑或删除。
4. 现有白名单表的编辑与删除行为保持不变。
5. 敏感字段继续脱敏，非法或不存在的表名无法进入动态 SQL。

## 验证边界

按照本项目约定，实施阶段只做业务逻辑审计，不由 Codex 运行自动化测试、浏览器测试或构建验证；完成后重启服务，由用户手动检查管理页。

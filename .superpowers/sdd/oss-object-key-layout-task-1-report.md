# OSS 对象键布局任务 1 实施报告

## 改动

- `backend/app/services/object_storage.py`
  - 新增 `timestamped_object_name(filename)`，按“毫秒时间戳_8 位 UUID token_安全文件名”生成对象名。
  - `_safe_part()` 在提取末尾文件名后，将 ASCII 控制字符替换为下划线；空结果仍回退为 `unnamed`。
- `backend/app/api/routes/student_flows.py`
  - 学生上传键改为 `oss_prefix/submissions/flow_id/flow_instance_id/timestamped_name`。
  - 删除不再使用的路由级 `uuid` 导入。
- `backend/app/api/routes/workflows.py`
  - 教师模板上传键改为 `oss_prefix/templates/flow_id/timestamped_name`。
  - 删除不再使用的路由级 `uuid` 导入。

## 静态审计

- 已执行对象键、对象名和 `storage_key` 的只读检索，以及三个实现文件的差异检查。
- `git diff --check` 通过，无空白错误。
- `uploaded_files.storage_key` 继续由 `replace_uploaded_file()` 保存并由学生下载、上传失败补偿删除和旧文件替换删除读取。
- `flow_template_assets.storage_key` 继续由 `save_template_asset()` 保存并由模板下载、上传失败补偿删除、替换删除和显式删除读取。
- 两个上传路由均未再保留 `flow_version_id`、`node_key`、独立 UUID 目录或原文件名子目录。
- 两个路由文件均未检出未使用的 `uuid` 导入。
- 三个实现文件的差异仅包含本任务所需的对象键生成与调用替换；工作区中既有的 `AGENTS.md`、`docs/05_oa_graph.md` 和 `.superpowers` 变更未被修改。

## 未运行测试

遵照任务限制，未运行自动化测试、构建、浏览器检查、服务重启或可达性检查。

## 疑虑

无实现层面的已知疑虑。运行时上传验证尚待由后续允许的集成或手工检查完成。

# OSS 对象键哈希后缀任务实施报告

## 改动

- `backend/app/services/object_storage.py`
  - 移除 `uuid` 依赖。
  - `timestamped_object_name()` 现接收 `filename` 与 `sha256_hex`，生成 `time.time_ns()_sha256前8位_安全文件名`。
- `backend/app/api/routes/student_flows.py`
  - 在文件摘要计算完成后只调用一次 `digest.hexdigest()`，结果同时用于对象名与 `replace_uploaded_file()` 的 `sha256` 字段。
- `backend/app/api/routes/workflows.py`
  - 在文件摘要计算完成后只调用一次 `digest.hexdigest()`，结果同时用于对象名与 `save_template_asset()` 的 `sha256` 字段。

## 静态审计

- 已检索对象键、对象名与 `storage_key` 的调用，并检查三个实现文件差异。
- 两个上传入口均将当前上传文件的同一 SHA-256 字符串传给 `timestamped_object_name()` 和对应仓储函数。
- 对象名实现中不再使用 UUID，时间戳精度为 `time.time_ns()`。
- `git diff --check` 通过，无空白错误。
- 学生下载从记录读取 `storage_key`；替换逻辑读取旧 `storage_key`；两类上传失败补偿和模板替换/删除均以保存的完整键删除对象。
- 审核链路仍由 `audit_jobs` 查询 `uploaded_files.storage_key`，并由 `audit_script_executor` 使用该键下载审核材料。
- 三个实现文件的差异仅包含本任务所需的哈希后缀和摘要复用改动；未修改工作区既有的其他文件。

## 未运行测试

遵照任务限制，未运行自动化测试、构建、浏览器检查、服务重启或可达性检查。

## 疑虑

无已知实现疑虑；运行时上传与审核下载验证待后续允许的集成或手工检查完成。

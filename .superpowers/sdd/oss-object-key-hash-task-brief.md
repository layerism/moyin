### Task 1: 统一对象名生成并切换两个上传入口

**Files:**
- Modify: `backend/app/services/object_storage.py`
- Modify: `backend/app/api/routes/student_flows.py`
- Modify: `backend/app/api/routes/workflows.py`

**Interfaces:**
- Consumes: `object_key(prefix: str, *parts: str) -> str`、`FileUploadContext.flow_id`、`FileUploadContext.flow_instance_id`。
- Produces: `timestamped_object_name(filename: str, sha256_hex: str) -> str`。
- Preserves: `uploaded_files.storage_key`、`flow_template_assets.storage_key` 继续保存完整对象键。

- [ ] **Step 1: 在对象存储服务中增加统一对象名生成函数**

在 `backend/app/services/object_storage.py` 中引入标准库 `re`、`time`，集中生成文件对象名：

```python
import re
import time


_CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")


def timestamped_object_name(filename: str, sha256_hex: str) -> str:
    timestamp_ns = time.time_ns()
    return f"{timestamp_ns}_{sha256_hex[:8]}_{_safe_part(filename)}"
```

同时让现有 `_safe_part()` 在提取末尾文件名后替换 ASCII 控制字符：

```python
def _safe_part(value: str) -> str:
    filename = PurePosixPath(str(value).replace("\\", "/")).name
    return _CONTROL_CHARACTERS.sub("_", filename) or "unnamed"
```

- [ ] **Step 2: 修改学生文件上传对象键**

在 `backend/app/api/routes/student_flows.py` 复用已经计算的 SHA-256，避免重复调用 `digest.hexdigest()`，将对象键构造改为：

```python
sha256 = digest.hexdigest()
storage_key = object_key(
    settings.oss_prefix,
    "submissions",
    context.flow_id,
    context.flow_instance_id,
    timestamped_object_name(filename, sha256),
)
```

不得保留 `flow_version_id`、`node_key`、独立 UUID 目录或文件名子目录。

- [ ] **Step 3: 修改教师模板上传对象键**

在 `backend/app/api/routes/workflows.py` 复用已经计算的 SHA-256，避免重复调用 `digest.hexdigest()`，将对象键构造改为：

```python
sha256 = digest.hexdigest()
storage_key = object_key(
    settings.oss_prefix,
    "templates",
    flow_id,
    timestamped_object_name(filename, sha256),
)
```

不得保留 `node_key`、独立 UUID 目录或文件名子目录。

- [ ] **Step 4: 执行业务逻辑静态审计**

只运行只读检查，不运行测试、构建或浏览器：

```bash
rg -n "object_key|timestamped_object_name|storage_key" \
  backend/app/services/object_storage.py \
  backend/app/api/routes/student_flows.py \
  backend/app/api/routes/workflows.py \
  backend/app/repositories/flow_files.py \
  backend/app/repositories/flow_templates.py

git diff --check
git diff -- \
  backend/app/services/object_storage.py \
  backend/app/api/routes/student_flows.py \
  backend/app/api/routes/workflows.py
```

审计必须确认：两个上传入口传入本次文件 SHA-256；对象名不再使用 UUID；下载、替换、补偿删除和审核脚本仍读取数据库 `storage_key`；差异不包含用户现有文件。

- [ ] **Step 5: 清理缓存并提交唯一实现检查点**

清理仓库内的 `.pytest_cache`、`__pycache__`、`*.egg-info`，但不得删除源文件、虚拟环境或用户文档。仅暂存三个实现文件并提交：

```bash
git add \
  backend/app/services/object_storage.py \
  backend/app/api/routes/student_flows.py \
  backend/app/api/routes/workflows.py
git commit -m "refactor: derive OSS keys from file hashes"
```

- [ ] **Step 6: 本地重启服务并检查可达性**

停止当前本地 Uvicorn/Vite 进程，再分别从 `backend` 和 `frontend` 目录启动：

```bash
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
npm run dev -- --host 127.0.0.1
```

只检查端口与健康端点，不执行功能测试：

```bash
curl -s -i http://127.0.0.1:8000/api/health
curl -s -I http://127.0.0.1:5173/
```

预期两个端点均返回 HTTP 200。

## Task 3: 增加固定版本运行时解析入口

**Files:**

- Create: `backend/app/services/audit_script_runtime.py`
- Create: `backend/tests/test_audit_script_runtime.py`

- [ ] **Step 1: 写解析器失败测试**

测试创建两个版本后，调用：

```python
descriptor = resolve_audit_script_version(script_id, 1, version_1_sha256)
assert descriptor.version == 1
assert descriptor.language == "py"
assert descriptor.entry_path.name == "handler.py"
```

并覆盖：节点哈希不匹配、数据库版本不存在、入口路径逃逸脚本根目录、文件缺失、磁盘文件哈希变化。所有异常统一为 `AuditScriptResolutionError`，且错误信息不泄漏绝对路径。

- [ ] **Step 2: 运行测试并确认模块尚不存在**

Run: `cd backend && pytest -q tests/test_audit_script_runtime.py`

Expected: FAIL，无法导入运行时解析模块。

- [ ] **Step 3: 实现只读解析服务**

定义不可变描述符：

```python
@dataclass(frozen=True)
class AuditScriptRuntimeDescriptor:
    script_id: str
    version: int
    language: Literal["py", "js"]
    entry_path: Path
    sha256: str
```

实现：

```python
def resolve_audit_script_version(
    script_id: str,
    version: int,
    expected_sha256: str,
) -> AuditScriptRuntimeDescriptor: ...
```

解析器从 `audit_script_versions` 读取固定版本，使用 `Path.resolve()` 与 `is_relative_to()` 确认版本目录和入口文件位于 `Path(settings.audit_scripts_root).resolve()` 下，再校验文件存在和实际 SHA-256。不要执行文件，也不要读取环境变量。

- [ ] **Step 4: 运行测试并提交**

Run: `cd backend && pytest -q tests/test_audit_script_runtime.py`

Expected: PASS。

```bash
git add backend/app/services/audit_script_runtime.py backend/tests/test_audit_script_runtime.py
git commit -m "Add audit script runtime resolver"
```

---


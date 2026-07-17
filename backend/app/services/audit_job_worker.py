import asyncio
import logging

from app.repositories.audit_jobs import (
    claim_next_audit_job,
    complete_audit_job,
    fail_audit_job,
    recover_audit_jobs,
)
from app.services.audit_script_executor import AuditScriptExecutionError, execute_audit_script
from app.services.audit_script_runtime import (
    AuditScriptResolutionError,
    resolve_audit_script_version,
)


logger = logging.getLogger(__name__)
_worker_stops: dict[asyncio.Task[None], asyncio.Event] = {}


def start_audit_job_worker() -> asyncio.Task[None]:
    stop_event = asyncio.Event()
    task = asyncio.create_task(_worker_loop(stop_event), name="audit-job-worker")
    _worker_stops[task] = stop_event
    return task


async def stop_audit_job_worker(task: asyncio.Task[None]) -> None:
    stop_event = _worker_stops.pop(task, None)
    if stop_event is not None:
        stop_event.set()
    await task


async def _worker_loop(stop_event: asyncio.Event) -> None:
    await asyncio.to_thread(recover_audit_jobs)
    while not stop_event.is_set():
        job = await asyncio.to_thread(claim_next_audit_job)
        if job is None:
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=1.0)
            except TimeoutError:
                pass
            continue
        try:
            descriptor = await asyncio.to_thread(
                resolve_audit_script_version,
                job.script_id,
                job.script_version,
                job.script_sha256,
            )
            result = await asyncio.to_thread(
                execute_audit_script,
                descriptor,
                job.materials,
                job.context,
            )
            await asyncio.to_thread(complete_audit_job, job.id, result)
        except AuditScriptResolutionError:
            logger.warning("Audit job %s failed: script_resolution", job.id)
            await asyncio.to_thread(fail_audit_job, job.id, "审核脚本版本不可用")
        except AuditScriptExecutionError:
            logger.warning("Audit job %s failed: script_execution", job.id)
            await asyncio.to_thread(fail_audit_job, job.id, "审核脚本执行失败")
        except Exception as exc:
            logger.error("Audit job %s failed: %s", job.id, type(exc).__name__)
            await asyncio.to_thread(fail_audit_job, job.id, "自动审核服务异常")

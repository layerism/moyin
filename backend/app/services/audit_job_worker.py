import asyncio
import logging
import threading
from dataclasses import dataclass

from app.repositories.audit_jobs import (
    audit_job_execution_allowed,
    cancel_audit_job,
    claim_next_audit_job,
    complete_audit_job,
    fail_audit_job,
    recover_audit_jobs,
)
from app.repositories.audit_policies import synchronize_existing_audit_policies
from app.services.audit_script_catalog import synchronize_audit_script_states
from app.services.audit_script_executor import (
    AuditScriptExecutionCancelled,
    AuditScriptExecutionError,
    execute_audit_script,
)
from app.services.audit_script_parameters import (
    AuditScriptParameterError,
    validate_script_params,
    validate_script_settings,
)
from app.services.audit_script_runtime import AuditScriptResolutionError, resolve_audit_script


logger = logging.getLogger(__name__)
_cancellation_lock = threading.Lock()
_cancellations: dict[str, threading.Event] = {}


@dataclass
class AuditWorkerPool:
    stop_event: asyncio.Event
    tasks: list[asyncio.Task[None]]


async def start_audit_worker_pool(worker_count: int) -> AuditWorkerPool:
    await asyncio.to_thread(synchronize_audit_script_states)
    await asyncio.to_thread(synchronize_existing_audit_policies)
    await asyncio.to_thread(recover_audit_jobs)
    stop_event = asyncio.Event()
    tasks = [
        asyncio.create_task(_worker_loop(stop_event), name=f"audit-worker-{index + 1}")
        for index in range(max(1, worker_count))
    ]
    logger.info("Audit worker pool started: workers=%s", len(tasks))
    return AuditWorkerPool(stop_event, tasks)


async def stop_audit_worker_pool(pool: AuditWorkerPool) -> None:
    pool.stop_event.set()
    with _cancellation_lock:
        for event in _cancellations.values():
            event.set()
    await asyncio.gather(*pool.tasks, return_exceptions=True)
    logger.info("Audit worker pool stopped")


def signal_audit_job_cancellations(job_ids: list[str]) -> None:
    with _cancellation_lock:
        for job_id in job_ids:
            event = _cancellations.get(job_id)
            if event is not None:
                event.set()


async def _worker_loop(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        job = await asyncio.to_thread(claim_next_audit_job)
        if job is None:
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=0.5)
            except TimeoutError:
                pass
            continue
        cancellation = threading.Event()
        with _cancellation_lock:
            _cancellations[job.id] = cancellation
        try:
            if not await asyncio.to_thread(audit_job_execution_allowed, job.id):
                await asyncio.to_thread(cancel_audit_job, job.id, "script_updated")
                continue
            descriptor = await asyncio.to_thread(
                resolve_audit_script,
                job.script_id,
                job.script_generation,
                job.script_content_hash,
            )
            params = validate_script_params(descriptor.config, job.script_params)
            settings = validate_script_settings(descriptor.config, job.script_settings)
            result = await asyncio.to_thread(
                execute_audit_script,
                descriptor,
                job.materials,
                {**job.context, "scriptParams": params, "scriptSettings": settings},
                cancelled=cancellation.is_set,
            )
            await asyncio.to_thread(complete_audit_job, job.id, result)
        except AuditScriptExecutionCancelled:
            logger.info("Audit job cancelled: %s", job.id)
        except (AuditScriptResolutionError, AuditScriptParameterError):
            logger.warning("Audit job %s failed: script_resolution", job.id)
            await asyncio.to_thread(fail_audit_job, job.id, "审核脚本当前不可用")
        except AuditScriptExecutionError:
            logger.warning("Audit job %s failed: script_execution", job.id)
            await asyncio.to_thread(fail_audit_job, job.id, "审核脚本执行失败")
        except Exception as exc:
            logger.error("Audit job %s failed: %s", job.id, type(exc).__name__)
            await asyncio.to_thread(fail_audit_job, job.id, "自动审核服务异常")
        finally:
            with _cancellation_lock:
                _cancellations.pop(job.id, None)

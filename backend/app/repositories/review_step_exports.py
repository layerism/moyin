"""Read current-submission review results without flattening distinct steps."""
import json
from dataclasses import dataclass

from app.domain.file_review_steps import step_kind


ReviewStepKey = tuple[int, str, str]


@dataclass(frozen=True)
class ReviewStepExport:
    key: ReviewStepKey
    status: str
    passed: bool | None = None
    score: int | float | None = None
    reason: str | None = None


def review_step_key(step, index: int, node) -> ReviewStepKey:
    kind = step_kind(step)
    if isinstance(step, str) and kind == "ai" and node.get("scanAuditMode") == "score":
        kind = "score"
    step_id = str(step.get("id", "")) if isinstance(step, dict) else f"legacy-{index}"
    return index, step_id, kind


def get_review_step_exports(connection, submission_ids: list[str], node) -> dict[str, tuple[ReviewStepExport, ...]]:
    if not submission_ids:
        return {}
    placeholders = ", ".join("?" for _ in submission_ids)
    runs = connection.execute(
        f"SELECT * FROM file_review_runs WHERE submission_id IN ({placeholders})",
        tuple(submission_ids),
    ).fetchall()
    steps_by_submission = {row["submission_id"]: json.loads(row["steps_json"]) for row in runs}
    tasks = {
        (row["submission_id"], row["step_index"]): row
        for row in connection.execute(
            f"SELECT * FROM file_review_ai_tasks WHERE submission_id IN ({placeholders})",
            tuple(submission_ids),
        )
    }
    legacy_jobs = {
        row["submission_id"]: row
        for row in connection.execute(
            f"SELECT * FROM audit_jobs WHERE submission_id IN ({placeholders})",
            tuple(submission_ids),
        )
    }
    decisions = {}
    for row in connection.execute(
        f"""SELECT m.* FROM manual_reviews m
            WHERE m.node_instance_id IN (
                SELECT node_instance_id FROM submissions WHERE id IN ({placeholders})
            ) ORDER BY m.created_at, m.rowid""",
        tuple(submission_ids),
    ):
        evidence = json.loads(row["evidence_snapshot"])
        sources = evidence.get("sources", [])
        submission_id = sources[0].get("submissionId") if sources else None
        steps = steps_by_submission.get(submission_id)
        if steps is None:
            continue
        legacy_index = next((i for i, step in enumerate(steps) if step_kind(step) == "manual"), -1)
        index = evidence.get("reviewStepIndex", legacy_index)
        decisions[submission_id, index] = evidence.get("passed"), row["remark"]

    exports = {}
    for run in runs:
        submission_id = run["submission_id"]
        results = []
        for index, step in enumerate(steps_by_submission[submission_id]):
            key = review_step_key(step, index, node)
            status = "尚未执行"
            passed = score = reason = None
            if index < run["step_index"] or run["status"] == "completed":
                status = "已完成"
            elif run["status"] == "rejected" and index > run["step_index"]:
                status = "已停止（前序未通过）"
            elif run["status"] == "cancelled":
                status = "已停止"
            elif index == run["step_index"] and run["status"] == "active":
                status = "等待审核"

            if key[2] == "manual":
                decision = decisions.get((submission_id, index))
                if decision:
                    passed, reason = decision
                    status = "已完成"
            else:
                task = tasks.get((submission_id, index))
                if task is None and isinstance(step, str):
                    task = legacy_jobs.get(submission_id)
                if task is not None:
                    task_status = task["status"]
                    if task_status == "succeeded":
                        result = json.loads(task["result_json"] or "{}")
                        details = result.get("details") or {}
                        passed = result.get("passed")
                        score = details.get("score")
                        reason = result.get("reason")
                        status = "已完成"
                    elif task_status == "failed":
                        status = "审核异常"
                    elif task_status == "running":
                        status = "审核中"
                    elif task_status == "cancelled" and not status.startswith("已停止"):
                        status = "已停止"
            results.append(ReviewStepExport(
                key=key,
                status=status,
                passed=passed if isinstance(passed, bool) else None,
                score=score if isinstance(score, (int, float)) and not isinstance(score, bool) else None,
                reason=reason if isinstance(reason, str) else None,
            ))
        exports[submission_id] = tuple(results)
    return exports

from fastapi import APIRouter

from app.api.routes import (
    ai,
    auth,
    database_admin,
    flow_roster,
    health,
    student_flows,
    submissions,
    templates,
    workflow_admin,
    workflows,
)

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(
    database_admin.router, prefix="/admin/database", tags=["database-admin"]
)
api_router.include_router(templates.router, prefix="/templates", tags=["templates"])
api_router.include_router(submissions.router, prefix="/submissions", tags=["submissions"])
api_router.include_router(ai.router, prefix="/ai", tags=["ai"])
api_router.include_router(workflows.router, prefix="/workflows", tags=["workflows"])
api_router.include_router(flow_roster.router, prefix="/workflows", tags=["flow-roster"])
api_router.include_router(workflows.shared_router, prefix="/shared-flows", tags=["shared-flows"])
api_router.include_router(student_flows.router, prefix="/student", tags=["student-flows"])
api_router.include_router(workflow_admin.router, prefix="/workflow-admin", tags=["workflow-admin"])

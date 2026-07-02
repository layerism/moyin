from fastapi import APIRouter

from app.api.routes import ai, auth, health, submissions, templates

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(templates.router, prefix="/templates", tags=["templates"])
api_router.include_router(submissions.router, prefix="/submissions", tags=["submissions"])
api_router.include_router(ai.router, prefix="/ai", tags=["ai"])

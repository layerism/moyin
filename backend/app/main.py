from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.core.database import initialize_database
from app.services.audit_job_worker import start_audit_worker_pool, stop_audit_worker_pool


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    worker_pool = await start_audit_worker_pool(settings.audit_worker_count)
    try:
        yield
    finally:
        await stop_audit_worker_pool(worker_pool)


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix="/api")
    return app


app = create_app()

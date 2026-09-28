from contextlib import asynccontextmanager
import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.core.database import initialize_database
from app.services.audit_job_worker import start_audit_worker_pool, stop_audit_worker_pool
from app.services.export_job_worker import run_export_worker


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    worker_pool = await start_audit_worker_pool(settings.audit_worker_count)
    from app.services.user_deletion_worker import run_cleanup
    cleanup_stop = asyncio.Event()
    cleanup_task = asyncio.create_task(run_cleanup(cleanup_stop))
    export_stop = asyncio.Event()
    export_task = asyncio.create_task(run_export_worker(export_stop))
    try:
        yield
    finally:
        cleanup_stop.set()
        export_stop.set()
        await export_task
        await cleanup_task
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

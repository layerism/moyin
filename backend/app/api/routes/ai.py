from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

router = APIRouter()


@router.post("/assist")
def ai_assist_placeholder() -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        content={"detail": "AI assistance is not implemented yet."},
    )

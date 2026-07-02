from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

router = APIRouter()


@router.post("/login")
def login_placeholder() -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        content={"detail": "Authentication is not implemented yet."},
    )

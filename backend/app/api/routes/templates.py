from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

router = APIRouter()


@router.post("")
def upload_template_placeholder() -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        content={"detail": "Template upload and extraction are not implemented yet."},
    )


@router.get("")
def list_templates_placeholder() -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        content={"detail": "Template listing is not implemented yet."},
    )

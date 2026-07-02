from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

router = APIRouter()


@router.post("")
def create_submission_placeholder() -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        content={"detail": "Submission creation is not implemented yet."},
    )


@router.get("/{submission_id}/download")
def download_document_placeholder(submission_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        content={
            "detail": "Document generation and download are not implemented yet.",
            "submission_id": submission_id,
        },
    )

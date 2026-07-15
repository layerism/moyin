from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.repositories.database_admin import (
    DatabaseAdminError,
    delete_admin_row,
    get_admin_table_schema,
    list_admin_rows,
    list_admin_tables,
    update_admin_row,
)
from app.services.security import get_current_super_admin


router = APIRouter(dependencies=[Depends(get_current_super_admin)])


class UpdateRowRequest(BaseModel):
    key: dict[str, Any]
    changes: dict[str, Any]
    reason: str = Field(min_length=1, max_length=300)


class DeleteRowRequest(BaseModel):
    key: dict[str, Any]
    reason: str = Field(min_length=1, max_length=300)


@router.get("/tables")
def tables() -> list[dict[str, object]]:
    return list_admin_tables()


@router.get("/tables/{table}/schema")
def table_schema(table: str) -> dict[str, object]:
    try:
        return get_admin_table_schema(table)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="数据表不存在") from exc


@router.get("/tables/{table}/rows")
def table_rows(
    table: str,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, object]:
    try:
        return list_admin_rows(table, limit, offset)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="数据表不存在") from exc


@router.patch("/tables/{table}/rows")
def patch_table_row(
    table: str,
    payload: UpdateRowRequest,
    admin: dict[str, object] = Depends(get_current_super_admin),
) -> dict[str, object]:
    try:
        return update_admin_row(
            table,
            payload.key,
            payload.changes,
            payload.reason,
            int(admin["id"]),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="数据表或记录不存在") from exc
    except DatabaseAdminError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/tables/{table}/rows")
def delete_table_row(
    table: str,
    payload: DeleteRowRequest,
    admin: dict[str, object] = Depends(get_current_super_admin),
) -> dict[str, object]:
    try:
        return delete_admin_row(
            table,
            payload.key,
            payload.reason,
            int(admin["id"]),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="数据表或记录不存在") from exc
    except DatabaseAdminError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.repositories.flow_roster import (
    RosterValidationError,
    import_roster,
    list_roster,
    revoke_roster_entry,
)
from app.services.security import get_current_teacher


router = APIRouter(dependencies=[Depends(get_current_teacher)])


class RosterEntryRequest(BaseModel):
    studentNo: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=64)


class ImportRosterRequest(BaseModel):
    entries: list[RosterEntryRequest] = Field(min_length=1, max_length=5000)
    sourceFileName: str = Field(min_length=1, max_length=255)


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="流程或名单记录不存在")


@router.get("/{flow_id}/roster")
def get_flow_roster(
    flow_id: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return list_roster(flow_id, int(teacher["id"]))
    except KeyError as exc:
        raise _not_found() from exc


@router.post("/{flow_id}/roster/import")
def import_flow_roster(
    flow_id: str,
    payload: ImportRosterRequest,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        entries: list[dict[str, Any]] = [entry.model_dump() for entry in payload.entries]
        return import_roster(
            flow_id,
            int(teacher["id"]),
            entries,
            payload.sourceFileName,
        )
    except KeyError as exc:
        raise _not_found() from exc
    except RosterValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/{flow_id}/roster/{entry_id}")
def delete_flow_roster_entry(
    flow_id: str,
    entry_id: int,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return revoke_roster_entry(flow_id, entry_id, int(teacher["id"]))
    except KeyError as exc:
        raise _not_found() from exc

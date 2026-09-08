from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.services.audit_model_connections import list_model_connections, update_model_connection
from app.services.security import get_current_super_admin

class ConnectionRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def safe_handler(request):
            try:
                return await handler(request)
            except RequestValidationError as exc:
                # Do not echo submitted credentials in validation responses.
                raise HTTPException(status_code=422, detail="配置格式无效，请检查地址、模型及密钥长度") from exc

        return safe_handler


router = APIRouter(dependencies=[Depends(get_current_super_admin)], route_class=ConnectionRoute)


class ConnectionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    apiUrl: str = Field(min_length=1, max_length=2048)
    apiKey: str | None = Field(default=None, max_length=4096)
    model: str = Field(default="", max_length=200)
    revision: int = Field(ge=0)

    @field_validator("apiUrl")
    @classmethod
    def validate_url(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        try:
            parsed = urlsplit(value)
            valid = parsed.scheme in {"http", "https"} and parsed.hostname and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment
            _ = parsed.port
        except ValueError:
            valid = False
        if not valid:
            raise ValueError("请输入不含账密、查询参数或片段的 HTTP(S) 接口地址")
        return value


@router.get("")
def get_connections() -> list[dict[str, object]]:
    return list_model_connections()


@router.put("/{provider}")
def put_connection(provider: Literal["document", "vision"], payload: ConnectionUpdate) -> dict[str, object]:
    model = payload.model.strip() if provider == "document" else ""
    if provider == "document" and not model:
        raise HTTPException(status_code=422, detail="请填写文档审核模型名称")
    try:
        return update_model_connection(provider, payload.apiUrl, payload.apiKey.strip() if payload.apiKey else None, model, payload.revision)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

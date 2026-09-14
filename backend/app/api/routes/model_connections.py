from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.services.audit_model_connections import (
    ModelConfigConflict, delete_model_card,
    list_model_connections, save_model_card,
)
from app.services.security import get_current_teacher

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


router = APIRouter(dependencies=[Depends(get_current_teacher)], route_class=ConnectionRoute)


def current_owner(teacher: dict = Depends(get_current_teacher)) -> int:
    return int(teacher["id"])


class BindingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cardId: str = Field(min_length=1, max_length=64)
    revision: int = Field(ge=0)


@router.put("/bindings/{script_id}")
def put_binding(script_id: str, payload: BindingUpdate, owner_id: int = Depends(current_owner)):
    from app.services.audit_model_connections import bind_publisher_model
    try:
        return bind_publisher_model(owner_id, script_id, payload.cardId, payload.revision)
    except ModelConfigConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class ThinkingConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["default", "off", "on"] = "default"
    effort: str = "default"
    budget: int | None = Field(default=None, ge=1, le=32768, strict=True)


class CardUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    thinking: ThinkingConfig
    vendor: Literal["openai", "deepseek", "qwen", "doubao", "zhipu", "moonshot", "custom"]
    name: str = Field(min_length=1, max_length=100)
    apiUrl: str = Field(min_length=1, max_length=2048)
    apiKey: str | None = Field(default=None, max_length=4096)
    billingAccessKey: str = Field(default="", max_length=256)
    billingSecretKey: str = Field(default="", max_length=4096)
    billingConsoleToken: str = Field(default="", max_length=8192)
    clearBilling: bool = False
    model: str = Field(min_length=1, max_length=200)
    revision: int = Field(default=0, ge=0)

    @field_validator("name", "model")
    @classmethod
    def non_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("名称不能为空")
        return value.strip()

    @field_validator("apiUrl")
    @classmethod
    def validate_url(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        try:
            parsed = urlsplit(value)
            valid = (parsed.scheme in {"http", "https"} and parsed.hostname
                     and parsed.username is None and parsed.password is None
                     and not parsed.query and not parsed.fragment
                     and not any(char.isspace() for char in value))
            _ = parsed.port
        except ValueError:
            valid = False
        if not valid:
            raise ValueError("请输入有效的 HTTP(S) Base URL")
        if parsed.path.endswith(("/chat/completions", "/responses", "/messages")):
            raise ValueError("只填写 Base URL，无需填写具体请求路径")
        return value


class ModelDiscovery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cardId: str | None = Field(default=None, max_length=64)
    revision: int = Field(default=0, ge=0)
    vendor: Literal["openai", "deepseek", "qwen", "doubao", "zhipu", "moonshot", "custom"]
    apiUrl: str = Field(min_length=1, max_length=2048)
    apiKey: str = Field(default="", max_length=4096)

    @field_validator("apiUrl")
    @classmethod
    def validate_url(cls, value: str) -> str:
        return CardUpdate.validate_url(value)


@router.post("/models")
def get_available_models(payload: ModelDiscovery, owner_id: int = Depends(current_owner)):
    from fastapi.responses import JSONResponse
    from app.services.audit_model_connections import discover_models
    try:
        models = discover_models(payload.cardId, payload.revision, payload.vendor, payload.apiUrl, payload.apiKey, owner_id)
    except ModelConfigConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return JSONResponse({"models": models}, headers={"Cache-Control": "no-store"})


def _save(card_id: str | None, payload: CardUpdate, owner_id: int) -> dict[str, object]:
    try:
        save_model_card(card_id, owner_id=owner_id, vendor=payload.vendor, name=payload.name,
                        api_url=payload.apiUrl, api_key=payload.apiKey.strip() if payload.apiKey else None,
                        model=payload.model, revision=payload.revision, thinking=payload.thinking.model_dump(),
                        billing_access_key=payload.billingAccessKey.strip(),
                        billing_secret_key=payload.billingSecretKey.strip(),
                        billing_console_token=payload.billingConsoleToken.strip(), clear_billing=payload.clearBilling)
    except ModelConfigConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return list_model_connections(owner_id)


@router.get("")
def get_connections(owner_id: int = Depends(current_owner)) -> dict[str, object]:
    return list_model_connections(owner_id)


@router.post("/cards")
def create_card(payload: CardUpdate, owner_id: int = Depends(current_owner)) -> dict[str, object]:
    return _save(None, payload, owner_id)


@router.put("/cards/{card_id}")
def put_card(card_id: str, payload: CardUpdate, owner_id: int = Depends(current_owner)) -> dict[str, object]:
    return _save(card_id, payload, owner_id)


@router.delete("/cards/{card_id}")
def remove_card(card_id: str, revision: int = Query(ge=0), owner_id: int = Depends(current_owner)) -> dict[str, object]:
    try:
        delete_model_card(card_id, revision, owner_id)
    except ModelConfigConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return list_model_connections(owner_id)


@router.get("/thinking-profile")
def get_thinking_profile(vendor: str = Query(max_length=30), model: str = Query(max_length=200)) -> dict[str, object]:
    from app.services.model_thinking import thinking_profile
    return thinking_profile(vendor, model)


@router.get("/cards/{card_id}/balance")
def get_card_balance(card_id: str, revision: int = Query(ge=0), owner_id: int = Depends(current_owner)):
    from fastapi.responses import JSONResponse
    from app.services.audit_model_connections import query_model_balance
    try:
        result = query_model_balance(card_id, revision, owner_id)
    except ModelConfigConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


@router.post("/cards/{card_id}/test")
def test_card_connection(card_id: str, revision: int = Query(ge=0), owner_id: int = Depends(current_owner)):
    from fastapi.responses import JSONResponse
    from app.services.audit_model_connections import test_model_connection
    try:
        result = test_model_connection(card_id, revision, owner_id)
    except ModelConfigConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return JSONResponse(result, headers={"Cache-Control": "no-store"})

"""Alibaba PNVS adapter. Never expose vendor exceptions or verification codes."""
import json

from alibabacloud_dypnsapi20170525.client import Client
from alibabacloud_dypnsapi20170525 import models
from alibabacloud_tea_openapi.models import Config
from alibabacloud_tea_util.models import RuntimeOptions
from fastapi import HTTPException

from app.core.config import settings


def client() -> Client:
    if not all((settings.aliyun_pnvs_access_key_id, settings.aliyun_pnvs_access_key_secret,
                settings.aliyun_pnvs_sign_name, settings.aliyun_pnvs_template_code)):
        raise HTTPException(503, "短信认证尚未配置，请联系管理员")
    return Client(Config(access_key_id=settings.aliyun_pnvs_access_key_id,
                         access_key_secret=settings.aliyun_pnvs_access_key_secret,
                         endpoint="dypnsapi.aliyuncs.com"))


def send(phone: str, scheme: str, challenge_id: str) -> None:
    sdk = client()
    try:
        result = sdk.send_sms_verify_code_with_options(models.SendSmsVerifyCodeRequest(
            phone_number=phone, country_code="86", scheme_name=scheme, out_id=challenge_id,
            sign_name=settings.aliyun_pnvs_sign_name,
            template_code=settings.aliyun_pnvs_template_code,
            template_param=json.dumps({"code": "##code##", "min": "5"}),
            code_length=6, code_type=1, valid_time=300, interval=60,
            duplicate_policy=1, return_verify_code=False,
        ), RuntimeOptions(connect_timeout=5000, read_timeout=10000, autoretry=False)).body
    except Exception:
        raise HTTPException(503, "短信暂时无法发送，请稍后重试") from None
    if not result or result.code != "OK" or not result.success:
        raise HTTPException(503, "短信发送未成功，请稍后重试")


def check(phone: str, scheme: str, challenge_id: str, code: str) -> bool:
    sdk = client()
    try:
        result = sdk.check_sms_verify_code_with_options(models.CheckSmsVerifyCodeRequest(
            phone_number=phone, country_code="86", scheme_name=scheme,
            out_id=challenge_id, verify_code=code,
        ), RuntimeOptions(connect_timeout=5000, read_timeout=10000, autoretry=False)).body
    except Exception:
        raise HTTPException(503, "短信核验暂时不可用，请稍后重试") from None
    return bool(result and result.code == "OK" and result.success and result.model
                and result.model.verify_result == "PASS" and result.model.out_id == challenge_id)

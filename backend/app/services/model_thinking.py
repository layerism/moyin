"""Verified Chat Completions reasoning profiles; unknown models send no extensions."""
import re


def thinking_profile(vendor: str, model: str) -> dict[str, object]:
    model = model.strip().lower()
    profile = {"id": "unknown", "modes": ["default"], "efforts": [], "budgetSupported": False,
               "note": "此型号尚未适配思考设置，使用接口默认行为，不发送思考参数。"}
    def matched(pattern: str) -> bool:
        return re.fullmatch(pattern, model) is not None
    if vendor == "openai":
        if matched(r"gpt-5(?:-mini|-nano)?(?:-\d{4}-\d{2}-\d{2})?"):
            profile.update(id="openai-effort", modes=["default", "on"], efforts=["minimal", "low", "medium", "high"])
        elif matched(r"gpt-5\.1(?:-\d{4}-\d{2}-\d{2})?"):
            profile.update(id="openai-effort", modes=["default", "off", "on"], efforts=["low", "medium", "high"])
        elif matched(r"gpt-5\.(?:2|4)(?:-\d{4}-\d{2}-\d{2})?"):
            profile.update(id="openai-effort", modes=["default", "off", "on"], efforts=["low", "medium", "high", "xhigh"])
        elif matched(r"(?:o3|o3-mini|o4-mini)(?:-\d{4}-\d{2}-\d{2})?"):
            profile.update(id="openai-effort", modes=["default", "on"], efforts=["low", "medium", "high"])
    elif vendor == "deepseek" and matched(r"deepseek-v4-(?:flash|pro)(?:-vision-exp)?"):
        profile.update(id="deepseek", modes=["default", "off", "on"], efforts=["low", "high", "max"])
    elif vendor == "doubao":
        if model in {"doubao-seed-2-1-pro-260628", "doubao-seed-2-1-turbo-260628", "doubao-seed-evolving"}:
            profile.update(id="doubao", modes=["default", "off", "on"], efforts=["low", "medium", "high"])
        elif model in {"doubao-seed-1-8-251228", "doubao-seed-1-6-251015"}:
            profile.update(id="toggle", modes=["default", "off", "on"])
    elif vendor == "qwen" and (model in {"qwen-plus", "qwen-plus-latest", "qwen-flash", "qwen-turbo", "qwen3-max"}
                               or model in {"qwen3.5-plus", "qwen3.5-flash", "qwen3.6-plus", "qwen3.6-flash", "qwen3.7-max", "qwen3.7-plus", "qwen3.7-flash", "qwen3.8-max", "qwen3.8-flash"}):
        profile.update(id="qwen-budget", modes=["default", "off", "on"], budgetSupported=True)
    elif vendor == "zhipu":
        if model == "glm-5.2":
            profile.update(id="glm-effort", modes=["default", "off", "on"], efforts=["high", "max"])
        elif model in {"glm-5", "glm-5.1", "glm-5-turbo", "glm-5v-turbo", "glm-4.7", "glm-4.7-flash", "glm-4.7-flashx", "glm-4.6", "glm-4.6v", "glm-4.5", "glm-4.5-air", "glm-4.5v"}:
            profile.update(id="toggle", modes=["default", "off", "on"])
    elif vendor == "moonshot" and model in {"kimi-k2.5", "kimi-k2.6"}:
        profile.update(id="kimi", modes=["default", "off", "on"])
    if profile["id"] != "unknown":
        profile["note"] = "按提供商及当前型号适配；接口默认表示不指定思考参数。"
        if profile["id"] == "openai-effort":
            profile["note"] = "思考模式使用接口默认温度；不支持关闭的型号只提供默认和开启。"
        elif profile["id"] == "qwen-budget":
            profile["note"] = "预算是思考 Token 上限；本站支持 1–32768，留空使用模型默认预算。"
        elif profile["id"] == "kimi":
            profile["note"] = "该型号不提供思考档位，温度由接口按思考模式自动确定。"
    return profile


def validate_thinking(vendor: str, model: str, value: dict[str, object]) -> dict[str, object]:
    profile = thinking_profile(vendor, model)
    mode, effort, budget = value.get("mode", "default"), value.get("effort", "default"), value.get("budget")
    if mode not in profile["modes"]:
        raise ValueError("该模型不支持所选思考模式")
    if effort != "default" and (mode != "on" or effort not in profile["efforts"]):
        raise ValueError("该模型不支持所选思考档位")
    if budget is not None and (mode != "on" or not profile["budgetSupported"] or type(budget) is not int or not 1 <= budget <= 32768):
        raise ValueError("该模型不支持此思考预算")
    return {"mode": mode, "effort": effort, "budget": budget}


def request_thinking_options(vendor: str, model: str, value: dict[str, object]) -> dict[str, object]:
    value = validate_thinking(vendor, model, value)
    profile = thinking_profile(vendor, model)
    kind, mode, effort = profile["id"], value["mode"], value["effort"]
    body: dict[str, object] = {}
    omit_temperature = False
    if kind == "openai-effort":
        if mode == "off":
            body["reasoning_effort"] = "none"
        elif mode == "on":
            body["reasoning_effort"] = "medium" if effort == "default" else effort
        # Omitting temperature is accepted in both reasoning and non-reasoning modes.
        omit_temperature = True
    elif kind == "qwen-budget":
        if mode != "default":
            body["enable_thinking"] = mode == "on"
        if value["budget"] is not None:
            body["thinking_budget"] = value["budget"]
    elif kind in {"deepseek", "doubao", "glm-effort", "toggle", "kimi"}:
        if mode != "default":
            body["thinking"] = {"type": "enabled" if mode == "on" else "disabled"}
        if mode == "on" and effort != "default":
            body["reasoning_effort"] = effort
        omit_temperature = kind == "kimi" or (kind == "deepseek" and mode != "off")
    return {"body": body, "omitTemperature": omit_temperature}

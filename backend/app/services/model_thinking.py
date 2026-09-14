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
    elif vendor == "deepseek" and (model == "deepseek-flash" or matched(r"deepseek-v4-(?:flash|pro)(?:-vision-exp)?")):
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
        if model in {"glm-5.3", "glm-5.3-flash"}:
            profile.update(id="glm-effort", modes=["default", "on"], efforts=["low", "high", "max"])
        elif model == "glm-5.2":
            profile.update(id="glm-effort", modes=["default", "off", "on"], efforts=["high", "max"])
        elif model in {"glm-5", "glm-5.1", "glm-5-turbo", "glm-5v-turbo", "glm-4.7", "glm-4.7-flash", "glm-4.7-flashx", "glm-4.6", "glm-4.6v", "glm-4.5", "glm-4.5-air", "glm-4.5v"}:
            profile.update(id="toggle", modes=["default", "off", "on"])
    elif vendor == "moonshot" and model in {"kimi-k2.5", "kimi-k2.6"}:
        profile.update(id="kimi", modes=["default", "off", "on"])
    if profile["id"] != "unknown":
        profile["note"] = "按提供商及当前型号适配；接口默认表示不指定思考参数。"
        if profile["id"] == "qwen-budget":
            profile["note"] = "预算是思考 Token 上限；本站支持 1–32768，留空使用模型默认预算。"
    # Labels belong to the provider profile, shared by the editor and card summary.
    profile["modeLabels"] = {"default": "接口默认", "off": "关闭思考", "on": "开启思考"}
    profile["effortLabels"] = {effort: effort for effort in profile["efforts"]}
    profile["defaultEffortLabel"] = "厂商默认（不指定强度）"
    if profile["id"] == "openai-effort":
        labels = {"minimal": "极低推理", "low": "低推理", "medium": "中等推理", "high": "高推理", "xhigh": "超高推理"}
        profile["effortLabels"] = {effort: f"{labels[effort]}（{effort}）" for effort in profile["efforts"]}
        profile["defaultEffortLabel"] = "开启默认（medium）"
        profile["note"] = "接口默认不指定推理强度；选择开启默认时发送 medium，明确关闭时发送 none。仅显示该型号支持的选项。"
    elif profile["id"] == "glm-effort":
        labels = {"low": "轻量思考", "high": "增强思考", "max": "深度思考"}
        profile["effortLabels"] = {effort: f"{labels[effort]}（{effort}）" for effort in profile["efforts"]}
        profile["defaultEffortLabel"] = "厂商默认：深度思考（max）"
        profile["note"] = ("默认深度思考；该型号必须开启思考。" if model != "glm-5.2" else "默认深度思考；low/medium 实际映射为 high，xhigh 映射为 max，不作为独立档位。")
    elif profile["id"] == "deepseek":
        profile["defaultEffortLabel"] = "厂商默认：high"
        profile["note"] = "默认开启思考，强度为 high；low/high/max 为实际档位，兼容值 medium/xhigh 不代表独立档位。"
    elif vendor == "doubao" and profile["id"] != "unknown":
        profile["note"] = "当前保留已有型号适配，具体强度能力尚待官方文档核实；可选择接口默认。"
    elif profile["id"] == "qwen-budget":
        profile["defaultEffortLabel"] = "模型默认预算"
    elif profile["id"] == "kimi":
        profile["note"] = "支持开启或关闭思考，不提供强度档位；接口默认由厂商决定。"
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

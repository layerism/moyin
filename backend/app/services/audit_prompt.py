"""Render backend-owned audit message templates with configurable principles."""
import json
from pathlib import Path

from jinja2 import Environment, StrictUndefined


def render_audit_messages(entry_path: str, user: object, system: str) -> list[dict]:
    template_path = Path(entry_path).with_name("prompt.jinja")
    environment = Environment(undefined=StrictUndefined, autoescape=False)
    template = environment.from_string(template_path.read_text(encoding="utf-8"))
    return json.loads(template.render(user=user, system=system))

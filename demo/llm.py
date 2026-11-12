"""Lớp gọi LLM dùng chung, trả về dict theo JSON schema.

Backend chọn qua biến môi trường LLM_BACKEND:
- claude-cli (mặc định): gọi `claude -p` trên máy, dùng tài khoản Claude đã login, không cần API key.
- api: gọi Anthropic API bằng ANTHROPIC_API_KEY (tính tiền theo token).
"""
import json
import os
import subprocess
import time

BACKEND = os.environ.get("LLM_BACKEND", "claude-cli")
DEFAULT_MODEL = os.environ.get("LLM_MODEL", "sonnet")
# Prompt viết bằng tiếng Anh; chỉ phần chữ tự do trong kết quả được viết theo ngôn ngữ này.
OUTPUT_LANG = os.environ.get("LLM_OUTPUT_LANG", "Vietnamese")


class LLMError(RuntimeError):
    pass


def call(system: str, user: str, schema: dict, model: str = DEFAULT_MODEL) -> tuple[dict, dict]:
    """Trả về (kết quả theo schema, meta gồm cost_usd và duration_s)."""
    for attempt in range(2):
        try:
            return _call_cli(system, user, schema, model) if BACKEND == "claude-cli" else _call_api(system, user, schema, model)
        except LLMError:
            if attempt == 1:
                raise
            time.sleep(3)


def _call_cli(system, user, schema, model):
    # Bỏ ANTHROPIC_API_KEY để CLI dùng tài khoản đã login thay vì key.
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    cmd = ["claude", "-p", "--system-prompt", system, "--tools", "", "--output-format", "json",
           "--json-schema", json.dumps(schema), "--model", model, "--no-session-persistence"]
    t0 = time.time()
    proc = subprocess.run(cmd, input=user, capture_output=True, text=True, env=env, timeout=600)
    try:
        out = json.loads(proc.stdout)
    except json.JSONDecodeError:
        raise LLMError(f"CLI không trả JSON: {proc.stderr[-500:] or proc.stdout[-500:]}")
    if out.get("is_error") or "structured_output" not in out:
        raise LLMError(f"CLI lỗi: {out.get('result')}")
    return out["structured_output"], {"cost_usd": out.get("total_cost_usd", 0), "duration_s": round(time.time() - t0, 1)}


def _call_api(system, user, schema, model):
    import anthropic
    t0 = time.time()
    tool = {"name": "submit", "description": "Submit the result", "input_schema": schema}
    try:
        resp = anthropic.Anthropic().messages.create(
            model="claude-sonnet-5-5" if model == "sonnet" else model, max_tokens=8192, system=system,
            tools=[tool], tool_choice={"type": "tool", "name": "submit"},
            messages=[{"role": "user", "content": user}])
    except anthropic.APIError as e:
        raise LLMError(str(e))
    data = next(b.input for b in resp.content if b.type == "tool_use")
    return data, {"cost_usd": None, "duration_s": round(time.time() - t0, 1)}

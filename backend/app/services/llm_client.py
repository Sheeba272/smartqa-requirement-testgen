"""
Unified LLM client — routes calls to the correct model per agent:
  Agent 1 (validation/enhancement) → qwen3:8b
  Agent 2 (test case generation)   → deepseek-r1:8b
  Embeddings                        → nomic-embed-text

All three are confirmed installed (ollama list shows them).
DeepSeek-R1 strips <think>...</think> blocks before JSON parsing.
"""
import json
import re
import logging
import asyncio
from typing import Optional
from app.core.config import settings

logger = logging.getLogger(__name__)

# Runtime cache: list of full model tags from `ollama list`  e.g. ["qwen3:8b", "deepseek-r1:8b"]
_installed_models_cache: Optional[list] = None


def _repair_json(text: str) -> str:
    """Fix common LLM JSON mistakes: trailing commas, single quotes on keys."""
    # Remove trailing commas before } or ]
    text = re.sub(r",(\s*[}\]])", r"\1", text)
    # Fix Python-style single-quoted keys/strings (rare but happens with some models)
    # Only do this if double quotes are clearly absent (avoid breaking apostrophes in text)
    if text.count('"') < text.count("'") / 2:
        text = re.sub(r"'([^']*)'(\s*:)", r'"\1"\2', text)  # keys
    return text


def extract_json(text: str) -> dict | list:
    """Extract JSON — strips DeepSeek <think> blocks, markdown fences, and repairs common mistakes."""
    if not text:
        return {}
    # Strip DeepSeek-R1 chain-of-thought block (can be several KB)
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    # Strip markdown fences
    text = re.sub(r"```(?:json)?", "", text).strip().strip("`").strip()
    # Direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Try with repair
    try:
        return json.loads(_repair_json(text))
    except json.JSONDecodeError:
        pass
    # Find first {...} or [...]
    for pattern in (r"\{.*\}", r"\[.*\]"):
        m = re.search(pattern, text, re.DOTALL)
        if m:
            candidate = m.group()
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                pass
            try:
                return json.loads(_repair_json(candidate))
            except json.JSONDecodeError:
                pass
    logger.warning(f"Could not extract JSON after repair attempts. First 400 chars: {text[:400]}")
    return {}


class LLMResponse:
    def __init__(self, content: str, prompt_tokens: int = 0,
                 completion_tokens: int = 0, total_tokens: int = 0,
                 model: str = "", latency_ms: int = 0):
        self.content = content
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.total_tokens = total_tokens
        self.model = model
        self.latency_ms = latency_ms


async def _get_installed_models() -> list:
    """Return full model tags installed in Ollama e.g. ['qwen3:8b', 'deepseek-r1:8b']."""
    global _installed_models_cache
    if _installed_models_cache is not None:
        return _installed_models_cache
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as c:
            r = await c.get(f"{settings.OLLAMA_BASE_URL}/api/tags")
            if r.status_code == 200:
                models = r.json().get("models", [])
                # Return full tags e.g. "qwen3:8b" not just "qwen3"
                _installed_models_cache = [m["name"] for m in models]
                logger.info(f"Ollama installed models: {_installed_models_cache}")
                return _installed_models_cache
    except Exception as e:
        logger.warning(f"Could not query Ollama model list: {e}")
    _installed_models_cache = []
    return []


async def _resolve_model(preferred: str) -> str:
    """
    Return `preferred` if it's installed, otherwise fall back to the
    best available model from the installed list.
    """
    installed = await _get_installed_models()
    if not installed:
        logger.warning(f"No installed models found — using '{preferred}' directly")
        return preferred

    # Exact tag match  e.g. "qwen3:8b" in ["qwen3:8b", "deepseek-r1:8b"]
    if preferred in installed:
        return preferred

    # Base name match  e.g. "qwen3" matches "qwen3:8b"
    pref_base = preferred.split(":")[0].lower()
    for tag in installed:
        if tag.split(":")[0].lower() == pref_base:
            logger.info(f"Model '{preferred}' → using installed tag '{tag}'")
            return tag

    # Fallback priority — pick the best available model
    fallback_priority = ["qwen3", "qwen2.5", "deepseek-r1", "qwen2", "mistral", "llama3", "phi3"]
    for fb in fallback_priority:
        for tag in installed:
            if tag.split(":")[0].lower().startswith(fb):
                logger.warning(f"Model '{preferred}' not installed — falling back to '{tag}'")
                return tag

    # Last resort
    logger.warning(f"Model '{preferred}' not installed — using first available: '{installed[0]}'")
    return installed[0]


async def call_llm(system: str, user: str, temperature: float = 0.0,
                   timeout: float = 240.0, agent: str = "agent1") -> LLMResponse:
    """
    Call the LLM for the given agent.
    Agent 1 → qwen3:8b  (deterministic, temperature=0)
    Agent 2 → deepseek-r1:8b  (slight creativity, temperature=0.2)
    CPU hardware: timeouts of 240-300s are normal for 8B models.
    """
    import time

    # Anthropic override (only if valid paid key)
    if (settings.LLM_PROVIDER or "").lower() == "anthropic" and \
       settings.ANTHROPIC_API_KEY and \
       len(settings.ANTHROPIC_API_KEY) > 20 and \
       not settings.ANTHROPIC_API_KEY.startswith("your-"):
        return await _call_anthropic(system, user, temperature, min(timeout, 60.0))

    # Resolve the right model for this agent
    preferred = (settings.OLLAMA_MODEL_AGENT2
                 if agent == "agent2" else
                 settings.OLLAMA_MODEL_AGENT1)
    model = await _resolve_model(preferred)

    t0 = time.monotonic()
    resp = await _call_ollama(system, user, temperature, timeout, model)
    resp.latency_ms = int((time.monotonic() - t0) * 1000)
    resp.model = model
    return resp


async def _call_ollama(system: str, user: str, temperature: float,
                       timeout: float, model: str) -> LLMResponse:
    from app.services.ollama_client import get_chat_client
    client = get_chat_client()
    response = await asyncio.wait_for(
        client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
            temperature=temperature,
        ),
        timeout=timeout,
    )
    content = response.choices[0].message.content or ""
    usage = getattr(response, "usage", None)
    pt = getattr(usage, "prompt_tokens", 0) or 0
    ct = getattr(usage, "completion_tokens", 0) or 0
    logger.info(f"Ollama [{model}] {pt}+{ct}={pt+ct} tokens")
    return LLMResponse(content, pt, ct, pt + ct, model)


async def _call_anthropic(system: str, user: str, temperature: float,
                          timeout: float) -> LLMResponse:
    import httpx
    headers = {
        "x-api-key": settings.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    body = {
        "model": settings.ANTHROPIC_MODEL,
        "max_tokens": 4096,
        "temperature": temperature,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post("https://api.anthropic.com/v1/messages",
                                 headers=headers, json=body)
        if resp.status_code != 200:
            raise RuntimeError(f"Anthropic API {resp.status_code}: {resp.text[:200]}")
        data = resp.json()
        content = data["content"][0]["text"] if data.get("content") else ""
        usage = data.get("usage", {})
        pt = usage.get("input_tokens", 0)
        ct = usage.get("output_tokens", 0)
        return LLMResponse(content, pt, ct, pt + ct, settings.ANTHROPIC_MODEL)


async def check_llm_status() -> dict:
    """Status dict for /system/ollama-status — used by both frontend agents."""
    from app.services.ollama_client import check_model_available
    jira_ok = bool(settings.JIRA_BASE_URL and settings.JIRA_EMAIL and settings.JIRA_API_TOKEN)

    # Resolve actual tags
    actual_a1 = await _resolve_model(settings.OLLAMA_MODEL_AGENT1)
    actual_a2 = await _resolve_model(settings.OLLAMA_MODEL_AGENT2)
    installed  = await _get_installed_models()

    a1_ok   = actual_a1 in installed
    a2_ok   = actual_a2 in installed
    emb_chk = await check_model_available(settings.OLLAMA_EMBED_MODEL)
    ollama_running = emb_chk["ollama_running"] or bool(installed)

    errors = []
    if not a1_ok:
        errors.append(f"Run: ollama pull {settings.OLLAMA_MODEL_AGENT1}")
    if not a2_ok:
        errors.append(f"Run: ollama pull {settings.OLLAMA_MODEL_AGENT2}")
    if not emb_chk["model_pulled"]:
        errors.append(f"Run: ollama pull {settings.OLLAMA_EMBED_MODEL}")

    return {
        "provider":           "ollama",
        "model":              actual_a1,
        "agent1_model":       actual_a1,
        "agent2_model":       actual_a2,
        "configured":         ollama_running and a1_ok and a2_ok,
        "ollama_running":     ollama_running,
        "chat_model_pulled":  a1_ok,
        "agent2_model_pulled": a2_ok,
        "embed_model_pulled": emb_chk["model_pulled"],
        "available_models":   installed,
        "base_url":           settings.OLLAMA_BASE_URL,
        "error":              " | ".join(errors) if errors else None,
        "jira_configured":    jira_ok,
        "jira_base_url":      settings.JIRA_BASE_URL or "",
    }

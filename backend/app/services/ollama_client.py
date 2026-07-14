"""
Shared Ollama client utilities.
Uses the OpenAI-compatible /v1 endpoint that Ollama exposes,
so we can keep the same openai-python SDK calls everywhere.
"""
import httpx
import json
import logging
from typing import List, Dict, Any, Optional
from openai import AsyncOpenAI
from app.core.config import settings

logger = logging.getLogger(__name__)

# ── Chat client (OpenAI-compatible Ollama endpoint) ──────────────────────────
def get_chat_client() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key="ollama",                          # Ollama ignores the key value
        base_url=f"{settings.OLLAMA_BASE_URL}/v1",
        # Timeout raised from 220s to 360s so the httpx client never fires
        # before our asyncio.wait_for() timeouts in agent1/agent2 (240-300s).
        # On CPU hardware qwen3:8b needs up to 3min for complex generations.
        timeout=360.0,
        # Default SDK retry behavior (max_retries=2) means a single failing
        # request can silently retry for minutes before our own fallback
        # logic ever runs. Disabling SDK-level retries means a failure
        # (e.g. model not pulled, Ollama not running) surfaces in seconds,
        # and our own try/except in agent1_validation.py / agent2_generation.py
        # handles the fallback — no need for two layers of retry logic.
        max_retries=0,
    )


# ── Model availability check ─────────────────────────────────────────────
# Ollama returns a 404 if the requested model hasn't been pulled, which the
# OpenAI SDK surfaces as a generic connection/API error — hard to tell apart
# from "Ollama isn't running at all". Checking /api/tags directly gives a
# clear, fast, specific answer instead.
async def check_model_available(model_name: str) -> Dict[str, Any]:
    """Returns {"ollama_running": bool, "model_pulled": bool, "available_models": [...], "error": str|None}"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{settings.OLLAMA_BASE_URL}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            models = [m.get("name", "") for m in data.get("models", [])]
            # Ollama model names can include a tag (e.g. "llama3.1:latest") —
            # match on the base name before ":" too.
            base_names = [m.split(":")[0] for m in models]
            pulled = model_name in models or model_name in base_names
            return {"ollama_running": True, "model_pulled": pulled, "available_models": models, "error": None,
                    "base_url": settings.OLLAMA_BASE_URL}
    except Exception as e:
        # Surface the real exception type + message — "Ollama not reachable"
        # alone hides whether this was a timeout, connection refusal, DNS
        # failure, etc., making it impossible to diagnose remotely.
        error_detail = f"{type(e).__name__}: {e}"
        logger.warning(f"Ollama not reachable for model check: {error_detail}")
        return {"ollama_running": False, "model_pulled": False, "available_models": [], "error": error_detail,
                "base_url": settings.OLLAMA_BASE_URL}


# ── Embedding via Ollama REST API (/api/embeddings) ──────────────────────────
# Note: Ollama's embedding endpoint is NOT on the /v1 path, so we call it
# directly with httpx. Falls back to a deterministic hash-based vector if
# Ollama is unreachable (so the app still works offline / during first boot).

EMBED_DIM = 768   # nomic-embed-text output dimension


async def get_embedding(text: str) -> List[float]:
    """Return a vector embedding for `text` using Ollama nomic-embed-text.
    For callers that need to know whether a REAL embedding was used (vs.
    the hash fallback), use get_embedding_with_status() instead — this
    function is kept for simple callers that don't need that distinction."""
    vec, _ = await get_embedding_with_status(text)
    return vec


async def get_embedding_with_status(text: str) -> tuple[List[float], bool]:
    """
    Same as get_embedding, but also returns whether a REAL Ollama embedding
    was used (True) vs. the deterministic hash fallback (False). This
    matters because the hash fallback produces effectively random vectors
    with no real semantic relationship between similar texts — silently
    using it for similarity search produces misleadingly precise-looking
    results like "0% match" between two nearly-identical requirements, when
    the real problem is that the embedding model isn't reachable/pulled,
    not that the texts are actually unrelated.
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{settings.OLLAMA_BASE_URL}/api/embeddings",
                json={"model": settings.OLLAMA_EMBED_MODEL, "prompt": text[:4000]},
            )
            resp.raise_for_status()
            data = resp.json()
            return data["embedding"], True
    except Exception as e:
        logger.warning(f"Ollama embedding failed ({e}) — using hash fallback")
        return _hash_embedding(text), False


def _hash_embedding(text: str) -> List[float]:
    """Deterministic fallback embedding — keeps ChromaDB functional when
    Ollama is not yet running (e.g. first docker compose up)."""
    import hashlib
    seed = int(hashlib.md5(text.encode()).hexdigest(), 16)
    import random
    rng = random.Random(seed)
    vec = [rng.gauss(0, 1) for _ in range(EMBED_DIM)]
    norm = sum(x ** 2 for x in vec) ** 0.5 or 1.0
    return [x / norm for x in vec]


# ── JSON extraction helper ────────────────────────────────────────────────────
# Llama / Mistral sometimes wrap JSON in markdown fences even when asked not to.
def extract_json(raw: str) -> Any:
    raw = raw.strip()
    # strip ```json ... ``` or ``` ... ```
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    # find the first { or [ and the matching last } or ]
    for start_char, end_char in [('{', '}'), ('[', ']')]:
        s = raw.find(start_char)
        e = raw.rfind(end_char)
        if s != -1 and e != -1 and e > s:
            try:
                return json.loads(raw[s:e+1])
            except json.JSONDecodeError:
                pass
    raise ValueError(f"Could not extract JSON from: {raw[:200]}")

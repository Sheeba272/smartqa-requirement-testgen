from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.core.config import settings
from app.db.database import init_db
from app.api.routes import router
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def _warmup_model(client, model: str) -> None:
    try:
        logger.info(f"Warming up Ollama model '{model}'...")
        await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=3,
            temperature=0,
        )
        logger.info(f"[OK] Model '{model}' warmed up.")
    except Exception as e:
        logger.warning(f"Warm-up skipped for '{model}': {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("SmartQA starting — initialising database tables...")
    await init_db()
    logger.info("Database ready.")

    provider = (settings.LLM_PROVIDER or "ollama").lower()
    if provider == "ollama":
        try:
            from app.services.ollama_client import get_chat_client
            from app.services.llm_client import _resolve_model, _get_installed_models
            import asyncio

            # Clear cache so we get a fresh model list on restart
            import app.services.llm_client as _lc
            _lc._installed_models_cache = None
            installed = await _get_installed_models()
            if installed:
                logger.info(f"Installed Ollama models: {installed}")
            else:
                logger.warning("No Ollama models found. Run: ollama pull deepseek-r1:8b")

            # Resolve actual models (falls back if preferred not installed)
            a1 = await _resolve_model(settings.OLLAMA_MODEL_AGENT1)
            a2 = await _resolve_model(settings.OLLAMA_MODEL_AGENT2)

            client = get_chat_client()
            if a1 == a2:
                await _warmup_model(client, a1)
            else:
                await asyncio.gather(
                    _warmup_model(client, a1),
                    _warmup_model(client, a2),
                    return_exceptions=True,
                )
            logger.info(f"Agent 1: {a1} | Agent 2: {a2}")
        except Exception as e:
            logger.warning(f"Ollama warm-up error: {e}")
    else:
        logger.info(f"LLM_PROVIDER={provider} — skipping Ollama warm-up.")

    yield
    logger.info("SmartQA shutting down.")


app = FastAPI(
    title="SmartQA Agent API",
    description="Agent 1 (Qwen2.5:7b — Validation) + Agent 2 (Qwen2.5:7b — Test Case Generation)",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "SmartQA Agent API",
        "agent1_model": settings.OLLAMA_MODEL_AGENT1,
        "agent2_model": settings.OLLAMA_MODEL_AGENT2,
    }

from pydantic_settings import BaseSettings
from typing import List
import json


class Settings(BaseSettings):
    # ── LLM Provider ─────────────────────────────────────────
    # "ollama" = free open-source models (recommended for POC)
    # "anthropic" = Claude API (requires paid credits)
    LLM_PROVIDER: str = "ollama"

    # ── Per-agent Ollama models ───────────────────────────────
    # Agent 1: Qwen3:8b — excellent structured reasoning & JSON
    OLLAMA_MODEL_AGENT1: str = "qwen3:8b"
    # Agent 2: DeepSeek-R1:8b — strong chain-of-thought for test generation
    OLLAMA_MODEL_AGENT2: str = "deepseek-r1:8b"
    # Embeddings: nomic-embed-text — fast, local, free
    OLLAMA_EMBED_MODEL: str = "nomic-embed-text"

    # Fallback single-model (used if per-agent models not set)
    OLLAMA_BASE_URL: str = "http://127.0.0.1:11434"
    OLLAMA_MODEL: str = "qwen3:8b"

    # ── Anthropic (disabled by default — requires paid credits) ──
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-haiku-4-5"

    # ── Azure OpenAI (not currently used — client AVD approval pending) ──
    # Present here so the .env file can keep these keys without crashing
    # the app; switch LLM_PROVIDER to "azure_openai" once approved and a
    # corresponding client is wired up in llm_client.py.
    AZURE_OPENAI_ENDPOINT: str = ""
    AZURE_OPENAI_API_KEY: str = ""
    AZURE_OPENAI_DEPLOYMENT: str = ""
    AZURE_OPENAI_API_VERSION: str = ""

    # ── Database (SQLite default, PostgreSQL optional) ────────
    DATABASE_URL: str = "sqlite+aiosqlite:///./smartqa.db"

    # ── ChromaDB (in-process persistent) ─────────────────────
    CHROMA_HOST: str = "localhost"          # unused in in-process mode
    CHROMA_PORT: int = 8000                 # unused in in-process mode
    CHROMA_COLLECTION_REQUIREMENTS: str = "smartqa_requirements"
    CHROMA_COLLECTION_TESTCASES: str = "smartqa_testcases"
    # Reference corpus — BRD/Word/Confluence uploads used purely as RAG
    # context for Agent 1 (never validated themselves)
    CHROMA_COLLECTION_KNOWLEDGE: str = "smartqa_knowledge"
    # Where ChromaDB stores its persistent data on disk. Leave blank to use
    # the default <project_root>/chroma_data. Set this if you want to move
    # the vector store to a different drive/folder (e.g. when migrating to
    # client AVD, or pointing multiple installs at a shared knowledge base).
    CHROMA_DATA_DIR: str = ""

    # ── App ───────────────────────────────────────────────────
    SECRET_KEY: str = "changeme-secret-key-32chars-min!!"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    CORS_ORIGINS: str = '["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"]'

    # ── JIRA (optional) ───────────────────────────────────────
    JIRA_BASE_URL: str = ""
    JIRA_EMAIL: str = ""
    JIRA_API_TOKEN: str = ""
    # Fallback project to push generated test-case issues into when the
    # requirement wasn't itself fetched from JIRA (so there's no issue key
    # to derive a project from, e.g. "COERSD-37655" -> project "COERSD").
    JIRA_PROJECT_KEY: str = ""
    # Confluence is often the same Atlassian Cloud account as JIRA, but not
    # always (different permission group, different token scope, or a
    # separately-hosted Confluence). These default to the JIRA credentials
    # above if left blank, but can be set independently if your org's access
    # is split — set these explicitly rather than assuming JIRA access
    # implies Confluence access.
    CONFLUENCE_BASE_URL: str = ""
    CONFLUENCE_EMAIL: str = ""
    CONFLUENCE_API_TOKEN: str = ""

    @property
    def cors_origins_list(self) -> List[str]:
        try:
            return json.loads(self.CORS_ORIGINS)
        except Exception:
            return ["http://localhost:3000"]

    class Config:
        env_file = ".env"
        case_sensitive = True
        # Don't crash the entire backend if .env has keys we haven't
        # declared yet (e.g. leftover keys from a previous LLM provider
        # experiment). Pydantic v2 default is "forbid" which raises a
        # ValidationError and the app won't start at all — "ignore" just
        # skips unknown keys silently instead.
        extra = "ignore"


settings = Settings()

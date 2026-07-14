from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

# Support both PostgreSQL and SQLite (for POC without PostgreSQL)
DB_URL = settings.DATABASE_URL
if DB_URL.startswith("sqlite"):
    # SQLite needs different connect_args and no pool settings
    engine = create_async_engine(
        DB_URL,
        echo=False,
        connect_args={"check_same_thread": False},
    )
    logger.info("Using SQLite database (POC mode)")
else:
    engine = create_async_engine(
        DB_URL,
        echo=False,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
    )
    logger.info("Using PostgreSQL database")

AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Lightweight auto-migration: this POC uses create_all (no Alembic),
        # which only creates NEW tables — it won't add new columns to an
        # existing smartqa.db from a previous version of the app. Without
        # this, upgrading would silently break the first time the app tries
        # to write to a column that doesn't exist yet in an old database file.
        if DB_URL.startswith("sqlite"):
            await _add_missing_sqlite_columns(conn)
    logger.info("Database tables ready")


async def _add_missing_sqlite_columns(conn):
    """Adds columns that were introduced after a user's existing smartqa.db
    was first created, so upgrading the app doesn't require deleting data."""
    from sqlalchemy import text
    migrations = [
        ("test_cases", "review_comment", "TEXT"),
        ("test_cases", "step_expected_results", "TEXT DEFAULT '[]'"),
    ]
    for table, column, col_type in migrations:
        result = await conn.execute(text(f"PRAGMA table_info({table})"))
        existing_cols = {row[1] for row in result.fetchall()}
        if column not in existing_cols:
            await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))
            logger.info(f"Auto-migration: added missing column {table}.{column}")

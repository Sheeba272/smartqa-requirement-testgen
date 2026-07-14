from sqlalchemy import Column, String, Float, Text, DateTime, JSON, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum
from app.db.database import Base


def gen_uuid():
    return str(uuid.uuid4())


# Use plain string enums — compatible with both SQLite and PostgreSQL
class RequirementStatus(str, enum.Enum):
    DRAFT = "draft"
    VALIDATING = "validating"
    VALIDATED = "validated"
    REVIEW_NEEDED = "review_needed"
    REJECTED = "rejected"


class TCStatus(str, enum.Enum):
    GENERATED = "generated"
    APPROVED = "approved"
    REJECTED = "rejected"
    UNDER_REVIEW = "under_review"
    PUSHED_TO_JIRA = "pushed_to_jira"


class Requirement(Base):
    __tablename__ = "requirements"

    id            = Column(String, primary_key=True, default=gen_uuid)
    req_id        = Column(String, unique=True, index=True)
    title         = Column(String, nullable=False)
    module        = Column(String)
    source_type   = Column(String, default="paste")
    source_ref    = Column(String)

    story_body           = Column(Text)
    as_a                 = Column(Text)
    i_want               = Column(Text)
    so_that              = Column(Text)
    acceptance_criteria  = Column(Text)
    edge_cases           = Column(Text)
    pre_conditions       = Column(Text)
    dependencies         = Column(Text)

    priority = Column(String, default="P3 - Medium")

    score_completeness  = Column(Float, default=0.0)
    score_ac_presence   = Column(Float, default=0.0)
    score_edge_coverage = Column(Float, default=0.0)
    score_clarity       = Column(Float, default=0.0)
    score_testability   = Column(Float, default=0.0)
    score_total         = Column(Float, default=0.0)

    quality_gate         = Column(String)
    # Store as Text (JSON string) — works in both SQLite and PostgreSQL
    missing_params       = Column(Text, default="[]")
    ai_suggestions       = Column(Text)
    similar_requirements = Column(Text, default="[]")

    # Store status as plain String — no SAEnum needed
    status      = Column(String, default=RequirementStatus.DRAFT.value)
    tc_template = Column(String, default="Detailed steps")
    tc_type     = Column(String, default="Positive + Negative")
    chroma_id   = Column(String)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    test_cases = relationship(
        "TestCase", back_populates="requirement", cascade="all, delete-orphan"
    )


class TestCase(Base):
    __tablename__ = "test_cases"

    id             = Column(String, primary_key=True, default=gen_uuid)
    tc_id          = Column(String, index=True)
    requirement_id = Column(String, ForeignKey("requirements.id"), nullable=False)

    title         = Column(String, nullable=False)
    tc_type       = Column(String)
    priority      = Column(String, default="High")
    template      = Column(String)
    component     = Column(String)
    release       = Column(String)

    pre_conditions  = Column(Text)
    # steps stored as JSON string
    steps           = Column(Text, default="[]")
    # per-step expected results — parallel JSON array to steps[], one entry
    # per step. Empty string means "no specific result for this step".
    # Stored separately from steps[] to avoid changing the steps data format.
    step_expected_results = Column(Text, default="[]")
    expected_result = Column(Text)
    actual_result   = Column(Text)
    notes           = Column(Text)
    # Comment captured when a reviewer approves/rejects/pushes — kept distinct
    # from `notes` (which may hold generation metadata) so there's a clear
    # audit trail of reviewer decisions.
    review_comment  = Column(Text)

    status     = Column(String, default=TCStatus.GENERATED.value)
    jira_key   = Column(String)
    zephyr_id  = Column(String)
    chroma_id  = Column(String)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    requirement = relationship("Requirement", back_populates="test_cases")


class KnowledgeDocument(Base):
    """
    Reference documents uploaded to Agent 1's "Knowledge Base" tab
    (BRD / Word / Confluence exports / past validated requirements docs).

    These are chunked + embedded into the smartqa_knowledge ChromaDB
    collection and used purely as RAG context during validation —
    they are NEVER themselves validated or shown in the requirements list.
    """
    __tablename__ = "knowledge_documents"

    id          = Column(String, primary_key=True, default=gen_uuid)
    filename    = Column(String, nullable=False)
    source_type = Column(String, default="upload")   # upload | confluence | text
    source_ref  = Column(String)                      # Confluence URL etc.
    module      = Column(String)
    char_count  = Column(Float, default=0)
    chunk_count = Column(Float, default=0)
    status      = Column(String, default="indexed")  # indexed | failed
    error       = Column(Text)

    created_at = Column(DateTime, server_default=func.now())



class TokenUsage(Base):
    """
    Cumulative token usage per agent per day — used by the usage dashboard.
    agent: "agent1" | "agent2"
    operation: "validate" | "enhance" | "generate" | "from_text" etc.
    """
    __tablename__ = "token_usage"

    id           = Column(String, primary_key=True, default=gen_uuid)
    agent        = Column(String, nullable=False, index=True)  # agent1 / agent2
    operation    = Column(String, nullable=False)
    prompt_tokens      = Column(Float, default=0)
    completion_tokens  = Column(Float, default=0)
    total_tokens       = Column(Float, default=0)
    requirement_id     = Column(String)   # optional ref
    created_at   = Column(DateTime, server_default=func.now())


class PipelineExecutionLog(Base):
    """
    Stores the per-step execution trace for each validation/generation run.
    Used by the AI Execution Pipeline view in the frontend.
    """
    __tablename__ = "pipeline_execution_logs"

    id             = Column(String, primary_key=True, default=gen_uuid)
    requirement_id = Column(String, index=True, nullable=False)
    agent          = Column(String, nullable=False)   # "agent1" | "agent2"
    steps          = Column(Text, default="[]")       # JSON list of step dicts
    created_at     = Column(DateTime, server_default=func.now())

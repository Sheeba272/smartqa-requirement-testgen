from pydantic import BaseModel, field_validator
from typing import Optional, List, Any
from datetime import datetime


class RequirementCreate(BaseModel):
    title: str
    module: Optional[str] = None
    source_type: Optional[str] = "paste"
    source_ref: Optional[str] = None
    story_body: Optional[str] = None
    as_a: Optional[str] = None
    i_want: Optional[str] = None
    so_that: Optional[str] = None
    acceptance_criteria: Optional[str] = None
    edge_cases: Optional[str] = None
    pre_conditions: Optional[str] = None
    dependencies: Optional[str] = None
    priority: Optional[str] = "P3 - Medium"
    tc_template: Optional[str] = "Detailed steps"
    tc_type: Optional[str] = "Positive + Negative"


class ScoreDetail(BaseModel):
    completeness: float
    ac_presence: float
    edge_coverage: float
    clarity: float
    testability: float
    total: float
    quality_gate: str
    missing_params: List[Any] = []
    ai_suggestions: str = ""
    similar_requirements: List[Any] = []


class RequirementOut(BaseModel):
    id: str
    req_id: Optional[str] = None
    title: str
    module: Optional[str] = None
    source_type: Optional[str] = None
    story_body: Optional[str] = None
    acceptance_criteria: Optional[str] = None
    edge_cases: Optional[str] = None
    pre_conditions: Optional[str] = None
    dependencies: Optional[str] = None
    score_completeness: float = 0
    score_ac_presence: float = 0
    score_edge_coverage: float = 0
    score_clarity: float = 0
    score_testability: float = 0
    score_total: float = 0
    quality_gate: Optional[str] = None
    missing_params: List[Any] = []
    ai_suggestions: Optional[str] = None
    similar_requirements: List[Any] = []
    status: str = "draft"
    tc_template: Optional[str] = None
    tc_type: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TestCaseOut(BaseModel):
    id: str
    tc_id: Optional[str] = None
    requirement_id: str
    title: str
    tc_type: Optional[str] = None
    priority: str = "High"
    template: Optional[str] = None
    pre_conditions: Optional[str] = None
    steps: List[str] = []
    expected_result: Optional[str] = None
    actual_result: Optional[str] = None
    notes: Optional[str] = None
    review_comment: Optional[str] = None
    status: str = "generated"
    jira_key: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class BulkRequirementCreate(BaseModel):
    requirements: List[RequirementCreate]


class DashboardStats(BaseModel):
    total_requirements: int = 0
    validated: int = 0
    review_needed: int = 0
    rejected: int = 0
    draft: int = 0
    total_test_cases: int = 0
    avg_score: float = 0.0
    pushed_to_jira: int = 0


class JiraFetchRequest(BaseModel):
    story_url: str
    jira_base_url: Optional[str] = None
    jira_email: Optional[str] = None
    jira_api_token: Optional[str] = None


class TCUpdateRequest(BaseModel):
    title: Optional[str] = None
    pre_conditions: Optional[str] = None
    steps: Optional[List[str]] = None
    expected_result: Optional[str] = None
    priority: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None


class TCActionRequest(BaseModel):
    """Used for approve/reject/push-to-jira — captures the reviewer's comment
    alongside the action so there's an audit trail of why a test case was
    approved, rejected, or pushed."""
    comment: Optional[str] = None


# ── Test Case Generation Agent — standalone input ────────────────────────────
class DirectTCGenerateRequest(BaseModel):
    """Paste a user story directly into the Test Case Agent — no
    requirement-validation record required. The story is still embedded
    into ChromaDB (shared corpus) for future RAG context."""
    title: str
    module: Optional[str] = None
    priority: Optional[str] = "P3 - Medium"
    story_body: Optional[str] = None
    acceptance_criteria: Optional[str] = None
    edge_cases: Optional[str] = None
    template: Optional[str] = "Detailed steps"
    tc_type: Optional[str] = "Positive + Negative"
    # Optional link back to a Requirement created in the Validation Agent
    requirement_id: Optional[str] = None


# ── Agent 2 — full generation options panel ──────────────────────────────────
class TCGenerationOptions(BaseModel):
    """
    Full options panel for Agent 2:
      tc_types: list of categories (positive, negative, boundary, error_handling, integration)
      complexity: simple | medium | detailed
      template: Detailed Test Case | BDD Format | Organization Template | Zephyr Template
      naming_convention: e.g. "TC_Login_001"
    """
    tc_types: List[str] = ["positive", "negative"]
    complexity: str = "medium"
    template: str = "Detailed Test Case"
    naming_convention: str = "TC_Module_001"


class DirectTCGenerateRequestV2(BaseModel):
    """Extended direct-generation request with full options panel."""
    title: Optional[str] = None      # loaded from DB when requirement_id is provided
    module: Optional[str] = None
    priority: Optional[str] = "P3 - Medium"
    story_body: Optional[str] = None
    acceptance_criteria: Optional[str] = None
    edge_cases: Optional[str] = None
    requirement_id: Optional[str] = None
    options: TCGenerationOptions = TCGenerationOptions()


class RequirementIdBatchRequest(BaseModel):
    requirement_ids: List[str]


class BulkTCGenerateRequestV2(BaseModel):
    requirement_ids: List[str]
    options: TCGenerationOptions = TCGenerationOptions()


# ── Agent 1 — edit requirement (Human-in-the-Loop) ──────────────────────────
class RequirementUpdateRequest(BaseModel):
    title: Optional[str] = None
    module: Optional[str] = None
    story_body: Optional[str] = None
    acceptance_criteria: Optional[str] = None
    edge_cases: Optional[str] = None
    pre_conditions: Optional[str] = None
    dependencies: Optional[str] = None
    priority: Optional[str] = None
    revalidate: bool = False   # if true, re-run Agent 1 after saving

    @field_validator("story_body", "acceptance_criteria", "edge_cases", "pre_conditions", mode="before")
    @classmethod
    def _coerce_to_str(cls, v):
        """LLMs sometimes return lists instead of strings — join them."""
        if isinstance(v, list):
            return "\n".join(str(x).strip() for x in v if x)
        if v is None:
            return None
        return str(v)


# ── Agent 1 — Knowledge Base (Contextual Knowledge tab) ─────────────────────
class KnowledgeDocOut(BaseModel):
    id: str
    filename: str
    source_type: str
    source_ref: Optional[str] = None
    module: Optional[str] = None
    char_count: float = 0
    chunk_count: float = 0
    status: str = "indexed"
    error: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ConfluenceFetchRequest(BaseModel):
    page_url: str
    module: Optional[str] = None
    confluence_base_url: Optional[str] = None
    confluence_email: Optional[str] = None
    confluence_api_token: Optional[str] = None


# ── Agent 1 — "Other sources" generic text input ─────────────────────────────
class OtherSourceFetchRequest(BaseModel):
    """For 'Other Sources' input — raw pasted text treated as a knowledge chunk
    or, if title+story_body given, as a requirement candidate."""
    text: str
    title: Optional[str] = None
    module: Optional[str] = None
    as_knowledge: bool = False  # true -> index into knowledge corpus only

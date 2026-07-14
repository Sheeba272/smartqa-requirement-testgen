from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.db.database import get_db
from app.models.models import Requirement, TestCase, RequirementStatus, TCStatus, KnowledgeDocument, TokenUsage, PipelineExecutionLog
from app.models.schemas import (
    RequirementCreate, RequirementOut, TestCaseOut, BulkRequirementCreate,
    RequirementIdBatchRequest, BulkTCGenerateRequestV2,
    DashboardStats, JiraFetchRequest, TCUpdateRequest, TCActionRequest, ScoreDetail,
    DirectTCGenerateRequest, DirectTCGenerateRequestV2, TCGenerationOptions,
    RequirementUpdateRequest, KnowledgeDocOut, ConfluenceFetchRequest,
    OtherSourceFetchRequest,
)
from app.services.agent1_validation import run_agent1_validation
from app.services.agent2_generation import run_agent2_generation
from app.services.ollama_client import check_model_available, get_chat_client, extract_json
from app.services.vector_store import (
    upsert_requirement, upsert_testcase,
    upsert_knowledge_chunks, query_knowledge, delete_knowledge_doc,
)
from app.services.jira_service import (
    fetch_jira_story, push_testcase_to_jira, fetch_confluence_page,
    fetch_linked_confluence_pages,
)
from app.services.document_parser import extract_text
from app.core.config import settings
from typing import List, Optional
import uuid
import json
import logging
import asyncio
import pandas as pd
import io
import os
import re
from datetime import datetime, timezone

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Token usage tracking ──────────────────────────────────────────────────────
async def _track_tokens(db: AsyncSession, agent: str, operation: str,
                        response_obj, requirement_id: str = "") -> None:
    """Record token usage from an LLMResponse, Ollama, or Anthropic response."""
    try:
        from app.services.llm_client import LLMResponse
        if isinstance(response_obj, LLMResponse):
            pt, ct, tt = response_obj.prompt_tokens, response_obj.completion_tokens, response_obj.total_tokens
        else:
            usage = getattr(response_obj, "usage", None)
            if not usage:
                return
            pt = getattr(usage, "prompt_tokens", 0) or 0
            ct = getattr(usage, "completion_tokens", 0) or 0
            tt = getattr(usage, "total_tokens", 0) or (pt + ct)
        if tt == 0:
            return
        row = TokenUsage(
            agent=agent,
            operation=operation,
            prompt_tokens=pt,
            completion_tokens=ct,
            total_tokens=tt,
            requirement_id=requirement_id or "",
        )
        db.add(row)
        await db.commit()
    except Exception as e:
        logger.debug(f"Token tracking skipped: {e}")


# ── helpers ──────────────────────────────────────────────────────────────────

def _gen_req_id(module: str) -> str:
    prefix = "".join(w[0].upper() for w in (module or "GEN").split()[:3])
    return f"REQ-{prefix}-{str(uuid.uuid4())[:6].upper()}"


def _dumps(v) -> str:
    """Safely serialise a list/dict to JSON string for Text column."""
    if v is None:
        return "[]"
    if isinstance(v, str):
        return v
    return json.dumps(v)


def _loads(v) -> list:
    """Safely deserialise a JSON string from Text column."""
    if not v:
        return []
    if isinstance(v, (list, dict)):
        return v
    try:
        return json.loads(v)
    except Exception:
        return []


def _req_to_dict(req: Requirement) -> dict:
    """Convert ORM object to dict with JSON fields properly parsed."""
    return {
        "id": req.id,
        "req_id": req.req_id,
        "title": req.title,
        "module": req.module,
        "source_type": req.source_type,
        "story_body": req.story_body,
        "acceptance_criteria": req.acceptance_criteria,
        "edge_cases": req.edge_cases,
        "pre_conditions": req.pre_conditions,
        "dependencies": req.dependencies,
        "score_completeness": req.score_completeness or 0,
        "score_ac_presence": req.score_ac_presence or 0,
        "score_edge_coverage": req.score_edge_coverage or 0,
        "score_clarity": req.score_clarity or 0,
        "score_testability": req.score_testability or 0,
        "score_total": req.score_total or 0,
        "quality_gate": req.quality_gate,
        "missing_params": _loads(req.missing_params),
        "ai_suggestions": req.ai_suggestions,
        "similar_requirements": _loads(req.similar_requirements),
        "status": req.status,
        "tc_template": req.tc_template,
        "tc_type": req.tc_type,
        "created_at": req.created_at,
    }


def _tc_to_dict(tc: TestCase) -> dict:
    return {
        "id": tc.id,
        "tc_id": tc.tc_id,
        "requirement_id": tc.requirement_id,
        "title": tc.title,
        "tc_type": tc.tc_type,
        "priority": tc.priority,
        "template": tc.template,
        "pre_conditions": tc.pre_conditions,
        "steps": _loads(tc.steps),
        "step_expected_results": _loads(getattr(tc, "step_expected_results", None) or "[]"),
        "expected_result": tc.expected_result,
        "actual_result": tc.actual_result,
        "notes": tc.notes,
        "review_comment": tc.review_comment,
        "status": tc.status,
        "jira_key": tc.jira_key,
        "created_at": tc.created_at,
    }

# Local fallback storage for test cases that couldn't be pushed to JIRA
# (bad/missing credentials, no project key resolvable, JIRA outage, etc.)
# — so a push failure never means the generated work is simply lost.
_JIRA_FALLBACK_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "jira_fallback")


def _save_tc_fallback_file(tc: TestCase, requirement: Optional[Requirement], error: str) -> str:
    os.makedirs(_JIRA_FALLBACK_DIR, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe_id = re.sub(r'[^A-Za-z0-9_.-]', '_', tc.tc_id or tc.id)
    filename = f"{safe_id}_{timestamp}.json"
    filepath = os.path.join(_JIRA_FALLBACK_DIR, filename)

    payload = {
        "tc_id": tc.tc_id,
        "title": tc.title,
        "tc_type": tc.tc_type,
        "priority": tc.priority,
        "template": tc.template,
        "pre_conditions": tc.pre_conditions,
        "steps": _loads(tc.steps),
        "expected_result": tc.expected_result,
        "notes": tc.notes,
        "requirement_id": tc.requirement_id,
        "requirement_title": requirement.title if requirement else None,
        "requirement_source_ref": requirement.source_ref if requirement else None,
        "jira_push_error": error,
        "attempted_at": timestamp,
    }
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    logger.warning(f"JIRA push failed for test case {tc.id} ({error}) — saved fallback to {filepath}")
    return filepath


# ── User feedback ───────────────────────────────────────────────────────────
_FEEDBACK_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "feedback")


@router.post("/system/feedback", response_model=dict)
async def submit_feedback(payload: dict):
    """
    Stores user feedback on generated test cases or requirement validation.
    Used to improve future generations — what was wrong, what was right,
    what the user actually expected. Written to data/feedback/ as JSON files
    so they can be reviewed and later used to tune the prompts or fine-tune.
    """
    os.makedirs(_FEEDBACK_DIR, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filepath = os.path.join(_FEEDBACK_DIR, f"feedback_{timestamp}.json")
    data = {
        "submitted_at": timestamp,
        "type": payload.get("type", "general"),         # "tc_quality" | "validation" | "general"
        "source_id": payload.get("source_id", ""),       # tc_id or requirement_id
        "rating": payload.get("rating"),                 # 1-5
        "issues": payload.get("issues", []),             # list of issue tags
        "comment": payload.get("comment", ""),           # free text
        "agent": payload.get("agent", ""),               # "agent1" | "agent2"
    }
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    logger.info(f"Feedback saved: {filepath}")
    return {"saved": True, "filepath": filepath}


# ── Ollama / model status ─────────────────────────────────────────────────
# Lets the frontend check up-front whether generation is actually likely to
# work, instead of discovering "model not found" only after a multi-minute
# stalled request.
@router.get("/system/ollama-status", response_model=dict)
async def ollama_status():
    from app.services.llm_client import check_llm_status
    return await check_llm_status()


@router.get("/system/token-usage", response_model=dict)
async def token_usage_stats(db: AsyncSession = Depends(get_db)):
    """Aggregate token usage by agent and operation — for the usage dashboard."""
    result = await db.execute(select(TokenUsage))
    rows = result.scalars().all()

    by_agent: dict = {"agent1": {}, "agent2": {}}
    totals: dict = {
        "agent1": {"prompt": 0, "completion": 0, "total": 0, "calls": 0},
        "agent2": {"prompt": 0, "completion": 0, "total": 0, "calls": 0},
    }
    for r in rows:
        ag = r.agent if r.agent in by_agent else "agent1"
        op = r.operation or "unknown"
        if op not in by_agent[ag]:
            by_agent[ag][op] = {"prompt": 0, "completion": 0, "total": 0, "calls": 0}
        for k, v in (("prompt", r.prompt_tokens), ("completion", r.completion_tokens),
                     ("total", r.total_tokens)):
            by_agent[ag][op][k] += v or 0
            totals[ag][k]       += v or 0
        by_agent[ag][op]["calls"] += 1
        totals[ag]["calls"]       += 1

    return {
        "agent1": {"by_operation": by_agent["agent1"], "totals": totals["agent1"]},
        "agent2": {"by_operation": by_agent["agent2"], "totals": totals["agent2"]},
        "grand_total": {
            "prompt":     totals["agent1"]["prompt"]     + totals["agent2"]["prompt"],
            "completion": totals["agent1"]["completion"] + totals["agent2"]["completion"],
            "total":      totals["agent1"]["total"]      + totals["agent2"]["total"],
            "calls":      totals["agent1"]["calls"]      + totals["agent2"]["calls"],
        },
    }


# ── dashboard ────────────────────────────────────────────────────────────────

@router.get("/dashboard", response_model=DashboardStats)
async def get_dashboard(db: AsyncSession = Depends(get_db)):
    total     = await db.scalar(select(func.count(Requirement.id))) or 0
    validated = await db.scalar(select(func.count(Requirement.id)).where(Requirement.status == RequirementStatus.VALIDATED.value)) or 0
    review    = await db.scalar(select(func.count(Requirement.id)).where(Requirement.status == RequirementStatus.REVIEW_NEEDED.value)) or 0
    rejected  = await db.scalar(select(func.count(Requirement.id)).where(Requirement.status == RequirementStatus.REJECTED.value)) or 0
    draft     = await db.scalar(select(func.count(Requirement.id)).where(Requirement.status == RequirementStatus.DRAFT.value)) or 0
    tcs       = await db.scalar(select(func.count(TestCase.id))) or 0
    pushed    = await db.scalar(select(func.count(TestCase.id)).where(TestCase.status == TCStatus.PUSHED_TO_JIRA.value)) or 0
    avg_raw   = await db.scalar(select(func.avg(Requirement.score_total)).where(Requirement.score_total > 0))

    return DashboardStats(
        total_requirements=total,
        validated=validated,
        review_needed=review,
        rejected=rejected,
        draft=draft,
        total_test_cases=tcs,
        avg_score=round(float(avg_raw or 0), 1),
        pushed_to_jira=pushed,
    )


# ── requirements ─────────────────────────────────────────────────────────────

@router.get("/requirements", response_model=List[RequirementOut])
async def list_requirements(
    status: Optional[str] = None,
    module: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    q = select(Requirement).order_by(Requirement.created_at.desc()).limit(limit).offset(offset)
    if status:
        q = q.where(Requirement.status == status)
    if module:
        q = q.where(Requirement.module == module)
    result = await db.execute(q)
    return [_req_to_dict(r) for r in result.scalars().all()]


@router.post("/requirements", response_model=RequirementOut, status_code=201)
async def create_requirement(payload: RequirementCreate, db: AsyncSession = Depends(get_db)):
    req = Requirement(
        id=str(uuid.uuid4()),
        req_id=_gen_req_id(payload.module or ""),
        title=payload.title,
        module=payload.module,
        source_type=payload.source_type or "paste",
        source_ref=payload.source_ref,
        story_body=payload.story_body,
        as_a=payload.as_a,
        i_want=payload.i_want,
        so_that=payload.so_that,
        acceptance_criteria=payload.acceptance_criteria,
        edge_cases=payload.edge_cases,
        pre_conditions=payload.pre_conditions,
        dependencies=payload.dependencies,
        priority=payload.priority or "P3 - Medium",
        tc_template=payload.tc_template or "Detailed steps",
        tc_type=payload.tc_type or "Positive + Negative",
        status=RequirementStatus.DRAFT.value,
        missing_params="[]",
        similar_requirements="[]",
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return _req_to_dict(req)


@router.get("/requirements/{req_id}", response_model=RequirementOut)
async def get_requirement(req_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Requirement).where(Requirement.id == req_id))
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Requirement not found")
    return _req_to_dict(req)


# ── Human-in-the-Loop: edit requirement based on Agent 1 suggestions ─────────
@router.patch("/requirements/{req_id}", response_model=RequirementOut)
async def update_requirement(req_id: str, payload: RequirementUpdateRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Requirement).where(Requirement.id == req_id))
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Requirement not found")

    data = payload.model_dump(exclude_none=True, exclude={"revalidate"})
    for field, value in data.items():
        setattr(req, field, value)

    if data:
        # Edited content invalidates the previous score until re-validated
        req.status = RequirementStatus.DRAFT.value

    await db.commit()
    await db.refresh(req)

    if payload.revalidate:
        return await validate_requirement(req_id, db)

    return _req_to_dict(req)


async def _validate_one_requirement(req: Requirement, db: AsyncSession) -> Requirement:
    """
    Core validation logic for a single requirement — shared by the
    single-item validate route and the bulk-validate route below, so bulk
    validation behaves identically to validating one at a time (same
    scoring, same timeout handling, same RAG indexing) rather than a
    separate, possibly-drifting implementation.
    """
    req.status = RequirementStatus.VALIDATING.value
    await db.commit()

    try:
        score: ScoreDetail = await asyncio.wait_for(
            run_agent1_validation(
                title=req.title or "",
                module=req.module or "",
                story_body=req.story_body or "",
                acceptance_criteria=req.acceptance_criteria or "",
                edge_cases=req.edge_cases or "",
                pre_conditions=req.pre_conditions or "",
            ),
            timeout=540.0,
        )
    except asyncio.TimeoutError:
        req.status = RequirementStatus.DRAFT.value
        await db.commit()
        raise HTTPException(
            504,
            "Validation timed out after 170 seconds. On CPU-only hardware, "
            f"'{settings.OLLAMA_MODEL}' can take a while to load and respond — "
            "if this keeps happening, try a smaller model (e.g. phi3:mini or "
            "deepseek-coder) by changing OLLAMA_MODEL in backend/.env. "
            "Run 'ollama list' to see what's installed."
        )

    req.score_completeness  = score.completeness
    req.score_ac_presence   = score.ac_presence
    req.score_edge_coverage = score.edge_coverage
    req.score_clarity       = score.clarity
    req.score_testability   = score.testability
    req.score_total         = score.total
    req.quality_gate        = score.quality_gate
    req.missing_params      = _dumps(score.missing_params)
    req.ai_suggestions      = score.ai_suggestions
    req.similar_requirements = _dumps(score.similar_requirements)

    gate_map = {
        "validated":    RequirementStatus.VALIDATED.value,
        "review_needed": RequirementStatus.REVIEW_NEEDED.value,
        "rejected":     RequirementStatus.REJECTED.value,
    }
    req.status = gate_map.get(score.quality_gate, RequirementStatus.REVIEW_NEEDED.value)

    await db.commit()
    await db.refresh(req)

    try:
        doc_text = f"{req.title} {req.story_body} {req.acceptance_criteria}"
        await upsert_requirement(
            req_id=req.id,
            text=doc_text,
            metadata={
                "title": req.title,
                "module": req.module or "",
                "score_total": str(req.score_total),
                "quality_gate": req.quality_gate or "",
            }
        )
    except Exception as e:
        logger.warning(f"ChromaDB upsert skipped: {e}")

    # Save pipeline execution log
    try:
        events = getattr(run_agent1_validation, "_last_events", [])
        if events:
            log = PipelineExecutionLog(
                id=str(uuid.uuid4()),
                requirement_id=req.id,
                agent="agent1",
                steps=json.dumps(events),
            )
            db.add(log)
            await db.commit()
    except Exception as e:
        logger.debug(f"Pipeline log save skipped: {e}")

    # Track token usage
    try:
        usage = getattr(run_agent1_validation, "_last_usage", None)
        if usage:
            await _track_tokens(db, "agent1", "validate", usage, req.id)
    except Exception:
        pass

    return req


@router.post("/requirements/{req_id}/validate", response_model=RequirementOut)
async def validate_requirement(req_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Requirement).where(Requirement.id == req_id))
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Requirement not found")

    req = await _validate_one_requirement(req, db)
    return _req_to_dict(req)


@router.get("/requirements/{req_id}/pipeline-log", response_model=dict)
async def get_pipeline_log(req_id: str, agent: str = "agent1", db: AsyncSession = Depends(get_db)):
    """Return the most recent pipeline execution log for a requirement (agent1 or agent2)."""
    result = await db.execute(
        select(PipelineExecutionLog)
        .where(PipelineExecutionLog.requirement_id == req_id)
        .where(PipelineExecutionLog.agent == agent)
        .order_by(PipelineExecutionLog.created_at.desc())
        .limit(1)
    )
    log = result.scalar_one_or_none()
    if not log:
        return {"requirement_id": req_id, "agent": agent, "steps": [], "available": False}
    try:
        steps = json.loads(log.steps)
    except Exception:
        steps = []
    return {
        "requirement_id": req_id,
        "agent": log.agent,
        "steps": steps,
        "available": True,
        "created_at": log.created_at.isoformat() if log.created_at else None,
    }


@router.post("/requirements/{req_id}/ai-enhance", response_model=dict)
async def ai_enhance_requirement(req_id: str, db: AsyncSession = Depends(get_db)):
    """
    Uses Ollama to rewrite / strengthen all requirement fields based on the
    AI analysis already stored in ai_suggestions. Returns improved field values
    that the frontend pre-fills into the edit form. Does NOT save to DB — the
    user reviews and clicks Save & Re-validate themselves.
    """
    result = await db.execute(select(Requirement).where(Requirement.id == req_id))
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Requirement not found")

    ENHANCE_SYSTEM = """\
You are a senior QA analyst. Your job is to improve a software requirement so it scores ≥40/50 on this rubric:
- completeness (0-10): "As a", "I want", "So that" present, description ≥30 words, pre-conditions given
- ac_presence (0-10): ≥3 numbered measurable acceptance criteria, no vague words
- edge_coverage (0-10): ≥4 negative/boundary scenarios, error states documented
- clarity (0-10): no undefined acronyms, explicit pre-conditions
- testability (0-10): each AC maps to a verifiable test, measurable outcomes

Return ONLY a JSON object with these keys — improve each field, never empty them:
{
  "story_body": "<improved As a / I want / So that — keep same meaning, add missing clauses>",
  "acceptance_criteria": "<numbered list, ≥3 measurable criteria, one per line>",
  "edge_cases": "<≥4 specific negative/boundary scenarios, one per line>",
  "pre_conditions": "<2-3 specific pre-conditions for this module/domain>"
}
NO markdown fences. NO explanation. ONLY the JSON object."""

    domain_hint = ""
    story = (req.story_body or "").lower()
    if "leave" in story or "hr" in story or "payroll" in story:
        domain_hint = "Domain: HR / Leave Management (SAP HCM)"
    elif "stock" in story or "transfer" in story or "plant" in story or "inventory" in story:
        domain_hint = "Domain: Inventory / Stock Transfer (SAP MM)"
    elif "purchase" in story or "procurement" in story or "po" in story:
        domain_hint = "Domain: Procurement / Purchase Orders (SAP MM)"
    elif "sales" in story or "order" in story or "sd" in story:
        domain_hint = "Domain: Sales Order Management (SAP SD)"
    elif "invoice" in story or "finance" in story or "fi" in story or "credit" in story:
        domain_hint = "Domain: Finance / Invoice Processing (SAP FI)"
    elif "intercompany" in story or "pricing" in story:
        domain_hint = "Domain: Intercompany Pricing / Stock Transfer (SAP MM/SD)"

    enhance_user = f"""{domain_hint}

TITLE: {req.title or "Not provided"}
MODULE: {req.module or "Not specified"}

CURRENT story_body:
{req.story_body or "Not provided"}

CURRENT acceptance_criteria:
{req.acceptance_criteria or "Not provided"}

CURRENT edge_cases:
{req.edge_cases or "Not provided"}

CURRENT pre_conditions:
{req.pre_conditions or "Not provided"}

AI ANALYSIS ALREADY PROVIDED:
{req.ai_suggestions or "No analysis available"}

Improve all four fields so the requirement scores ≥40/50. Return the JSON object only."""

    try:
        from app.services.llm_client import call_llm as _call_llm
        llm_resp = await asyncio.wait_for(
            _call_llm(
                system=ENHANCE_SYSTEM,
                user=enhance_user,
                temperature=0.2,
                timeout=480.0,
                agent="agent1",
            ),
            timeout=540.0,
        )
        raw = llm_resp.content
        data = extract_json(raw)
        await _track_tokens(db, "agent1", "enhance", llm_resp, req_id)

        def _to_str(val: any, fallback: str) -> str:
            """LLMs sometimes return lists instead of strings — join them."""
            if val is None:
                return fallback
            if isinstance(val, list):
                return "\n".join(str(v).strip() for v in val if v)
            return str(val).strip() or fallback

        return {
            "story_body":           _to_str(data.get("story_body"),           req.story_body or ""),
            "acceptance_criteria":  _to_str(data.get("acceptance_criteria"),  req.acceptance_criteria or ""),
            "edge_cases":           _to_str(data.get("edge_cases"),            req.edge_cases or ""),
            "pre_conditions":       _to_str(data.get("pre_conditions"),        req.pre_conditions or ""),
            "ai_enhanced": True,
        }

    except Exception as e:
        import asyncio as _asyncio
        err_str = str(e) or type(e).__name__
        # asyncio.TimeoutError has no message — make it explicit
        if isinstance(e, (_asyncio.TimeoutError, TimeoutError)) or "TimeoutError" in type(e).__name__:
            err_str = f"LLM call timed out after 480s — qwen2.5:7b is still processing. Try again (model may be busy loading)."
        logger.warning(f"AI enhance failed for {req_id}: {err_str}", exc_info=True)
        if "ANTHROPIC_API_KEY" in err_str or "not set" in err_str or "your-" in err_str:
            raise HTTPException(503,
                "Anthropic API key not configured. Open backend/.env, set "
                "ANTHROPIC_API_KEY=sk-ant-... from console.anthropic.com, "
                "then restart run_backend.bat.")
        if "401" in err_str or "invalid" in err_str.lower():
            raise HTTPException(503,
                "Anthropic API key invalid — check ANTHROPIC_API_KEY in backend/.env.")
        # Rule-based fallback for genuine network/timeout issues
        story_lower = (req.story_body or "").lower()
        parts = []
        if "leave" in story_lower or "hr" in story_lower:
            parts = ["User is logged into the HR/Payroll system with employee self-service role",
                     "Employee record exists with an active contract in the system",
                     "Leave policy and working calendar are configured in the system"]
        elif "stock" in story_lower or "transfer" in story_lower or "plant" in story_lower:
            parts = ["User is logged into SAP with Inventory Management (MM) role",
                     "Source and target plants are configured and active in the system",
                     "Sufficient stock exists at the source plant for the transfer quantity"]
        elif "intercompany" in story_lower or "pricing" in story_lower:
            parts = ["User is logged into SAP with MM/SD authorization",
                     "Intercompany pricing conditions are configured in the system",
                     "Source and receiving company codes exist and are active"]
        else:
            parts = ["User is authenticated with the required SAP role",
                     "Relevant master data (material, vendor, customer) exists in the system",
                     "Required organizational units (plant, company code) are configured"]

        edge_lines = []
        if req.edge_cases and len((req.edge_cases or "").strip().splitlines()) >= 3:
            edge_lines_existing = (req.edge_cases or "").strip()
        else:
            if "leave" in story_lower:
                edge_lines_existing = "\n".join([
                    "Employee submits leave with insufficient balance",
                    "Leave request spans a public holiday — verify working days calculation",
                    "Manager is also on leave when request arrives",
                    "Overlapping leave dates with an existing approved request",
                    "Leave start date is in the past"])
            elif "stock" in story_lower or "transfer" in story_lower:
                edge_lines_existing = "\n".join([
                    "Transfer quantity exceeds available stock at source plant",
                    "Destination plant does not exist or is inactive",
                    "User lacks the required MM authorization role",
                    "Network interruption mid-transfer — verify no partial save",
                    "Zero or negative quantity entered"])
            elif "intercompany" in story_lower or "pricing" in story_lower:
                edge_lines_existing = "\n".join([
                    "Intercompany pricing condition is missing or expired",
                    "Transfer order created with zero or negative quantity",
                    "Receiving plant does not have the material configured",
                    "User attempts transfer without intercompany authorization",
                    "Duplicate transfer order submitted with same reference"])
            else:
                edge_lines_existing = "\n".join([
                    "Invalid or non-existent reference number entered",
                    "Mandatory fields left blank — verify validation error shown",
                    "User without required role attempts the action",
                    "Boundary value: minimum and maximum allowed values",
                    "System timeout during operation — verify no partial save"])

        return {
            "story_body":           req.story_body or "",
            "acceptance_criteria":  req.acceptance_criteria or "",
            "edge_cases":           edge_lines_existing,
            "pre_conditions":       "\n".join(parts),
            "ai_enhanced": False,
        }


# ── Bulk validate — used after a CSV upload to validate everything in one
# action instead of clicking into each requirement individually. Each item
# is isolated: one failure (timeout, bad data) never blocks the rest of the
# batch, and the response reports per-item success/failure so the UI can
# show exactly what happened to each one. ───────────────────────────────────
@router.post("/requirements/bulk-validate", response_model=dict)
async def bulk_validate_requirements(payload: RequirementIdBatchRequest, db: AsyncSession = Depends(get_db)):
    results = []
    errors = []
    for req_id in payload.requirement_ids:
        try:
            result = await db.execute(select(Requirement).where(Requirement.id == req_id))
            req = result.scalar_one_or_none()
            if not req:
                errors.append({"requirement_id": req_id, "error": "Requirement not found"})
                continue
            req = await _validate_one_requirement(req, db)
            results.append(_req_to_dict(req))
        except HTTPException as e:
            errors.append({"requirement_id": req_id, "error": str(e.detail)})
        except Exception as e:
            errors.append({"requirement_id": req_id, "error": str(e)})
            logger.error(f"Bulk validate failed for {req_id}: {e}")
    return {"validated": results, "errors": errors}



# ── test case generation ──────────────────────────────────────────────────────

@router.post("/requirements/{req_id}/generate-testcases", response_model=List[TestCaseOut])
async def generate_testcases(req_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Requirement).where(Requirement.id == req_id))
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Requirement not found")
    if req.status != RequirementStatus.VALIDATED.value:
        status_msg = {
            RequirementStatus.REJECTED.value: "is rejected",
            RequirementStatus.REVIEW_NEEDED.value: "needs review — it scored below the approval threshold",
            RequirementStatus.DRAFT.value: "hasn't been validated yet",
            RequirementStatus.VALIDATING.value: "is still being validated",
        }.get(req.status, f"has status '{req.status}'")
        raise HTTPException(400, f"Requirement {status_msg}. Address the gaps and re-validate before generating test cases.")

    raw_tcs = await run_agent2_generation(
        requirement_id=req.id,
        title=req.title or "",
        module=req.module or "",
        priority=req.priority or "P3 - Medium",
        story_body=req.story_body or "",
        acceptance_criteria=req.acceptance_criteria or "",
        edge_cases=req.edge_cases or "",
        template=req.tc_template or "Detailed steps",
        tc_type=req.tc_type or "Positive + Negative",
        pre_conditions=req.pre_conditions or "",
    )
    # Track token usage
    last_usage = getattr(run_agent2_generation, "_last_usage", None)
    if last_usage:
        await _track_tokens(db, "agent2", "generate", last_usage, req.id)

    # Save Agent 2 pipeline execution log
    try:
        a2_events = getattr(run_agent2_generation, "_last_events", [])
        if a2_events:
            log = PipelineExecutionLog(
                id=str(uuid.uuid4()),
                requirement_id=req.id,
                agent="agent2",
                steps=json.dumps(a2_events),
            )
            db.add(log)
            await db.commit()
    except Exception as e:
        logger.debug(f"Agent2 pipeline log save skipped: {e}")

    created = []
    pos_idx = neg_idx = 1
    for tc_data in raw_tcs:
        tc_type = str(tc_data.get("tc_type", "positive")).lower()
        if tc_type == "positive":
            tc_id = f"TC-POS-{pos_idx:03d}"; pos_idx += 1
        else:
            tc_id = f"TC-NEG-{neg_idx:03d}"; neg_idx += 1

        steps = tc_data.get("steps", [])
        tc = TestCase(
            id=str(uuid.uuid4()),
            tc_id=tc_id,
            requirement_id=req.id,
            title=tc_data.get("title", "Generated test case"),
            tc_type=tc_type,
            priority=tc_data.get("priority", "High"),
            template=req.tc_template or "Detailed steps",
            component=req.module,
            pre_conditions=tc_data.get("pre_conditions", ""),
            steps=_dumps(steps),
            step_expected_results=_dumps(tc_data.get("step_expected_results", [])),
            expected_result=tc_data.get("expected_result", ""),
            notes=tc_data.get("notes", ""),
            status=TCStatus.GENERATED.value,
        )
        db.add(tc)
        created.append(tc)

    await db.commit()
    for tc in created:
        await db.refresh(tc)
        try:
            tc_text = f"{tc.title} {' '.join(_loads(tc.steps))} {tc.expected_result}"
            await upsert_testcase(
                tc_id=tc.id,
                text=tc_text,
                metadata={
                    "tc_type": tc.tc_type or "",
                    "module": req.module or "",
                    "priority": tc.priority or "",
                    "title": tc.title,
                }
            )
        except Exception as e:
            logger.warning(f"ChromaDB TC upsert skipped: {e}")

    return [_tc_to_dict(tc) for tc in created]


@router.get("/requirements/{req_id}/testcases", response_model=List[TestCaseOut])
async def get_testcases(req_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TestCase)
        .where(TestCase.requirement_id == req_id)
        .order_by(TestCase.created_at)
    )
    return [_tc_to_dict(tc) for tc in result.scalars().all()]


# ── Global test case listing — used by the Test Case Agent's dashboard for
# drill-through (clicking "Test cases generated" / "Pushed to JIRA" stats). ──
@router.get("/testcases", response_model=List[TestCaseOut])
async def list_all_testcases(
    status: Optional[str] = None,
    tc_type: Optional[str] = None,
    limit: int = 200,
    db: AsyncSession = Depends(get_db),
):
    query = select(TestCase).order_by(TestCase.created_at.desc()).limit(limit)
    if status:
        query = query.where(TestCase.status == status)
    if tc_type:
        query = query.where(TestCase.tc_type == tc_type)
    result = await db.execute(query)
    return [_tc_to_dict(tc) for tc in result.scalars().all()]


# ── Test Case Generation Agent — standalone direct entry point ───────────────
# Used by the separate Test Case Agent app. Accepts a pasted user story
# directly (no validation gate). If `requirement_id` is supplied (handoff
# from the Requirement Validation Agent), test cases are linked to it;
# otherwise a lightweight "shadow" requirement record is created so the
# test cases have somewhere to attach to and show up in /testcases lists.
@router.post("/testcases/generate-direct", response_model=List[TestCaseOut])
async def generate_testcases_direct(payload: DirectTCGenerateRequest, db: AsyncSession = Depends(get_db)):
    req: Optional[Requirement] = None

    if payload.requirement_id:
        result = await db.execute(select(Requirement).where(Requirement.id == payload.requirement_id))
        req = result.scalar_one_or_none()
        if not req:
            raise HTTPException(404, f"Requirement {payload.requirement_id} not found")
        if req.status != RequirementStatus.VALIDATED.value:
            status_msg = {
                RequirementStatus.REJECTED.value: "is rejected",
                RequirementStatus.REVIEW_NEEDED.value: "needs review — it scored below the approval threshold",
                RequirementStatus.DRAFT.value: "hasn't been validated yet",
                RequirementStatus.VALIDATING.value: "is still being validated",
            }.get(req.status, f"has status '{req.status}'")
            raise HTTPException(400, f"Requirement {status_msg}. Address the gaps and re-validate before generating test cases.")
    else:
        # Create a lightweight shadow requirement so test cases have a parent row.
        req = Requirement(
            id=str(uuid.uuid4()),
            req_id=_gen_req_id(payload.module or ""),
            title=payload.title,
            module=payload.module,
            source_type="testcase_agent_direct",
            story_body=payload.story_body,
            acceptance_criteria=payload.acceptance_criteria,
            edge_cases=payload.edge_cases,
            priority=payload.priority or "P3 - Medium",
            tc_template=payload.template or "Detailed steps",
            tc_type=payload.tc_type or "Positive + Negative",
            status=RequirementStatus.VALIDATED.value,  # bypass gate — direct entry
            missing_params="[]",
            similar_requirements="[]",
        )
        db.add(req)
        await db.commit()
        await db.refresh(req)

    raw_tcs = await run_agent2_generation(
        requirement_id=req.id,
        title=payload.title or req.title or "",
        module=payload.module or req.module or "",
        priority=payload.priority or req.priority or "P3 - Medium",
        story_body=payload.story_body or req.story_body or "",
        acceptance_criteria=payload.acceptance_criteria or req.acceptance_criteria or "",
        edge_cases=payload.edge_cases or req.edge_cases or "",
        template=payload.template or req.tc_template or "Detailed steps",
        tc_type=payload.tc_type or req.tc_type or "Positive + Negative",
        pre_conditions=req.pre_conditions or "",
    )

    created = []
    pos_idx = neg_idx = 1
    for tc_data in raw_tcs:
        tc_type = str(tc_data.get("tc_type", "positive")).lower()
        if tc_type == "positive":
            tc_id = f"TC-POS-{pos_idx:03d}"; pos_idx += 1
        else:
            tc_id = f"TC-NEG-{neg_idx:03d}"; neg_idx += 1

        tc = TestCase(
            id=str(uuid.uuid4()),
            tc_id=tc_id,
            requirement_id=req.id,
            title=tc_data.get("title", "Generated test case"),
            tc_type=tc_type,
            priority=tc_data.get("priority", "High"),
            template=payload.template or "Detailed steps",
            component=payload.module or req.module,
            pre_conditions=tc_data.get("pre_conditions", ""),
            steps=_dumps(tc_data.get("steps", [])),
            step_expected_results=_dumps(tc_data.get("step_expected_results", [])),
            expected_result=tc_data.get("expected_result", ""),
            notes=tc_data.get("notes", ""),
            status=TCStatus.GENERATED.value,
        )
        db.add(tc)
        created.append(tc)

    await db.commit()
    for tc in created:
        await db.refresh(tc)
        try:
            tc_text = f"{tc.title} {' '.join(_loads(tc.steps))} {tc.expected_result}"
            await upsert_testcase(
                tc_id=tc.id,
                text=tc_text,
                metadata={
                    "tc_type": tc.tc_type or "",
                    "module": payload.module or req.module or "",
                    "priority": tc.priority or "",
                    "title": tc.title,
                }
            )
        except Exception as e:
            logger.warning(f"ChromaDB TC upsert skipped: {e}")

    return [_tc_to_dict(tc) for tc in created]


# ── test case actions ─────────────────────────────────────────────────────────

@router.patch("/testcases/{tc_id}", response_model=TestCaseOut)
async def update_testcase(tc_id: str, payload: TCUpdateRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TestCase).where(TestCase.id == tc_id))
    tc = result.scalar_one_or_none()
    if not tc:
        raise HTTPException(404, "Test case not found")

    data = payload.model_dump(exclude_none=True)
    for field, value in data.items():
        if field == "steps":
            setattr(tc, field, _dumps(value))
        else:
            setattr(tc, field, value)

    await db.commit()
    await db.refresh(tc)
    return _tc_to_dict(tc)


@router.post("/testcases/{tc_id}/approve", response_model=TestCaseOut)
async def approve_testcase(tc_id: str, payload: TCActionRequest = TCActionRequest(), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TestCase).where(TestCase.id == tc_id))
    tc = result.scalar_one_or_none()
    if not tc:
        raise HTTPException(404, "Test case not found")
    tc.status = TCStatus.APPROVED.value
    if payload.comment:
        tc.review_comment = payload.comment
    await db.commit()
    await db.refresh(tc)
    return _tc_to_dict(tc)


@router.post("/testcases/{tc_id}/reject", response_model=TestCaseOut)
async def reject_testcase(tc_id: str, payload: TCActionRequest = TCActionRequest(), db: AsyncSession = Depends(get_db)):
    """
    Saves review notes and sets status to UNDER_REVIEW (not REJECTED).
    The UI calls this when a reviewer clicks 'Review' and adds comments.
    UNDER_REVIEW means: 'needs a second look before approval' — it's
    still in play, unlike REJECTED which implies the test case is discarded.
    """
    result = await db.execute(select(TestCase).where(TestCase.id == tc_id))
    tc = result.scalar_one_or_none()
    if not tc:
        raise HTTPException(404, "Test case not found")
    tc.status = TCStatus.UNDER_REVIEW.value
    if payload.comment:
        tc.review_comment = payload.comment
    await db.commit()
    await db.refresh(tc)
    return _tc_to_dict(tc)


_JIRA_ISSUE_KEY_RE = re.compile(r'^([A-Z][A-Z0-9]+)-\d+$')


@router.post("/testcases/{tc_id}/push-to-jira", response_model=TestCaseOut)
async def push_tc_to_jira(tc_id: str, payload: TCActionRequest = TCActionRequest(), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TestCase).where(TestCase.id == tc_id))
    tc = result.scalar_one_or_none()
    if not tc:
        raise HTTPException(404, "Test case not found")

    req_result = await db.execute(select(Requirement).where(Requirement.id == tc.requirement_id))
    requirement = req_result.scalar_one_or_none()

    # Derive the JIRA project from the requirement's own issue key when it
    # was sourced from JIRA (e.g. source_ref "COERSD-37655" -> project
    # "COERSD"); otherwise fall back to the JIRA_PROJECT_KEY setting.
    story_key = None
    project_key = settings.JIRA_PROJECT_KEY or ""
    if requirement and requirement.source_ref:
        m = _JIRA_ISSUE_KEY_RE.match(requirement.source_ref.strip())
        if m:
            story_key = requirement.source_ref.strip()
            project_key = m.group(1)

    try:
        push_result = await push_testcase_to_jira(
            project_key=project_key,
            tc_title=tc.title,
            tc_steps=_loads(tc.steps),
            tc_expected=tc.expected_result or "",
            tc_type=tc.tc_type or "positive",
            story_key=story_key,
        )
        tc.jira_key = push_result.get("jira_key", "")
        tc.status = TCStatus.PUSHED_TO_JIRA.value
        if payload.comment:
            tc.review_comment = payload.comment
        await db.commit()
        await db.refresh(tc)
    except Exception as e:
        fallback_path = _save_tc_fallback_file(tc, requirement, str(e))
        tc.notes = (
            f"{(tc.notes or '').strip()}\n"
            f"[JIRA push failed — saved locally to {fallback_path}]"
        ).strip()
        if payload.comment:
            tc.review_comment = payload.comment
        await db.commit()
        await db.refresh(tc)
        raise HTTPException(
            500,
            f"JIRA push failed: {str(e)}. Test case saved locally to {fallback_path} so it isn't lost.",
        )
    return _tc_to_dict(tc)


# ── JIRA fetch ────────────────────────────────────────────────────────────────

@router.post("/requirements/fetch-jira", response_model=dict)
async def fetch_from_jira(payload: JiraFetchRequest):
    try:
        result = await fetch_jira_story(
            story_url=payload.story_url,
            jira_base_url=payload.jira_base_url,
            jira_email=payload.jira_email,
            jira_api_token=payload.jira_api_token,
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    # Auto-follow any Confluence links found in the ticket's description
    # (e.g. "Additional information available in Confluence page [here]").
    # Failures here never fail the JIRA fetch itself — they're reported
    # back so the UI can show exactly what couldn't be retrieved and why,
    # rather than silently missing content or blocking on a Confluence
    # permission issue when the JIRA fetch itself succeeded fine.
    confluence_links = result.pop("confluence_links", [])
    if confluence_links:
        linked = await fetch_linked_confluence_pages(confluence_links)
        if linked["pages"]:
            confluence_text = "\n\n".join(
                f"[Confluence: {p['title']}]\n{p['text'][:4000]}" for p in linked["pages"]
            )
            # Appended, never replacing — the JIRA-sourced content stays
            # intact even when linked pages add useful extra context.
            result["story_body"] = (result.get("story_body", "") + "\n\n" + confluence_text).strip()
        result["confluence_pages_fetched"] = [p["url"] for p in linked["pages"]]
        result["confluence_fetch_errors"] = linked["errors"]

    return result


# ── Confluence page fetch ("Confluence page" input source) ──────────────────

@router.post("/requirements/fetch-confluence", response_model=dict)
async def fetch_from_confluence(payload: ConfluenceFetchRequest):
    try:
        page = await fetch_confluence_page(
            page_url=payload.page_url,
            confluence_base_url=payload.confluence_base_url,
            confluence_email=payload.confluence_email,
            confluence_api_token=payload.confluence_api_token,
        )
        return {
            "title": page["title"],
            "story_body": page["text"][:6000],  # cap for form population
            "source_ref": page["source_ref"],
            "module": payload.module or "",
        }
    except Exception as e:
        raise HTTPException(400, str(e))


# ── "Other sources" — raw pasted text ────────────────────────────────────────

@router.post("/requirements/from-text", response_model=dict)
async def from_other_source(payload: OtherSourceFetchRequest, db: AsyncSession = Depends(get_db)):
    """
    Generic 'Other sources' input. If as_knowledge=true, index the text into
    the knowledge corpus only. Otherwise, return it so the frontend can
    pre-fill the requirement form (same as paste mode).
    """
    if payload.as_knowledge:
        doc = KnowledgeDocument(
            id=str(uuid.uuid4()),
            filename=payload.title or "pasted-text",
            source_type="text",
            module=payload.module,
            char_count=len(payload.text),
            status="indexed",
        )
        chunk_count = await upsert_knowledge_chunks(
            doc_id=doc.id,
            filename=doc.filename,
            full_text=payload.text,
            metadata={"module": payload.module or "", "source_type": "text"},
        )
        doc.chunk_count = chunk_count
        db.add(doc)
        await db.commit()
        await db.refresh(doc)
        return {"indexed": True, "doc_id": doc.id, "chunks": chunk_count}

    # ── AI-powered field segmentation ────────────────────────────────────────
    # Try to parse the pasted text into structured fields using the LLM.
    # Falls back to dumping everything into story_body if Ollama is unavailable.
    text = payload.text or ""
    title_out = payload.title or ""
    module_out = payload.module or ""

    PARSE_SYSTEM = (
        "You are a QA analyst. Extract structured fields from the pasted requirement text. "
        "Return ONLY a JSON object with these keys: "
        "title (short string), story_body (the 'As a … I want … So that …' sentence), "
        "acceptance_criteria (numbered list as plain text), "
        "edge_cases (comma or newline-separated edge/negative scenarios), "
        "pre_conditions (any pre-conditions mentioned). "
        "If a field is not present in the text, return an empty string for it. "
        "Do NOT invent content — only extract what is explicitly in the text. "
        "NO markdown fences, NO extra keys, ONLY the JSON object."
    )
    PARSE_USER = f"Parse this requirement text into structured fields:\n\n{text[:4000]}"

    try:
        from app.services.ollama_client import get_chat_client, extract_json
        from app.core.config import settings as _cfg
        _client = get_chat_client()
        _resp = await asyncio.wait_for(
            _client.chat.completions.create(
                model=_cfg.OLLAMA_MODEL,
                messages=[
                    {"role": "system", "content": PARSE_SYSTEM},
                    {"role": "user",   "content": PARSE_USER},
                ],
                temperature=0,
            ),
            timeout=30,
        )
        _raw = _resp.choices[0].message.content or ""
        _parsed = extract_json(_raw)

        return {
            "title":                title_out or _parsed.get("title", ""),
            "story_body":           _parsed.get("story_body", text),
            "acceptance_criteria":  _parsed.get("acceptance_criteria", ""),
            "edge_cases":           _parsed.get("edge_cases", ""),
            "pre_conditions":       _parsed.get("pre_conditions", ""),
            "module":               module_out,
        }
    except Exception:
        # Graceful fallback — dump all into story_body
        return {
            "title":               title_out,
            "story_body":          text,
            "acceptance_criteria": "",
            "edge_cases":          "",
            "pre_conditions":      "",
            "module":              module_out,
        }


# ── bulk upload ───────────────────────────────────────────────────────────────

@router.post("/requirements/bulk-upload", response_model=List[RequirementOut], status_code=201)
async def bulk_upload(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    content = await file.read()
    try:
        if file.filename and file.filename.endswith(".csv"):
            df = pd.read_csv(io.StringIO(content.decode("utf-8")))
        else:
            df = pd.read_excel(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(400, f"Could not parse file: {e}")

    col_map = {
        "title":               ["title", "requirement_id", "req_id", "id", "summary",
                                "user story title", "story title", "name"],
        "module":              ["module", "component", "area", "domain", "sap module"],
        "story_body":          ["story_body", "user_story", "user story", "description",
                                "story", "as a", "requirement"],
        "acceptance_criteria": ["acceptance_criteria", "acceptance criteria",
                                "acceptance_criterion", "ac", "criteria"],
        "edge_cases":          ["edge_cases", "edge cases", "edge case",
                                "negative scenarios", "negative cases", "negative_scenarios"],
        "priority":            ["priority", "severity"],
        "pre_conditions":      ["pre_conditions", "pre-conditions", "preconditions",
                                "prerequisites", "pre_condition"],
        "dependencies":        ["dependencies", "dependency", "depends on",
                                "business_rules", "business rules", "notes"],
    }

    def find_col(names):
        for n in names:
            for c in df.columns:
                if c.strip().lower() == n.lower():
                    return c
        return None

    created = []
    for _, row in df.iterrows():
        kwargs = {}
        for field, aliases in col_map.items():
            col = find_col(aliases)
            if col and pd.notna(row.get(col)):
                kwargs[field] = str(row[col])
        # If title still missing, use any first string column as title
        if not kwargs.get("title"):
            for c in df.columns:
                val = str(row.get(c, "") or "").strip()
                if val and val.lower() not in ("nan", "none", ""):
                    kwargs["title"] = val
                    break
        if not kwargs.get("title"):
            continue
        req = Requirement(
            id=str(uuid.uuid4()),
            req_id=_gen_req_id(kwargs.get("module", "")),
            status=RequirementStatus.DRAFT.value,
            missing_params="[]",
            similar_requirements="[]",
            **kwargs,
        )
        db.add(req)
        created.append(req)

    await db.commit()
    for req in created:
        await db.refresh(req)
    return [_req_to_dict(r) for r in created]


# ── Agent 1 — Knowledge Base ("Contextual Knowledge" upload tab) ─────────────
# Uploaded BRD / Word / PDF / Confluence-export files are parsed, chunked, and
# embedded into a SEPARATE ChromaDB collection. They are used only as RAG
# context during Agent 1 validation (query_knowledge in agent1_validation.py)
# — never shown as requirements and never themselves validated.

@router.post("/knowledge/upload", response_model=KnowledgeDocOut, status_code=201)
async def upload_knowledge_doc(
    file: UploadFile = File(...),
    module: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    content = await file.read()
    filename = file.filename or "uploaded-file"

    text = extract_text(filename, content)
    doc = KnowledgeDocument(
        id=str(uuid.uuid4()),
        filename=filename,
        source_type="upload",
        module=module,
        char_count=len(text),
        status="indexed" if text.strip() else "failed",
        error=None if text.strip() else "No text could be extracted from this file",
    )

    if text.strip():
        chunk_count = await upsert_knowledge_chunks(
            doc_id=doc.id,
            filename=filename,
            full_text=text,
            metadata={"module": module or "", "source_type": "upload"},
        )
        doc.chunk_count = chunk_count

    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.post("/knowledge/from-confluence", response_model=KnowledgeDocOut, status_code=201)
async def add_confluence_to_knowledge(payload: ConfluenceFetchRequest, db: AsyncSession = Depends(get_db)):
    """Fetch a Confluence page and index it directly into the knowledge corpus
    (separate from using it to pre-fill a requirement form)."""
    try:
        page = await fetch_confluence_page(
            page_url=payload.page_url,
            confluence_base_url=payload.confluence_base_url,
            confluence_email=payload.confluence_email,
            confluence_api_token=payload.confluence_api_token,
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    doc = KnowledgeDocument(
        id=str(uuid.uuid4()),
        filename=page["title"] or "Confluence page",
        source_type="confluence",
        source_ref=page["source_ref"],
        module=payload.module,
        char_count=len(page["text"]),
        status="indexed",
    )
    chunk_count = await upsert_knowledge_chunks(
        doc_id=doc.id,
        filename=doc.filename,
        full_text=page["text"],
        metadata={"module": payload.module or "", "source_type": "confluence"},
    )
    doc.chunk_count = chunk_count

    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.get("/knowledge", response_model=List[KnowledgeDocOut])
async def list_knowledge_docs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(KnowledgeDocument).order_by(KnowledgeDocument.created_at.desc()))
    return result.scalars().all()


@router.delete("/knowledge/{doc_id}", status_code=204)
async def delete_knowledge(doc_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(KnowledgeDocument).where(KnowledgeDocument.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Knowledge document not found")
    await delete_knowledge_doc(doc_id)
    await db.delete(doc)
    await db.commit()
    return None


# ── Agent 2 — full generation options (V2) ───────────────────────────────────
# Mirrors /testcases/generate-direct but accepts the full options panel:
# tc_types (multi-select categories), complexity, template, naming_convention.

@router.post("/testcases/generate-direct-v2", response_model=List[TestCaseOut])
async def generate_testcases_direct_v2(payload: DirectTCGenerateRequestV2, db: AsyncSession = Depends(get_db)):
    req: Optional[Requirement] = None

    if payload.requirement_id:
        result = await db.execute(select(Requirement).where(Requirement.id == payload.requirement_id))
        req = result.scalar_one_or_none()
        if not req:
            raise HTTPException(404, f"Requirement {payload.requirement_id} not found")
        if req.status != RequirementStatus.VALIDATED.value:
            status_msg = {
                RequirementStatus.REJECTED.value: "is rejected",
                RequirementStatus.REVIEW_NEEDED.value: "needs review — it scored below the approval threshold",
                RequirementStatus.DRAFT.value: "hasn't been validated yet",
                RequirementStatus.VALIDATING.value: "is still being validated",
            }.get(req.status, f"has status '{req.status}'")
            raise HTTPException(400, f"Requirement {status_msg}. Address the gaps and re-validate before generating test cases.")
    else:
        req = Requirement(
            id=str(uuid.uuid4()),
            req_id=_gen_req_id(payload.module or ""),
            title=payload.title,
            module=payload.module,
            source_type="testcase_agent_direct",
            story_body=payload.story_body,
            acceptance_criteria=payload.acceptance_criteria,
            edge_cases=payload.edge_cases,
            priority=payload.priority or "P3 - Medium",
            tc_template=payload.options.template,
            tc_type=", ".join(payload.options.tc_types),
            status=RequirementStatus.VALIDATED.value,
            missing_params="[]",
            similar_requirements="[]",
        )
        db.add(req)
        await db.commit()
        await db.refresh(req)

    try:
        raw_tcs = await asyncio.wait_for(
            run_agent2_generation(
                requirement_id=req.id,
                title=payload.title or req.title or "",
                module=payload.module or req.module or "",
                priority=payload.priority or req.priority or "P3 - Medium",
                story_body=payload.story_body or req.story_body or "",
                acceptance_criteria=payload.acceptance_criteria or req.acceptance_criteria or "",
                edge_cases=payload.edge_cases or req.edge_cases or "",
                template=payload.options.template,
                tc_type="",  # legacy param unused when tc_types provided
                tc_types=payload.options.tc_types,
                complexity=payload.options.complexity,
                naming_convention=payload.options.naming_convention,
                pre_conditions=req.pre_conditions or "",
            ),
            # Inner agent2 has a 90s timeout that triggers the structured fallback
            # generator automatically. This outer timeout is a safety net only.
            timeout=300.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(
            504,
            "Generation timed out. The LLM did not respond within 120 seconds. "
            "This usually means Ollama is not running or the model is not loaded. "
            "Run 'ollama serve' and 'ollama pull llama3.1' in a terminal, then try again."
        )

    created = []
    for tc_data in raw_tcs:
        tc = TestCase(
            id=str(uuid.uuid4()),
            tc_id=tc_data.get("tc_id", "TC_000"),
            requirement_id=req.id,
            title=tc_data.get("title", "Generated test case"),
            tc_type=str(tc_data.get("tc_type", "positive")).lower(),
            priority=tc_data.get("priority", "High"),
            template=payload.options.template,
            component=payload.module or req.module,
            pre_conditions=tc_data.get("pre_conditions", ""),
            steps=_dumps(tc_data.get("steps", [])),
            step_expected_results=_dumps(tc_data.get("step_expected_results", [])),
            expected_result=tc_data.get("expected_result", ""),
            notes=tc_data.get("notes", ""),
            status=TCStatus.GENERATED.value,
        )
        db.add(tc)
        created.append(tc)

    await db.commit()
    for tc in created:
        await db.refresh(tc)
        try:
            tc_text = f"{tc.title} {' '.join(_loads(tc.steps))} {tc.expected_result}"
            await upsert_testcase(
                tc_id=tc.id,
                text=tc_text,
                metadata={
                    "tc_type": tc.tc_type or "",
                    "module": payload.module or req.module or "",
                    "priority": tc.priority or "",
                    "title": tc.title,
                    "naming_convention": payload.options.naming_convention,
                }
            )
        except Exception as e:
            logger.warning(f"ChromaDB TC upsert skipped: {e}")

    # Track token usage for Agent 2
    try:
        last_usage = getattr(run_agent2_generation, "_last_usage", None)
        if last_usage:
            await _track_tokens(db, "agent2", "generate", last_usage, req.id)
    except Exception:
        pass

    # Save Agent 2 pipeline execution log
    try:
        a2_events = getattr(run_agent2_generation, "_last_events", [])
        if a2_events:
            log = PipelineExecutionLog(
                id=str(uuid.uuid4()),
                requirement_id=req.id,
                agent="agent2",
                steps=json.dumps(a2_events),
            )
            db.add(log)
            await db.commit()
    except Exception as e:
        logger.debug(f"Agent2 pipeline log save skipped: {e}")

    return [_tc_to_dict(tc) for tc in created]


# ── Bulk test case generation — generate for every requirement in a batch
# (e.g. everything just validated from a CSV upload) in one action, instead
# of opening each requirement individually. Each requirement is isolated:
# one failure never blocks the rest, and the response reports per-item
# results so the UI can show exactly what succeeded and what didn't. Only
# works against EXISTING requirements (by id) — unlike the single-item v2
# endpoint, there's no "create a new requirement inline" branch here, since
# a batch of new inline requirements isn't a coherent bulk operation. ──────
@router.post("/testcases/bulk-generate", response_model=dict)
async def bulk_generate_testcases(payload: BulkTCGenerateRequestV2, db: AsyncSession = Depends(get_db)):
    all_created = []
    errors = []

    for req_id in payload.requirement_ids:
        try:
            result = await db.execute(select(Requirement).where(Requirement.id == req_id))
            req = result.scalar_one_or_none()
            if not req:
                errors.append({"requirement_id": req_id, "error": "Requirement not found"})
                continue
            if req.status != RequirementStatus.VALIDATED.value:
                status_msg = {
                    RequirementStatus.REJECTED.value: "is rejected",
                    RequirementStatus.REVIEW_NEEDED.value: "needs review — scored below the approval threshold",
                    RequirementStatus.DRAFT.value: "hasn't been validated yet",
                    RequirementStatus.VALIDATING.value: "is still being validated",
                }.get(req.status, f"has status '{req.status}'")
                errors.append({"requirement_id": req_id, "error": f"'{req.title}' {status_msg} — address gaps and re-validate before generating test cases"})
                continue

            raw_tcs = await asyncio.wait_for(
                run_agent2_generation(
                    requirement_id=req.id,
                    title=req.title or "",
                    module=req.module or "",
                    priority=req.priority or "P3 - Medium",
                    story_body=req.story_body or "",
                    acceptance_criteria=req.acceptance_criteria or "",
                    edge_cases=req.edge_cases or "",
                    template=payload.options.template,
                    tc_type="",
                    tc_types=payload.options.tc_types,
                    complexity=payload.options.complexity,
                    naming_convention=payload.options.naming_convention,
                    pre_conditions=req.pre_conditions or "",
                ),
                timeout=240.0,
            )

            created = []
            for tc_data in raw_tcs:
                tc = TestCase(
                    id=str(uuid.uuid4()),
                    tc_id=tc_data.get("tc_id", "TC_000"),
                    requirement_id=req.id,
                    title=tc_data.get("title", "Generated test case"),
                    tc_type=str(tc_data.get("tc_type", "positive")).lower(),
                    priority=tc_data.get("priority", "High"),
                    template=payload.options.template,
                    component=req.module,
                    pre_conditions=tc_data.get("pre_conditions", ""),
                    steps=_dumps(tc_data.get("steps", [])),
                    step_expected_results=_dumps(tc_data.get("step_expected_results", [])),
                    expected_result=tc_data.get("expected_result", ""),
                    notes=tc_data.get("notes", ""),
                    status=TCStatus.GENERATED.value,
                )
                db.add(tc)
                created.append(tc)

            await db.commit()
            for tc in created:
                await db.refresh(tc)
                try:
                    tc_text = f"{tc.title} {' '.join(_loads(tc.steps))} {tc.expected_result}"
                    await upsert_testcase(
                        tc_id=tc.id,
                        text=tc_text,
                        metadata={
                            "tc_type": tc.tc_type or "",
                            "module": req.module or "",
                            "priority": tc.priority or "",
                            "title": tc.title,
                            "naming_convention": payload.options.naming_convention,
                        }
                    )
                except Exception as e:
                    logger.warning(f"ChromaDB TC upsert skipped: {e}")

            all_created.extend([_tc_to_dict(tc) for tc in created])

        except asyncio.TimeoutError:
            errors.append({"requirement_id": req_id, "error": "Generation timed out after 170 seconds"})
        except Exception as e:
            errors.append({"requirement_id": req_id, "error": str(e)})
            logger.error(f"Bulk generate failed for {req_id}: {e}")

    return {"testcases": all_created, "errors": errors}

"""
Agent 1 — Requirement Validation
Uses unified LLM client — Anthropic Claude API (default) or local Ollama.
RAG context is retrieved from ChromaDB using nomic-embed-text embeddings.
"""
from app.core.config import settings
from app.services.llm_client import call_llm, extract_json
from app.services.vector_store import query_similar_requirements, query_knowledge
from app.models.schemas import ScoreDetail
from typing import List
import logging

logger = logging.getLogger(__name__)

# ── System prompt ─────────────────────────────────────────────────────────────
# Kept tightly structured so Llama / Mistral stay on-track with the JSON schema.
VALIDATION_SYSTEM_PROMPT = """You are a QA expert. Validate the requirement below. Return ONLY a JSON object — no markdown, no explanation.

{
  "scores": {
    "completeness": <0-10>,
    "ac_presence":  <0-10>,
    "edge_coverage":<0-10>,
    "clarity":      <0-10>,
    "testability":  <0-10>
  },
  "missing_params": [{"param":"<name>","severity":"high|medium|low","detail":"<specific gap>"}],
  "suggestions": "<2-3 specific actionable improvements referencing actual content>",
  "quality_gate": "validated|review_needed|rejected"
}

SCORING (strict):
- completeness: +2 each for "As a", "I want", "So that", description≥30 words, any pre-conditions text
- ac_presence:  +4 if ≥3 AC lines, +3 if measurable, +3 if no vague words
- edge_coverage:+4 if ≥2 negative/boundary scenarios, +3 if error states noted, +3 if ≥4 edge lines
- clarity:      +4 no undefined acronyms, +3 unambiguous, +3 if any pre-conditions text
- testability:  +4 each AC maps to a test, +3 measurable outcomes, +3 no untestable absolutes

AUTO-AWARD: pre-conditions ANY text → completeness+2 AND clarity+3. Edge cases ≥3 lines → edge_coverage≥7.
MISSING_PARAMS: max 3 items. Never flag as missing if mentioned anywhere in any field.
QUALITY GATE: total≥40=validated, 25-39=review_needed, <25=rejected
Use KNOWLEDGE CONTEXT to fill gaps and raise scores if relevant.
"""


VALIDATION_USER_TEMPLATE = """\
Validate this requirement and return the JSON object only.

TITLE: {title}
MODULE: {module}

USER STORY:
{story_body}

ACCEPTANCE CRITERIA:
{ac}

EDGE CASES:
{edge_cases}

PRE-CONDITIONS:
{pre_conditions}

SIMILAR VALIDATED REQUIREMENTS FROM PAST CORPUS:
{similar_reqs}

RELEVANT CONTEXT FROM UPLOADED BRD / CONFLUENCE / WORD DOCS:
{knowledge_context}
"""


async def run_agent1_validation(
    title: str,
    module: str,
    story_body: str,
    acceptance_criteria: str,
    edge_cases: str,
    pre_conditions: str,
) -> ScoreDetail:
    import time
    events = []

    def _event(step: int, label: str, detail: str, status: str = "done",
                tokens: int = 0, latency_ms: int = 0, retrieved: int = 0):
        events.append({
            "step": step, "label": label, "detail": detail,
            "status": status, "tokens": tokens,
            "latency_ms": latency_ms, "retrieved": retrieved,
            "ts": time.time(),
        })

    _event(1, "Requirement Parsing", f"Title: {title[:60]} | Module: {module} | "
           f"Fields: story_body={bool(story_body)}, AC={bool(acceptance_criteria)}, "
           f"edge_cases={bool(edge_cases)}, pre_conditions={bool(pre_conditions)}")

    # RAG: fetch similar past requirements for few-shot context
    t0 = time.monotonic()
    full_text = f"{title} {story_body} {acceptance_criteria}"
    similar_reqs = await query_similar_requirements(full_text, n_results=3)
    similar_text = "\n".join([
        f"- [{r['metadata'].get('title','?')}] score={r['metadata'].get('score_total','?')}/50 | {r['document'][:180]}"
        for r in similar_reqs
    ]) or "No similar requirements in corpus yet."
    _event(2, "Text Embedding (nomic-embed-text)",
           f"Embedded requirement text → 768-dim vector | Used for similarity search",
           latency_ms=int((time.monotonic()-t0)*1000))

    # RAG: fetch relevant chunks from uploaded BRD/Confluence/Word docs
    t0 = time.monotonic()
    knowledge_chunks = await query_knowledge(full_text, n_results=4)
    knowledge_text = "\n".join([
        f"- [{k['metadata'].get('filename','?')}] {k['document'][:220]}"
        for k in knowledge_chunks
    ]) or "No uploaded knowledge documents relevant to this requirement."
    _event(3, "Knowledge Base RAG (ChromaDB)",
           f"Retrieved {len(knowledge_chunks)} relevant chunk(s) from uploaded BRDs/docs via cosine similarity",
           retrieved=len(knowledge_chunks), latency_ms=int((time.monotonic()-t0)*1000))

    _event(4, "Similar Requirements RAG (ChromaDB)",
           f"Retrieved {len(similar_reqs)} similar past requirement(s) as few-shot context",
           retrieved=len(similar_reqs))

    _event(5, "Context Builder",
           f"Combined: requirement fields + {len(knowledge_chunks)} knowledge chunks + "
           f"{len(similar_reqs)} similar requirements → prompt assembled")

    user_msg = VALIDATION_USER_TEMPLATE.format(
        title=title or "Not provided",
        module=module or "Not specified",
        story_body=story_body or "Not provided",
        ac=acceptance_criteria or "Not provided",
        edge_cases=edge_cases or "Not provided",
        pre_conditions=pre_conditions or "Not provided",
        similar_reqs=similar_text,
        knowledge_context=knowledge_text,
    )

    client = None  # unused — kept for compat
    try:
        t0 = time.monotonic()
        llm_resp = await call_llm(
            system=VALIDATION_SYSTEM_PROMPT,
            user=user_msg,
            temperature=0,
            timeout=480.0,
            agent="agent1",
        )
        raw = llm_resp.content
        # Store usage for token tracking
        run_agent1_validation._last_usage = llm_resp
        logger.debug(f"Agent1 raw response: {raw[:300]}")
        data = extract_json(raw)

        _event(6, f"LLM Scoring (Qwen3:8b)",
               f"Prompt tokens: {llm_resp.prompt_tokens} | Completion: {llm_resp.completion_tokens} | "
               f"Latency: {llm_resp.latency_ms}ms",
               tokens=llm_resp.total_tokens, latency_ms=llm_resp.latency_ms)

        scores = data.get("scores", {})
        comp    = float(scores.get("completeness",  0))
        ac      = float(scores.get("ac_presence",   0))
        edge    = float(scores.get("edge_coverage", 0))
        clarity = float(scores.get("clarity",       0))
        test    = float(scores.get("testability",   0))
        total   = round(comp + ac + edge + clarity + test, 1)

        gate = "validated" if total >= 40 else "review_needed" if total >= 25 else "rejected"

        _event(7, "Score Calculation & Quality Gate",
               f"Total: {total}/50 | Gate: {gate.upper()} | "
               f"Completeness:{comp} AC:{ac} Edge:{edge} Clarity:{clarity} Testability:{test}")

        # Store events for pipeline log endpoint
        run_agent1_validation._last_events = events

        suggestions_raw = data.get("suggestions", "")
        if isinstance(suggestions_raw, list):
            suggestions_raw = " ".join(str(s) for s in suggestions_raw)

        return ScoreDetail(
            completeness=round(comp, 1),
            ac_presence=round(ac, 1),
            edge_coverage=round(edge, 1),
            clarity=round(clarity, 1),
            testability=round(test, 1),
            total=total,
            quality_gate=gate,
            missing_params=data.get("missing_params", []),
            ai_suggestions=suggestions_raw,
            similar_requirements=[
                {
                    "title": r["metadata"].get("title", ""),
                    "similarity": r["similarity"],
                    "similarity_reliable": r.get("similarity_reliable", True),
                }
                for r in similar_reqs
            ],
        )

    except Exception as e:
        import asyncio as _asyncio
        err_str = str(e) or type(e).__name__
        # asyncio.TimeoutError has no .args — make it readable
        if isinstance(e, (_asyncio.TimeoutError, TimeoutError)) or "TimeoutError" in type(e).__name__:
            err_str = "timeout"
        logger.error(f"Agent 1 LLM error: {type(e).__name__}: {err_str}", exc_info=True)
        result = _rule_based_score(title, story_body, acceptance_criteria, edge_cases, pre_conditions)
        if "timeout" in err_str.lower():
            msg = ("⚠️ LLM timed out — qwen2.5:7b is still processing on your machine. "
                   "Rule-based scores shown. Try re-validating once (model loads faster on second call). "
                   "If this keeps happening, the requirement may be too long — try splitting it.")
        elif "ANTHROPIC_API_KEY" in err_str or "not set" in err_str or "your-" in err_str:
            msg = ("⚠️ Anthropic API key not configured. Open backend/.env, set "
                   "ANTHROPIC_API_KEY=sk-ant-... (from console.anthropic.com), "
                   "then restart run_backend.bat. Showing rule-based scores for now.")
        elif "401" in err_str or "invalid" in err_str.lower():
            msg = "⚠️ Anthropic API key is invalid — check ANTHROPIC_API_KEY in backend/.env. Showing rule-based scores."
        elif "connect" in err_str.lower() or "refused" in err_str.lower():
            msg = "⚠️ Cannot reach Ollama — is it still running? Check the terminal window. Showing rule-based scores."
        else:
            msg = f"⚠️ LLM error ({type(e).__name__}): {err_str[:150]}. Showing rule-based scores."
        return result.model_copy(update={"ai_suggestions": msg})


# ── Rule-based fallback (no LLM needed) ──────────────────────────────────────
def _rule_based_score(title, story_body, ac_text, edge_cases, pre_conditions="") -> ScoreDetail:
    body  = (story_body or "").lower()
    ac    = ac_text or ""
    edges = edge_cases or ""
    pre   = (pre_conditions or "").strip()

    has_pre = bool(pre)
    comp  = (2 if "as a"    in body else 0) + \
            (2 if "i want"  in body else 0) + \
            (2 if "so that" in body else 0) + \
            (2 if len(body.split()) >= 30 else 1 if len(body.split()) >= 15 else 0) + \
            (2 if has_pre else 0)

    ac_lines  = [l.strip() for l in ac.splitlines() if l.strip()]
    ac_score  = min(10, len(ac_lines) * 3)

    # Support both comma-separated and newline-separated edge cases
    if "\n" in edges:
        edge_list = [e.strip() for e in edges.splitlines() if e.strip()]
    else:
        edge_list = [e.strip() for e in edges.split(",") if e.strip()]
    edge_score = min(10, 7 if len(edge_list) >= 3 else len(edge_list) * 4)

    vague_words = any(w in (body + ac).lower() for w in ["should try","may ","nice to have","acceptable"])
    clarity  = (4 if not vague_words else 2) + (3 if has_pre else 0) + 3
    clarity  = min(10, clarity)
    test     = min(10, len(ac_lines) * 2 + len(edge_list))

    total = comp + ac_score + edge_score + clarity + test

    missing = []
    if "as a"   not in body: missing.append({"param": "Role (As a)",           "severity": "high",   "detail": "Add 'As a <role>' to define who this is for"})
    if "i want" not in body: missing.append({"param": "Goal (I want)",          "severity": "high",   "detail": "Add 'I want to <action>' to state the goal"})
    if "so that" not in body: missing.append({"param": "Benefit (So that)",     "severity": "medium", "detail": "Add 'So that <benefit>' to state business value"})
    if len(ac_lines) < 3:    missing.append({"param": "Acceptance Criteria",    "severity": "high",   "detail": f"{len(ac_lines)} AC line(s) found — need ≥3 measurable criteria"})
    if len(edge_list) < 2:   missing.append({"param": "Edge Cases",             "severity": "medium", "detail": "Add ≥2 negative/boundary scenarios"})
    if vague_words:          missing.append({"param": "Vague language",         "severity": "medium", "detail": "Replace 'should/may/acceptable' with measurable outcomes"})

    return ScoreDetail(
        completeness=round(comp, 1),
        ac_presence=round(ac_score, 1),
        edge_coverage=round(edge_score, 1),
        clarity=round(clarity, 1),
        testability=round(test, 1),
        total=round(total, 1),
        quality_gate="validated" if total >= 40 else "review_needed" if total >= 25 else "rejected",
        missing_params=missing,
        ai_suggestions=(
            "Ollama is not reachable — rule-based scoring used. "
            "Start Ollama (`ollama serve`) and pull the model (`ollama pull llama3.1`) "
            "for AI-generated suggestions."
        ),
        similar_requirements=[],
    )

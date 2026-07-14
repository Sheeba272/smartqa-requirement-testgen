"""
Agent 2 — Test Case Generation
Uses unified LLM client — Anthropic Claude API (default) or local Ollama.
Past Zephyr test cases + naming conventions are retrieved via ChromaDB RAG.
"""
from app.core.config import settings
from app.services.llm_client import call_llm, extract_json
from app.services.vector_store import query_similar_testcases, query_knowledge
from typing import List, Dict, Any, Optional
import logging
import re
import time as _time

logger = logging.getLogger(__name__)

# ── Counts per category, scaled by complexity ────────────────────────────────
COMPLEXITY_COUNTS = {
    "simple":   {"positive": 1, "negative": 1, "boundary": 1, "error_handling": 1, "integration": 1},
    "medium":   {"positive": 2, "negative": 2, "boundary": 1, "error_handling": 1, "integration": 1},
    "detailed": {"positive": 3, "negative": 2, "boundary": 2, "error_handling": 2, "integration": 1},
}

COMPLEXITY_STEP_GUIDANCE = {
    "simple":   "3-4 high-level steps. Brief expected result (1 sentence).",
    "medium":   "4-6 steps with specific field names and example values. Expected result with 1-2 verification points.",
    "detailed": "6-10 granular steps including exact SAP T-codes, field names, sample data values, and navigation paths. Expected result with multiple verification points (data state, UI confirmation, downstream effects).",
}

TEMPLATE_GUIDANCE = {
    "Detailed Test Case": (
        "Standard structured format: Title, Pre-conditions, numbered Steps, Expected Result. "
        "Each field returned as plain text/list in the JSON schema below."
    ),
    "BDD Format": (
        "Write 'steps' as Gherkin Given/When/Then lines, e.g. "
        "'Given the user is on the login page', 'When they enter valid credentials', "
        "'Then they are redirected to the dashboard'. expected_result restates the Then outcomes."
    ),
    "Organization Template": (
        "Follow a corporate QA template: Title, Objective (1 line, goes in notes), "
        "Pre-conditions, Test Steps (numbered, action + data), Expected Result, "
        "Post-conditions (append to notes)."
    ),
    "Zephyr Template": (
        "Match Zephyr Scale's test step structure: each step has an implicit "
        "Action / Test Data / Expected Result triple — encode each step as "
        "'Action: ... | Test Data: ... | Expected: ...'."
    ),
}

TC_TYPE_DESCRIPTIONS = {
    "positive":       "Happy-path and valid-boundary scenarios that SUCCEED.",
    "negative":       "Invalid input, missing mandatory fields, wrong format — system correctly REJECTS.",
    "boundary":       "Min/max values, exact limits, off-by-one (e.g. character limits, quantity thresholds, date ranges).",
    "error_handling": "System/network errors, timeouts, unexpected interruptions, partial failures — verify graceful error messages and no data corruption.",
    "integration":    "Cross-module / cross-system effects (e.g. SAP MM action triggers FI posting, or API call updates a downstream system).",
}

TC_SYSTEM_PROMPT_TEMPLATE = """You are a senior QA engineer. Generate structured test cases from user stories.
RESPOND WITH ONLY valid JSON — no markdown, no explanation, nothing else.

{{
  "test_cases": [
    {{
      "tc_id": "{naming_example}",
      "title": "<short title>",
      "tc_type": "positive|negative|boundary|error_handling|integration",
      "priority": "Critical|High|Medium|Low",
      "pre_conditions": "<prerequisites>",
      "steps": ["Step 1: Navigate to ...", "Step 2: Enter ...", "Step 3: Verify ..."],
      "step_expected_results": ["", "", "<specific measurable outcome>"],
      "expected_result": "<overall: exact system behaviour>",
      "notes": "<SAP T-code or N/A>"
    }}
  ]
}}

CRITICAL RULES:
- step_expected_results MUST match steps array length exactly.
- Navigation/input steps: use "" unless there is a specific intermediate check.
- Verify/check steps MUST have a specific, measurable expected result — never "".
- The LAST step must always have a non-empty expected result.
- tc_type must be exactly: positive, negative, boundary, error_handling, or integration.
- expected_result must be specific — never "works correctly".
- Generate EXACTLY the count requested per category.

TEMPLATE: {template} — {template_guidance}
COMPLEXITY: {complexity} — {complexity_guidance}
NAMING: {naming_convention}
CATEGORIES: {category_definitions}
"""


TC_USER_TEMPLATE = """\
Generate test cases for this requirement with these EXACT counts per category:
{counts_text}

TITLE: {title}
MODULE: {module}
PRIORITY: {priority}

USER STORY:
{story_body}

ACCEPTANCE CRITERIA:
{ac}

EDGE CASES TO COVER:
{edge_cases}

ENTERPRISE KNOWLEDGE CONTEXT (from uploaded BRDs/Confluence docs — use for SAP-specific details):
{knowledge_context}

SIMILAR PAST TEST CASES (style/naming reference):
{similar_tcs}

Return the JSON object with a "test_cases" array only. No other text.
"""


def _naming_example(pattern: str) -> str:
    """Given e.g. 'TC_Login_001', produce a plausible first example id."""
    pattern = (pattern or "TC_Module_001").strip()
    if re.search(r'\d+$', pattern):
        return pattern
    return f"{pattern}_001"


async def run_agent2_generation(
    requirement_id: str,
    title: str,
    module: str,
    priority: str,
    story_body: str,
    acceptance_criteria: str,
    edge_cases: str,
    template: str,
    tc_type: str,
    tc_types: Optional[List[str]] = None,
    complexity: str = "medium",
    naming_convention: str = "TC_Module_001",
    pre_conditions: str = "",
) -> List[Dict[str, Any]]:

    complexity = (complexity or "medium").lower()
    if complexity not in COMPLEXITY_COUNTS:
        complexity = "medium"

    # Determine which categories to generate
    if tc_types:
        categories = [c.lower() for c in tc_types if c.lower() in COMPLEXITY_COUNTS["medium"]]
    else:
        # Backward-compat: derive from legacy tc_type string
        categories = _legacy_categories(tc_type)

    if not categories:
        categories = ["positive", "negative"]

    counts = {cat: COMPLEXITY_COUNTS[complexity][cat] for cat in categories}
    counts_text = "\n".join([f"- {cat}: {n} test case(s)" for cat, n in counts.items()])

    category_definitions = "\n".join([
        f"- {cat}: {TC_TYPE_DESCRIPTIONS.get(cat, '')}" for cat in categories
    ])

    template = template if template in TEMPLATE_GUIDANCE else "Detailed Test Case"

    full_text = f"{title} {story_body} {acceptance_criteria}"

    # ── Pipeline event tracking ───────────────────────────────────────────────
    events = []
    def _event(step, label, detail, tokens=0, latency_ms=0, retrieved=0):
        events.append({"step": step, "label": label, "detail": detail,
                       "status": "done", "tokens": tokens,
                       "latency_ms": latency_ms, "retrieved": retrieved,
                       "ts": _time.time()})

    _event(1, "Requirement Parsing",
           f"Title: {title[:60]} | Module: {module} | "
           f"Categories: {', '.join(categories)} | Complexity: {complexity}")

    # ── RAG Step 1: Similar past test cases (few-shot examples) ──────────────
    t0 = _time.monotonic()
    similar_tcs = await query_similar_testcases(full_text, module=module, n_results=4)
    similar_text = "\n".join([
        f"- [{tc['metadata'].get('tc_type','?')}] {tc['document'][:120]}"
        for tc in similar_tcs[:3]
    ]) or "No similar test cases yet."
    _event(2, "Text Embedding (nomic-embed-text)",
           f"Embedded requirement text → 768-dim vector for similarity search",
           latency_ms=int((_time.monotonic()-t0)*1000))
    _event(3, "Similar Test Cases RAG (ChromaDB)",
           f"Retrieved {len(similar_tcs)} similar past test case(s) as few-shot examples",
           retrieved=len(similar_tcs), latency_ms=int((_time.monotonic()-t0)*1000))

    # ── RAG Step 2: Knowledge base (BRD/Confluence docs) ─────────────────────
    t0 = _time.monotonic()
    knowledge_chunks = await query_knowledge(full_text, n_results=4)
    knowledge_text = "\n".join([
        f"- [{k['metadata'].get('filename','?')}] {k['document'][:150]}"
        for k in knowledge_chunks[:3]
    ]) or "No knowledge docs uploaded."
    _event(4, "Knowledge Base RAG (ChromaDB)",
           f"Retrieved {len(knowledge_chunks)} relevant chunk(s) from uploaded BRDs/Confluence docs",
           retrieved=len(knowledge_chunks), latency_ms=int((_time.monotonic()-t0)*1000))

    _event(5, "Context Builder",
           f"Combined: requirement fields + {len(knowledge_chunks)} knowledge chunks + "
           f"{len(similar_tcs)} similar test cases → prompt assembled for DeepSeek-R1")

    system_prompt = TC_SYSTEM_PROMPT_TEMPLATE.format(
        naming_example=_naming_example(naming_convention),
        template=template,
        template_guidance=TEMPLATE_GUIDANCE[template],
        complexity=complexity,
        complexity_guidance=COMPLEXITY_STEP_GUIDANCE[complexity],
        naming_convention=naming_convention or "TC_Module_001",
        category_definitions=category_definitions,
    )

    user_msg = TC_USER_TEMPLATE.format(
        counts_text=counts_text,
        title=title or "Untitled",
        module=module or "General",
        priority=priority or "P3 - Medium",
        story_body=story_body or "Not provided",
        ac=acceptance_criteria or "Not provided",
        edge_cases=edge_cases or "Not specified",
        knowledge_context=knowledge_text,
        similar_tcs=similar_text,
    )

    # ── Step 1: Call the LLM — ONLY this can trigger the fallback path ─────────
    llm_resp = None
    llm_error = None
    try:
        import asyncio as _asyncio
        llm_resp = await _asyncio.wait_for(
            call_llm(
                system=system_prompt,
                user=user_msg,
                temperature=0.2,
                timeout=480.0,
                agent="agent2",
            ),
            timeout=540.0,
        )
        run_agent2_generation._last_usage = llm_resp
        logger.debug(f"Agent2 raw response: {llm_resp.content[:400]}")
        _event(6, f"LLM Generation ({settings.OLLAMA_MODEL_AGENT2})",
               f"Prompt tokens: {llm_resp.prompt_tokens} | Completion: {llm_resp.completion_tokens} | "
               f"Latency: {llm_resp.latency_ms}ms",
               tokens=llm_resp.total_tokens, latency_ms=llm_resp.latency_ms)
    except Exception as e:
        llm_error = e
        logger.error(f"Agent 2 LLM call failed: {e}")

    if llm_error is not None:
        # Genuine LLM failure (Ollama down, timeout, etc) — use fallback
        fallback = _fallback_testcases(title, template, counts, naming_convention, module,
                                    acceptance_criteria, edge_cases, story_body, pre_conditions,
                                    error_reason=str(llm_error))
        _event(6, "LLM Generation — Fallback",
               f"{settings.OLLAMA_MODEL_AGENT2} unavailable ({str(llm_error)[:80]}). Using structured fallback generator.")
        _event(7, "Fallback Test Cases Generated",
               f"Generated {len(fallback)} structured test case(s) without LLM")
        run_agent2_generation._last_events = events
        return fallback

    # ── Step 2: Parse the LLM response — failures here are PARSING bugs, ───────
    # not "AI unavailable". The LLM succeeded; don't mislabel a parsing issue
    # as a model-availability issue, and don't silently discard a successful
    # generation by falling back to templates.
    try:
        data = extract_json(llm_resp.content)

        result = []
        if isinstance(data, list):
            result = data
        elif isinstance(data, dict):
            if "test_cases" in data:
                result = data["test_cases"]
            else:
                candidates = [v for v in data.values() if isinstance(v, (list, dict))]
                if candidates and isinstance(candidates[0], list):
                    result = candidates[0]
                elif candidates and isinstance(candidates[0], dict):
                    result = list(data.values())

        if not result:
            # LLM responded but JSON had no usable test cases — log the raw
            # response so this is debuggable, then fall back (this IS a
            # legitimate fallback case — empty result from a working LLM).
            logger.warning(f"Agent2: LLM responded but no test_cases parsed. Raw (first 500): {llm_resp.content[:500]}")
            fallback = _fallback_testcases(title, template, counts, naming_convention, module,
                                        acceptance_criteria, edge_cases, story_body, pre_conditions,
                                        error_reason="LLM response did not contain a usable test_cases array")
            _event(7, "Fallback — Could Not Parse LLM Output",
                   f"LLM responded ({llm_resp.total_tokens} tokens) but JSON had no test cases. Using fallback.")
            run_agent2_generation._last_events = events
            return fallback

        named = _apply_naming_convention(result, naming_convention, module)
        _event(7, "Test Cases Structured & Named",
               f"Generated {len(named)} test case(s) | Categories: {', '.join(set(tc.get('tc_type','?') for tc in named))} | "
               f"Template: {template} | Naming: {naming_convention}")
        run_agent2_generation._last_events = events
        return named

    except Exception as e:
        # A real bug in our own parsing code, not an LLM availability issue.
        # Log it loudly so it's never silently mistaken for "Ollama is down".
        logger.error(f"Agent 2 POST-PROCESSING error (LLM succeeded, parsing failed): {e}", exc_info=True)
        fallback = _fallback_testcases(title, template, counts, naming_convention, module,
                                    acceptance_criteria, edge_cases, story_body, pre_conditions,
                                    error_reason=f"Response parsing error (LLM responded fine): {e}")
        _event(7, "Fallback — Internal Parsing Error",
               f"LLM call succeeded but result processing failed: {str(e)[:100]}")
        run_agent2_generation._last_events = events
        return fallback


def _legacy_categories(tc_type: str) -> List[str]:
    t = (tc_type or "").lower()
    if "positive only" in t:
        return ["positive"]
    if "negative only" in t:
        return ["negative"]
    if "positive + negative + edge" in t:
        return ["positive", "negative", "boundary"]
    return ["positive", "negative"]


def _apply_naming_convention(cases: List[Dict], naming_convention: str, module: str) -> List[Dict]:
    """Re-number tc_ids per category, normalise tc_type, and guarantee
    step_expected_results is always same length as steps with last step filled."""
    base = (naming_convention or "TC_Module_001").strip()
    prefix_match = re.match(r'^(.*?)(\d+)$', base)
    prefix = prefix_match.group(1) if prefix_match else f"{base}_"
    if not prefix.endswith(("_", "-")):
        prefix += "_"

    counters: Dict[str, int] = {}
    valid_types = set(COMPLEXITY_COUNTS["medium"].keys())

    for case in cases:
        # ── Fix tc_type ───────────────────────────────────────────────────────
        tc_type = str(case.get("tc_type", "positive")).lower().replace(" ", "_")
        if tc_type not in valid_types:
            tc_type = "positive"
        case["tc_type"] = tc_type

        # ── Fix tc_id ─────────────────────────────────────────────────────────
        counters[tc_type] = counters.get(tc_type, 0) + 1
        type_tag = tc_type.upper().replace("_", "")
        case["tc_id"] = f"{prefix}{type_tag}_{counters[tc_type]:03d}"

        # ── Fix step_expected_results ─────────────────────────────────────────
        steps = case.get("steps") or []
        ser = case.get("step_expected_results") or []
        if not isinstance(ser, list):
            ser = []
        # Pad or trim to match steps length
        while len(ser) < len(steps):
            ser.append("")
        ser = ser[:len(steps)]
        # Guarantee last step always has a meaningful result
        if steps and not ser[-1]:
            ser[-1] = case.get("expected_result") or (
                f"The system completes the operation successfully for: {case.get('title', 'this scenario')}")
        case["step_expected_results"] = ser

    return cases


def _parse_ac_lines(acceptance_criteria: str) -> List[str]:
    """Split AC text into individual criteria lines, stripping numbering/bullets."""
    if not acceptance_criteria:
        return []
    lines = []
    for raw_line in acceptance_criteria.replace("\r", "").split("\n"):
        line = raw_line.strip()
        line = re.sub(r'^[\d]+[\.\)]\s*', '', line)   # "1. " / "1) "
        line = re.sub(r'^[-•*]\s*', '', line)          # "- " / "• " / "* "
        if line:
            lines.append(line)
    return lines


def _parse_edge_lines(edge_cases: str) -> List[str]:
    """Split edge-case text into individual scenario phrases (comma or newline separated)."""
    if not edge_cases:
        return []
    text = edge_cases.replace("\r", "")
    if "\n" in text:
        parts = [p.strip() for p in text.split("\n")]
    else:
        parts = [p.strip() for p in text.split(",")]
    parts = [re.sub(r'^[\d]+[\.\)]\s*|^[-•*]\s*', '', p) for p in parts]
    return [p for p in parts if p]


def _fallback_testcases(title: str, template: str, counts: Dict[str, int],
                         naming_convention: str, module: str,
                         acceptance_criteria: str = "", edge_cases: str = "",
                         story_body: str = "", pre_conditions: str = "",
                         error_reason: str = "") -> List[Dict]:
    """
    Returned when Ollama is unreachable. Builds steps and expected results
    from the requirement's own acceptance criteria / edge cases where
    available, instead of pure generic placeholders — so output is at
    least specific to THIS requirement even without an LLM.
    """
    ac_lines = _parse_ac_lines(acceptance_criteria)
    edge_lines = _parse_edge_lines(edge_cases)
    # Use the requirement's OWN pre-conditions field if the user provided
    # one — never truncated story_body text, which reads as a dumped
    # paragraph rather than an actual precondition (e.g. showing "As an
    # Order Management Specialist, I want the system to..." where a real
    # precondition like "User has an active sales order session" belongs).
    pre_condition = pre_conditions.strip() if pre_conditions and pre_conditions.strip() \
        else "User is authenticated with the required role and has access to the relevant module"

    # "Navigate to the relevant screen" on its own says nothing useful —
    # build an actual reference using the module and/or title we already
    # have, so the step at least names something concrete even without an
    # LLM to generate true UI-specific navigation (e.g. an exact T-code).
    if module and title:
        screen_ref = f"the {module} screen/transaction for \"{title}\""
    elif module:
        screen_ref = f"the {module} screen/transaction"
    elif title:
        screen_ref = f"the screen/transaction used for \"{title}\""
    else:
        screen_ref = "the relevant screen / transaction code"

    cases: List[Dict] = []
    ac_idx = 0
    edge_idx = 0

    for cat, n in counts.items():
        for i in range(n):
            if cat == "positive":
                ac_text = ac_lines[ac_idx % len(ac_lines)] if ac_lines else "the system behaves as described in the user story"
                ac_idx += 1
                steps = [
                    f"Step 1: Navigate to {screen_ref}",
                    f"Step 2: Enter valid data so that: {ac_text}",
                    "Step 3: Submit or save the transaction",
                    f"Step 4: Verify that: {ac_text}",
                ]
                step_expected = [
                    f"The {screen_ref.split('for')[0].strip()} screen opens successfully and is accessible to the user",
                    "All mandatory fields accept valid input without validation errors",
                    "Transaction is accepted and processing begins; no error message is shown",
                    f"The system satisfies the acceptance criterion: \"{ac_text}\". Confirmation displayed, data saved correctly.",
                ]
                expected = f"The system satisfies the acceptance criterion: \"{ac_text}\". Confirmation displayed, data saved correctly."
                ttl = f"Verify: {ac_text}" if ac_lines else f"Positive scenario — {title}"

            elif cat == "negative":
                edge_text = edge_lines[edge_idx % len(edge_lines)] if edge_lines else "invalid, missing, or out-of-range data"
                edge_idx += 1
                steps = [
                    f"Step 1: Navigate to {screen_ref}",
                    f"Step 2: Enter or trigger condition: {edge_text}",
                    "Step 3: Attempt to submit the transaction",
                    "Step 4: Observe the system response",
                ]
                step_expected = [
                    f"The {screen_ref.split('for')[0].strip()} screen opens successfully",
                    "Field accepts the input; validation will occur on submission",
                    f"System performs validation check for: {edge_text}",
                    f"System rejects the request for \"{edge_text}\" with a clear, descriptive error message. Transaction is blocked; no data is saved or partially committed.",
                ]
                expected = f"The system rejects the case \"{edge_text}\" with a clear error message. Transaction is blocked, no data is saved."
                ttl = f"Negative scenario — {edge_text}" if edge_lines else f"Negative scenario — {title}"

            elif cat == "boundary":
                edge_text = edge_lines[edge_idx % len(edge_lines)] if edge_lines else "a value at the exact minimum or maximum allowed limit"
                edge_idx += 1
                steps = [
                    f"Step 1: Navigate to {screen_ref}",
                    f"Step 2: Enter a value at the boundary related to: {edge_text}",
                    "Step 3: Submit the transaction",
                    "Step 4: Verify the system accepts or rejects exactly at the boundary as specified",
                ]
                step_expected = [
                    "Screen opens and is accessible to the user",
                    f"Boundary value for \"{edge_text}\" is entered without immediate field-level error",
                    "Transaction submission is triggered; system validates the boundary value",
                    "The system behaves correctly at the exact limit — accepts or rejects as defined by the spec.",
                ]
                expected = "The system behaves correctly at the exact limit — accepts or rejects as defined by the spec."
                ttl = f"Boundary scenario — {title}"

            elif cat == "error_handling":
                steps = [
                    f"Step 1: Navigate to {screen_ref}",
                    "Step 2: Simulate a system/network error (e.g. disconnect, timeout)",
                    "Step 3: Attempt to complete the transaction",
                    "Step 4: Verify a graceful error message is shown and no partial data is saved",
                ]
                step_expected = [
                    "Screen opens successfully",
                    "System registers the error condition or interrupted state",
                    "System responds to the failed state — no silent processing",
                    "Error is handled gracefully with a clear message. No data corruption occurs.",
                ]
                expected = "Error is handled gracefully with a clear message. No data corruption occurs."
                ttl = f"Error handling scenario — {title}"

            else:  # integration
                steps = [
                    f"Step 1: Complete the primary transaction in {screen_ref}",
                    "Step 2: Navigate to the downstream/integrated module",
                    "Step 3: Verify the corresponding record/document was created or updated",
                    "Step 4: Confirm field values match between source and target",
                ]
                step_expected = [
                    "Primary transaction saved successfully; confirmation displayed",
                    "Downstream module is accessible and shows updated data state",
                    "Downstream record/document exists with correct identifier and status",
                    "Downstream record reflects the change accurately and consistently.",
                ]
                expected = "Downstream record reflects the change accurately and consistently."
                ttl = f"Integration scenario — {title}"

            cases.append({
                "tc_id": "PLACEHOLDER",  # replaced by _apply_naming_convention
                "title": ttl,
                "tc_type": cat,
                "priority": "High",
                "pre_conditions": pre_condition,
                "steps": steps,
                "step_expected_results": step_expected,
                "expected_result": expected,
                "notes": (
                    f"Template: {template}. Generated from acceptance criteria/edge cases "
                    f"({'AI model unavailable — using structured fallback generation' if error_reason else 'Ollama did not respond — check that the model is running and nomic-embed-text is pulled'})"
                ),
            })

    return _apply_naming_convention(cases, naming_convention, module)

import httpx
import base64
import re
from typing import Optional, Dict, Any, List
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)


def _extract_issue_key(url: str) -> Optional[str]:
    match = re.search(r'/browse/([A-Z][A-Z0-9]+-\d+)', url)
    return match.group(1) if match else None


def _build_auth_header(email: str, token: str) -> str:
    creds = base64.b64encode(f"{email}:{token}".encode()).decode()
    return f"Basic {creds}"


# ── Combined-block parser ──────────────────────────────────────────────────
# Many real-world JIRA tickets (confirmed against an actual production
# ticket) don't use separate "Acceptance Criteria" fields at all — instead
# the whole description is one block like:
#   AS a PO of NGP product
#   I WANT to discover specific requirements for X
#   SO THAT to be able to build Product Backlog
#   GIVEN the activities for Y
#   WHEN the analysis initiated for Z
#   THEN following activities required to be fulfilled:
#   1. ...
#   2. ...
# This splits that into story_body (AS/WANT/SO THAT), pre_conditions
# (GIVEN), and acceptance_criteria (the numbered THEN list) on a best-effort
# basis — never silently drops content; whatever doesn't match a recognized
# section is preserved in story_body so nothing is lost.
_SECTION_PATTERN = re.compile(
    r'(?P<as>\bAS\s+.+?)(?=\bI\s*WANT\b|\Z)'
    r'|(?P<want>\bI\s*WANT\s+.+?)(?=\bSO\s*THAT\b|\Z)'
    r'|(?P<sothat>\bSO\s*THAT\s+.+?)(?=\bGIVEN\b|\Z)'
    r'|(?P<given>\bGIVEN\s+.+?)(?=\bWHEN\b|\Z)'
    r'|(?P<when>\bWHEN\s+.+?)(?=\bTHEN\b|\Z)'
    r'|(?P<then>\bTHEN\s+.+)',
    re.IGNORECASE | re.DOTALL,
)

# Matches a line that's clearly a bullet/numbered list item, in any of the
# styles real tickets actually use: "- text", "* text", "• text", "1. text",
# "1) text". Used by the bullet-list strategy below.
_BULLET_LINE_PATTERN = re.compile(r'^\s*(?:[-*•]|\d+[\.\)])\s+(.+)$')


def _parse_given_when_then(text: str) -> Dict[str, Any]:
    """Strategy 1: the AS/I WANT/SO THAT/GIVEN/WHEN/THEN combined block
    (confirmed against a real production ticket, COERSD-37655). Highest
    confidence when it matches — this is an explicit, unambiguous format."""
    if not text or not re.search(r'\bAS\s+', text, re.IGNORECASE):
        return {"story_body": "", "pre_conditions": "", "acceptance_criteria": "", "matched": False}

    parts = {"as": "", "want": "", "sothat": "", "given": "", "when": "", "then": ""}
    for m in _SECTION_PATTERN.finditer(text):
        for key in parts:
            if m.group(key):
                parts[key] = m.group(key).strip()

    story_body = " ".join(p for p in [parts["as"], parts["want"], parts["sothat"]] if p)
    pre_conditions = " ".join(p for p in [parts["given"], parts["when"]] if p)

    acceptance_criteria = ""
    if parts["then"]:
        then_text = re.sub(r'^\n?\s*THEN\s+', '', parts["then"], flags=re.IGNORECASE)
        acceptance_criteria = then_text.strip()

    # Require at least the GIVEN/WHEN/THEN structure (not just a stray "AS")
    # to count as a real match — otherwise a sentence that merely contains
    # the word "as" would falsely trigger this strategy.
    matched = bool(pre_conditions or acceptance_criteria)
    return {
        "story_body": story_body,
        "pre_conditions": pre_conditions,
        "acceptance_criteria": acceptance_criteria,
        "matched": matched,
    }


def _parse_prose_with_bullets(text: str) -> Dict[str, Any]:
    """Strategy 2: free-form prose followed by a plain bullet/numbered list
    — common in informal tickets with no AS/WANT/GIVEN/WHEN structure at
    all (confirmed against a real production ticket, COERSD-36238: "Hi
    team, as per..." followed by plain "- New interface to be build..."
    bullets). The prose becomes story_body; the bullets become candidate
    acceptance criteria, since each bullet is effectively describing a
    condition the solution needs to satisfy — functionally equivalent to
    an acceptance criterion even though no field is labeled as such."""
    if not text:
        return {"story_body": "", "pre_conditions": "", "acceptance_criteria": "", "matched": False}

    lines = text.split("\n")
    bullet_lines = []
    prose_lines = []
    for line in lines:
        m = _BULLET_LINE_PATTERN.match(line)
        if m:
            bullet_lines.append(m.group(1).strip())
        elif line.strip():
            prose_lines.append(line.strip())

    matched = len(bullet_lines) >= 2  # require at least 2 bullets to be confident this is a real list, not a stray dash
    return {
        "story_body": " ".join(prose_lines),
        "pre_conditions": "",
        "acceptance_criteria": "\n".join(f"{i+1}. {b}" for i, b in enumerate(bullet_lines)) if matched else "",
        "matched": matched,
    }


def parse_structured_description(text: str) -> Dict[str, Any]:
    """
    Tries multiple known JIRA description formats, in priority order, and
    uses whichever one actually matches — rather than assuming every ticket
    follows one single format. Real tickets in this org have been observed
    using AT LEAST these shapes: a combined AS/WANT/SO THAT/GIVEN/WHEN/THEN
    block; free prose followed by a plain bullet list; and tables (handled
    separately during ADF extraction, since by the time this function runs
    the table is already flattened to pipe-delimited text and reads as
    prose, which is fine — it ends up in story_body either way).

    Returns story_body / pre_conditions / acceptance_criteria / matched.
    If NO strategy matches, matched=False and the caller should fall back
    to using the raw text as story_body — nothing is ever silently dropped,
    only reorganized when we're confident about the structure.
    """
    gwt = _parse_given_when_then(text)
    if gwt["matched"]:
        return gwt

    bullets = _parse_prose_with_bullets(text)
    if bullets["matched"]:
        return bullets

    return {"story_body": "", "pre_conditions": "", "acceptance_criteria": "", "matched": False}


# ── Confluence link extraction ───────────────────────────────────────────────
def extract_confluence_links(text: str) -> List[str]:
    """Find Confluence page URLs embedded in JIRA description text (e.g.
    'Additional information available in Confluence page [here](url)' or
    a bare URL). Returns unique URLs in order of first appearance."""
    if not text:
        return []
    # Matches both markdown-style [text](url) and bare URLs containing /wiki/
    pattern = re.compile(r'https?://[^\s<>"\')\]]+/wiki/[^\s<>"\')\]]+')
    seen = []
    for match in pattern.finditer(text):
        url = match.group(0).rstrip('.,;:')
        if url not in seen:
            seen.append(url)
    return seen


async def fetch_jira_story(
    story_url: str,
    jira_base_url: Optional[str] = None,
    jira_email: Optional[str] = None,
    jira_api_token: Optional[str] = None,
) -> Dict[str, Any]:
    base_url = (jira_base_url or settings.JIRA_BASE_URL).rstrip("/")
    email = jira_email or settings.JIRA_EMAIL
    token = jira_api_token or settings.JIRA_API_TOKEN

    if not base_url or not email or not token:
        raise ValueError("JIRA credentials not configured. Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN.")

    issue_key = _extract_issue_key(story_url)
    if not issue_key:
        raise ValueError(f"Could not extract JIRA issue key from URL: {story_url}")

    url = f"{base_url}/rest/api/3/issue/{issue_key}"
    headers = {
        "Authorization": _build_auth_header(email, token),
        "Accept": "application/json",
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code == 404:
            raise ValueError(
                f"JIRA returned 404 for {url} using email '{email}'. JIRA deliberately "
                f"returns 404 (not 401) for both 'ticket doesn't exist' AND 'not authenticated' "
                f"— so this means either: (1) the credentials in backend/.env weren't actually "
                f"picked up (the backend must be FULLY RESTARTED after editing .env — a code "
                f"reload via --reload is not enough, environment variables are only read at "
                f"process startup), (2) JIRA_BASE_URL has a typo or extra path segment, or "
                f"(3) the API token is invalid/expired or the email doesn't match the token's "
                f"account. Try: curl -u \"{email}:YOUR_TOKEN\" \"{url}\" directly in a terminal "
                f"to isolate whether this is a credentials problem or an app problem."
            )
        if resp.status_code == 401:
            raise ValueError(f"JIRA returned 401 Unauthorized for email '{email}' — the API token is invalid or expired.")
        if resp.status_code == 403:
            raise ValueError(
                f"JIRA returned 403 Forbidden for email '{email}' on {url}. This usually means "
                f"the account/token is valid but lacks permission to view this specific ticket "
                f"or project — check with your JIRA admin that this account has access to the "
                f"project this ticket belongs to."
            )
        resp.raise_for_status()
        data = resp.json()

    fields = data.get("fields", {})

    def _extract_adf_text_and_links(adf_node, links: list) -> str:
        """
        Walks an ADF node tree, returning the visible text AND appending any
        URLs found via 'link' marks or 'inlineCard'/'card' nodes into the
        `links` list (mutated in place). This matters because a JIRA
        description like "see Confluence page [here]" stores the URL as a
        link MARK on the word "here" — it's invisible to plain text
        extraction, but exactly the content we need to follow automatically.
        """
        if not adf_node:
            return ""
        if isinstance(adf_node, str):
            return adf_node
        if isinstance(adf_node, dict):
            node_type = adf_node.get("type")
            # inlineCard / blockCard / embedCard: a pasted link rendered as
            # a card, with the URL in attrs.url (no visible text at all).
            if node_type in ("inlineCard", "blockCard", "embedCard"):
                card_url = adf_node.get("attrs", {}).get("url", "")
                if card_url:
                    links.append(card_url)
                return ""
            if node_type == "text":
                text = adf_node.get("text", "")
                for mark in adf_node.get("marks", []) or []:
                    if mark.get("type") == "link":
                        link_url = mark.get("attrs", {}).get("href", "")
                        if link_url:
                            links.append(link_url)
                return text
            # Tables: without this, the generic content-join below would
            # flatten every cell into one run-on string with no row/column
            # separation (e.g. "ZM10 MI:R1 Month.Gen.Red. R1 ZM19 MI:R2..."),
            # losing the table's actual meaning. Render as readable
            # pipe-delimited rows instead, one per line — not a markdown
            # table (no alignment guarantees from JIRA's column widths), but
            # readable and keeps each row's cells visually grouped.
            if node_type == "table":
                rows = []
                for row in adf_node.get("content", []):
                    if row.get("type") == "tableRow":
                        cells = []
                        for cell in row.get("content", []):
                            cell_text = _extract_adf_text_and_links(cell, links).strip()
                            cells.append(cell_text)
                        rows.append(" | ".join(cells))
                return "\n".join(rows)
            texts = []
            for child in adf_node.get("content", []):
                texts.append(_extract_adf_text_and_links(child, links))
            return " ".join(t for t in texts if t)
        return ""

    description_raw = fields.get("description")
    description_links: list = []
    description_text = _extract_adf_text_and_links(description_raw, description_links) if description_raw else ""

    ac_field = fields.get("customfield_10016") or fields.get("customfield_acceptance_criteria") or ""
    ac_links: list = []
    ac_text = _extract_adf_text_and_links(ac_field, ac_links) if isinstance(ac_field, dict) else str(ac_field)

    # Also catch plain-text Confluence URLs that appear directly in the text
    # (not via a link mark) — covers ticket styles that paste raw URLs.
    all_links = description_links + ac_links + extract_confluence_links(description_text)
    confluence_links = [l for l in dict.fromkeys(all_links) if "/wiki/" in l]

    priority_map = {"Highest": "P1 - Critical", "High": "P2 - High", "Medium": "P3 - Medium", "Low": "P4 - Low"}
    raw_priority = fields.get("priority", {}).get("name", "Medium")

    # Best-effort split of the combined AS/WANT/SO THAT/GIVEN/WHEN/THEN block
    # — common in real-world tickets that have no separate AC field at all.
    parsed = parse_structured_description(description_text)

    result = {
        "issue_key": issue_key,
        "title": fields.get("summary", ""),
        "story_body": description_text,
        "acceptance_criteria": ac_text,
        "priority": priority_map.get(raw_priority, "P3 - Medium"),
        "module": fields.get("components", [{}])[0].get("name", "") if fields.get("components") else "",
        "source_ref": issue_key,
        "confluence_links": confluence_links,
    }

    # Only override story_body/acceptance_criteria/pre_conditions with the
    # parsed split if the parser actually found the AS/WANT/... structure
    # AND the ticket had no separate acceptance_criteria field already
    # (never discard a real, explicitly-filled AC field in favor of a
    # guess). The full original description_text is always preserved in
    # case the parse is imperfect — nothing the user sees is ever silently
    # dropped, only reorganized.
    if parsed["matched"] and not ac_text.strip():
        result["story_body"] = parsed["story_body"] or description_text
        result["pre_conditions"] = parsed["pre_conditions"]
        result["acceptance_criteria"] = parsed["acceptance_criteria"]
        result["raw_description"] = description_text

    return result


async def push_testcase_to_jira(
    project_key: str,
    tc_title: str,
    tc_steps: list,
    tc_expected: str,
    tc_type: str,
    story_key: Optional[str] = None,
) -> Dict[str, str]:
    base_url = settings.JIRA_BASE_URL
    email = settings.JIRA_EMAIL
    token = settings.JIRA_API_TOKEN

    if not base_url or not email or not token:
        raise ValueError(
            "JIRA credentials not configured — set JIRA_BASE_URL, JIRA_EMAIL, "
            "JIRA_API_TOKEN in backend/.env and restart the backend."
        )
    if not project_key:
        raise ValueError(
            "Could not determine a JIRA project key for this push. The requirement "
            "wasn't fetched from JIRA (no issue key to derive a project from) and no "
            "JIRA_PROJECT_KEY fallback is set in backend/.env."
        )

    steps_text = "\n".join(tc_steps)
    description_text = f"Type: {tc_type}\n\nSteps:\n{steps_text}\n\nExpected: {tc_expected}"
    if story_key:
        description_text += f"\n\nLinked story: {story_key}"

    # NOTE: a "project" key is REQUIRED by the JIRA create-issue API — its
    # prior absence here meant every push 500'd regardless of how valid the
    # credentials were. project_key is resolved by the caller (routes.py)
    # from the requirement's own JIRA issue key when available, else a
    # configured JIRA_PROJECT_KEY fallback.
    body = {
        "fields": {
            "project": {"key": project_key},
            "summary": tc_title,
            "description": {
                "type": "doc",
                "version": 1,
                "content": [
                    {"type": "paragraph", "content": [
                        {"type": "text", "text": description_text}
                    ]}
                ]
            },
            "issuetype": {"name": "Test"},
        }
    }

    headers = {
        "Authorization": _build_auth_header(email, token),
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{base_url}/rest/api/3/issue",
            json=body,
            headers=headers,
        )
        if resp.status_code >= 400:
            raise ValueError(f"JIRA create-issue failed ({resp.status_code}): {resp.text[:500]}")
        data = resp.json()

    return {"jira_key": data.get("key", ""), "message": "Pushed successfully"}


# ── Confluence page fetching ("Confluence page" input source) ───────────────
def _extract_confluence_page_id(url: str) -> Optional[str]:
    """Extract pageId from a Confluence URL, e.g.
    https://your-org.atlassian.net/wiki/spaces/SPACE/pages/123456789/Title
    """
    match = re.search(r'/pages/(\d+)', url)
    return match.group(1) if match else None


async def fetch_confluence_page(
    page_url: str,
    confluence_base_url: Optional[str] = None,
    confluence_email: Optional[str] = None,
    confluence_api_token: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Fetch a Confluence page's body as plain-ish text via the REST API.
    Prefers CONFLUENCE_* settings; falls back to JIRA_* only if Confluence-
    specific credentials aren't set (the two are NOT assumed identical —
    some orgs gate Confluence access separately from JIRA).
    """
    base_url = confluence_base_url or settings.CONFLUENCE_BASE_URL or settings.JIRA_BASE_URL
    email = confluence_email or settings.CONFLUENCE_EMAIL or settings.JIRA_EMAIL
    token = confluence_api_token or settings.CONFLUENCE_API_TOKEN or settings.JIRA_API_TOKEN

    if not base_url or not email or not token:
        raise ValueError(
            "Confluence credentials not configured. Set CONFLUENCE_BASE_URL, "
            "CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN in backend/.env. (If your "
            "JIRA and Confluence access use the same Atlassian account, "
            "JIRA_BASE_URL/EMAIL/API_TOKEN are used as a fallback — but set "
            "the CONFLUENCE_* ones explicitly if your org's access differs.)"
        )

    page_id = _extract_confluence_page_id(page_url)
    if not page_id:
        raise ValueError(f"Could not extract a page ID from URL: {page_url}")

    url = f"{base_url}/wiki/api/v2/pages/{page_id}?body-format=storage"
    headers = {
        "Authorization": _build_auth_header(email, token),
        "Accept": "application/json",
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    title = data.get("title", "")
    storage_html = data.get("body", {}).get("storage", {}).get("value", "")

    # Strip HTML tags for a plain-text approximation (good enough for embeddings/RAG)
    plain_text = re.sub(r'<[^>]+>', ' ', storage_html)
    plain_text = re.sub(r'&nbsp;', ' ', plain_text)
    plain_text = re.sub(r'\s+', ' ', plain_text).strip()

    return {
        "title": title,
        "page_id": page_id,
        "text": plain_text,
        "source_ref": page_url,
    }


async def fetch_linked_confluence_pages(links: List[str], max_pages: int = 5) -> Dict[str, Any]:
    """
    Fetches each Confluence link found in a JIRA description. Each link is
    isolated — one failing/inaccessible page (e.g. Confluence credentials
    not configured, page deleted, no permission) does not prevent the
    others from being fetched, and the JIRA fetch as a whole never fails
    because of this; failures are reported back for the UI to show
    transparently rather than silently swallowed.
    """
    pages: List[Dict[str, str]] = []
    errors: List[Dict[str, str]] = []
    for link in links[:max_pages]:
        try:
            page = await fetch_confluence_page(link)
            pages.append({"title": page["title"], "text": page["text"], "url": link})
        except Exception as e:
            errors.append({"url": link, "error": str(e)})
            logger.warning(f"Could not auto-fetch linked Confluence page {link}: {e}")
    return {"pages": pages, "errors": errors}


"""
Seed ChromaDB with sample SAP test case templates so Agent 2's RAG pipeline
has something to retrieve from on day one — instead of "No similar test
cases in corpus yet."

Run this ONCE after setting up the backend:
    cd backend
    python scripts/seed_chroma.py

Safe to re-run — it skips IDs that already exist.
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.vector_store import upsert_testcase, upsert_knowledge_chunks

# ── Sample test cases across common SAP modules ──────────────────────────────
SAMPLE_TESTCASES = [
    {
        "id": "seed_tc_001",
        "tc_type": "positive",
        "module": "MM",
        "title": "Verify Purchase Order creation with valid vendor and material",
        "text": (
            "Title: Verify Purchase Order creation with valid vendor and material. "
            "Pre-conditions: User has SAP MM authorization, vendor master and material "
            "master exist. Steps: 1) Navigate to ME21N. 2) Enter vendor code, purchasing "
            "org, and material number with quantity. 3) Save the PO. "
            "Expected: PO is created with a unique PO number, status shows 'Created', "
            "and the PO appears in ME2N report."
        ),
    },
    {
        "id": "seed_tc_002",
        "tc_type": "negative",
        "module": "MM",
        "title": "Verify Purchase Order rejects invalid material number",
        "text": (
            "Title: Verify Purchase Order rejects invalid material number. "
            "Pre-conditions: User has SAP MM authorization. Steps: 1) Navigate to ME21N. "
            "2) Enter a non-existent material number. 3) Attempt to save. "
            "Expected: System displays error 'Material does not exist' and blocks save; "
            "no PO number is generated."
        ),
    },
    {
        "id": "seed_tc_003",
        "tc_type": "boundary",
        "module": "MM",
        "title": "Verify stock transfer at exact available quantity limit",
        "text": (
            "Title: Verify stock transfer at exact available quantity limit. "
            "Pre-conditions: Source plant has exactly 100 units of material in stock. "
            "Steps: 1) Navigate to MIGO. 2) Enter transfer quantity = 100 (exact available). "
            "3) Post the transfer. Expected: Transfer succeeds, source plant stock becomes "
            "0, destination plant stock increases by 100. Attempting 101 units should fail "
            "with 'Insufficient stock' error."
        ),
    },
    {
        "id": "seed_tc_004",
        "tc_type": "integration",
        "module": "MM-FI",
        "title": "Verify Goods Receipt triggers correct FI posting",
        "text": (
            "Title: Verify Goods Receipt triggers correct FI posting. "
            "Pre-conditions: PO exists and is approved, GR/IR account is configured. "
            "Steps: 1) Navigate to MIGO. 2) Perform goods receipt against the PO. "
            "3) Navigate to FB03 and check the generated accounting document. "
            "Expected: FI document is created automatically with correct GR/IR clearing "
            "account entries matching the PO value."
        ),
    },
    {
        "id": "seed_tc_005",
        "tc_type": "error_handling",
        "module": "MM",
        "title": "Verify system handles network interruption during PO save gracefully",
        "text": (
            "Title: Verify system handles network interruption during PO save gracefully. "
            "Pre-conditions: User has started creating a PO with all mandatory fields filled. "
            "Steps: 1) Begin saving the PO. 2) Simulate network disconnect mid-transaction. "
            "3) Reconnect and check PO status. "
            "Expected: No partial/corrupt PO record is created; system either rolls back "
            "fully or shows a clear retry prompt with no data loss."
        ),
    },
    {
        "id": "seed_tc_006",
        "tc_type": "positive",
        "module": "SD",
        "title": "Verify Sales Order creation with valid customer and material",
        "text": (
            "Title: Verify Sales Order creation with valid customer and material. "
            "Pre-conditions: Customer master and material master exist, pricing condition "
            "is maintained. Steps: 1) Navigate to VA01. 2) Enter sold-to party, material, "
            "and quantity. 3) Save the order. "
            "Expected: Sales order is created with correct pricing calculated automatically, "
            "and order confirmation is displayed with the order number."
        ),
    },
    {
        "id": "seed_tc_007",
        "tc_type": "negative",
        "module": "HR",
        "title": "Verify leave request rejects insufficient leave balance",
        "text": (
            "Title: Verify leave request rejects insufficient leave balance. "
            "Pre-conditions: Employee has 2 days annual leave remaining. "
            "Steps: 1) Employee submits leave request for 5 days annual leave. "
            "2) Attempt to submit. "
            "Expected: System blocks submission with error 'Insufficient leave balance', "
            "displays remaining balance, and no request record is created."
        ),
    },
    {
        "id": "seed_tc_008",
        "tc_type": "boundary",
        "module": "FI",
        "title": "Verify invoice posting at fiscal year-end boundary date",
        "text": (
            "Title: Verify invoice posting at fiscal year-end boundary date. "
            "Pre-conditions: Fiscal year close has not yet been performed. "
            "Steps: 1) Post invoice dated 31-Dec (last day of fiscal year). "
            "2) Post another invoice dated 1-Jan (first day of new fiscal year). "
            "Expected: Both invoices post successfully to their correct respective "
            "fiscal periods/years without cross-period contamination."
        ),
    },
]

SAMPLE_KNOWLEDGE = [
    {
        "id": "seed_kb_001",
        "filename": "sap_naming_conventions.txt",
        "text": (
            "SAP Test Case Naming Convention Reference: Test cases should follow the "
            "pattern TC_<Module>_<Category>_<###> e.g. TC_MM_POSITIVE_001. Module codes: "
            "MM (Materials Management), SD (Sales & Distribution), FI (Finance), "
            "CO (Controlling), HR (Human Resources), PP (Production Planning). "
            "Priority levels: Critical (blocks core business process), High (major "
            "feature impact), Medium (minor feature impact), Low (cosmetic/edge case)."
        ),
    },
    {
        "id": "seed_kb_002",
        "filename": "sap_common_transactions.txt",
        "text": (
            "Common SAP Transaction Codes Reference: ME21N (Create PO), ME22N (Change PO), "
            "ME23N (Display PO), MIGO (Goods Movement), MIRO (Invoice Verification), "
            "VA01 (Create Sales Order), VA02 (Change Sales Order), VF01 (Create Billing), "
            "FB01 (Post FI Document), FB03 (Display FI Document), FBL1N (Vendor Line "
            "Items), FBL5N (Customer Line Items), MM01 (Create Material Master), "
            "MM02 (Change Material), XK01 (Create Vendor)."
        ),
    },
]


async def seed():
    print("Seeding ChromaDB with sample test cases and knowledge reference docs...")
    print(f"Target collections: smartqa_testcases, smartqa_knowledge\n")

    tc_count = 0
    for tc in SAMPLE_TESTCASES:
        try:
            await upsert_testcase(
                tc_id=tc["id"],
                text=tc["text"],
                metadata={
                    "tc_type": tc["tc_type"],
                    "module": tc["module"],
                    "title": tc["title"],
                    "priority": "Medium",
                    "naming_convention": "TC_Module_001",
                    "seeded": "true",
                },
            )
            tc_count += 1
            print(f"  [OK] {tc['id']} — {tc['title'][:60]}")
        except Exception as e:
            print(f"  [SKIP] {tc['id']}: {e}")

    kb_count = 0
    for kb in SAMPLE_KNOWLEDGE:
        try:
            n = await upsert_knowledge_chunks(
                doc_id=kb["id"],
                filename=kb["filename"],
                full_text=kb["text"],
                metadata={"source_type": "seed", "seeded": "true"},
            )
            kb_count += n
            print(f"  [OK] {kb['id']} — {kb['filename']} ({n} chunk(s))")
        except Exception as e:
            print(f"  [SKIP] {kb['id']}: {e}")

    print(f"\nDone. {tc_count} test cases + {kb_count} knowledge chunks seeded.")
    print("Agent 2's 'Similar Test Cases RAG' step will now return real matches")
    print("instead of 'No similar test cases in corpus yet.'")


if __name__ == "__main__":
    asyncio.run(seed())

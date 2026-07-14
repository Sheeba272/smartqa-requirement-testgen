"""
Vector store — pure-Python, persisted as JSON on disk. No compiled
dependencies (no chromadb / chroma-hnswlib).

WHY: chroma-hnswlib (chromadb's vector index backend) has no prebuilt wheel
for Python 3.13 on ANY platform as of this writing — confirmed against the
package's own PyPI file listing (wheels stop at cp312) and chroma-core's own
unresolved GitHub issue #4382 ("Fails to install using Python 3.13"). Without
a C++14 compiler installed (Visual Studio Build Tools on Windows), pip falls
back to building chroma-hnswlib from source and fails with
"Microsoft Visual C++ 14.0 or greater is required" — exactly the error this
project kept hitting on machines without dev tools installed (e.g. locked-down
corporate AVDs where installing Build Tools may not be possible at all).

This module reimplements the small subset of vector-store behaviour this
project actually needs (upsert + cosine-similarity top-k query, scoped to
named "collections") using nothing but the Python standard library plus
numpy (which DOES have prebuilt cp313 wheels) for the similarity math.
Embeddings still come from Ollama's nomic-embed-text via ollama_client.py —
only the storage/index layer changed, not the embedding model.

Data is stored as one JSON file per collection in CHROMA_DATA_DIR (default:
<project_root>/chroma_data/<collection_name>.json), kept on disk exactly
like before, so the directory structure and migration story for users is
unchanged. Cosine similarity is computed with a simple O(n) numpy scan over
all vectors in a collection — entirely sufficient for a POC-scale corpus
(hundreds to low thousands of documents); if this ever needs to scale to
tens of thousands+ of documents, swap this for an ANN index at that point.
"""
import json
import logging
import os
from typing import List, Dict, Any, Optional
from threading import Lock

import numpy as np

from app.core.config import settings
from app.services.ollama_client import get_embedding, get_embedding_with_status

logger = logging.getLogger(__name__)

_data_dir_cache: Optional[str] = None
_collection_locks: Dict[str, Lock] = {}


def _get_data_dir() -> str:
    global _data_dir_cache
    if _data_dir_cache is not None:
        return _data_dir_cache
    if settings.CHROMA_DATA_DIR:
        data_dir = settings.CHROMA_DATA_DIR
    else:
        data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "../../../../chroma_data")
    data_dir = os.path.abspath(data_dir)
    os.makedirs(data_dir, exist_ok=True)
    _data_dir_cache = data_dir
    logger.info(f"Vector store data directory ready at {data_dir}")
    return data_dir


def _collection_path(name: str) -> str:
    safe_name = "".join(c if c.isalnum() or c in "_-" else "_" for c in name)
    return os.path.join(_get_data_dir(), f"{safe_name}.json")


def _get_lock(name: str) -> Lock:
    if name not in _collection_locks:
        _collection_locks[name] = Lock()
    return _collection_locks[name]


def _load_collection(name: str) -> Dict[str, Dict[str, Any]]:
    """Returns {id: {"embedding": [...], "document": str, "metadata": {...}}}"""
    path = _collection_path(name)
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"Could not load collection '{name}' ({path}): {e}. Starting fresh.")
        return {}


def _save_collection(name: str, data: Dict[str, Dict[str, Any]]) -> None:
    path = _collection_path(name)
    tmp_path = path + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp_path, path)  # atomic on both POSIX and Windows
    except Exception as e:
        logger.error(f"Could not save collection '{name}' ({path}): {e}")
        try:
            os.remove(tmp_path)
        except Exception:
            pass


def _upsert(collection: str, doc_id: str, embedding: List[float],
            document: str, metadata: Dict[str, Any]) -> None:
    with _get_lock(collection):
        data = _load_collection(collection)
        data[doc_id] = {
            "embedding": embedding,
            "document": document,
            "metadata": metadata,
        }
        _save_collection(collection, data)


def _upsert_many(collection: str, ids: List[str], embeddings: List[List[float]],
                  documents: List[str], metadatas: List[Dict[str, Any]]) -> None:
    with _get_lock(collection):
        data = _load_collection(collection)
        for doc_id, emb, doc, meta in zip(ids, embeddings, documents, metadatas):
            data[doc_id] = {"embedding": emb, "document": doc, "metadata": meta}
        _save_collection(collection, data)


def _cosine_similarity_batch(query_vec: List[float], vectors: List[List[float]]) -> np.ndarray:
    """Vectorised cosine similarity between one query vector and many candidates."""
    q = np.asarray(query_vec, dtype=np.float64)
    m = np.asarray(vectors, dtype=np.float64)
    q_norm = np.linalg.norm(q)
    m_norms = np.linalg.norm(m, axis=1)
    # Avoid divide-by-zero for any zero vectors (shouldn't normally happen,
    # but a corrupted/empty embedding shouldn't crash the whole query).
    denom = (m_norms * q_norm)
    denom[denom == 0] = 1e-12
    sims = (m @ q) / denom
    return sims


async def upsert_requirement(req_id: str, text: str, metadata: Dict[str, Any]):
    try:
        embedding, embedding_reliable = await get_embedding_with_status(text)
        stored_metadata = {k: str(v) for k, v in metadata.items()}
        stored_metadata["_embedding_reliable"] = "true" if embedding_reliable else "false"
        _upsert(settings.CHROMA_COLLECTION_REQUIREMENTS, req_id, embedding, text, stored_metadata)
    except Exception as e:
        logger.error(f"upsert_requirement error: {e}")


async def upsert_testcase(tc_id: str, text: str, metadata: Dict[str, Any]):
    try:
        embedding, embedding_reliable = await get_embedding_with_status(text)
        stored_metadata = {k: str(v) for k, v in metadata.items()}
        stored_metadata["_embedding_reliable"] = "true" if embedding_reliable else "false"
        _upsert(settings.CHROMA_COLLECTION_TESTCASES, tc_id, embedding, text, stored_metadata)
    except Exception as e:
        logger.error(f"upsert_testcase error: {e}")


async def _query(collection_name: str, text: str, n_results: int,
                 where: Optional[Dict] = None) -> List[Dict]:
    try:
        data = _load_collection(collection_name)
        if not data:
            return []

        # Optional metadata filter (used by query_similar_testcases for module=)
        if where:
            data = {
                doc_id: entry for doc_id, entry in data.items()
                if all(str(entry.get("metadata", {}).get(k, "")) == str(v) for k, v in where.items())
            }
        if not data:
            return []

        embedding, embedding_reliable = await get_embedding_with_status(text)

        ids = list(data.keys())
        vectors = [data[doc_id]["embedding"] for doc_id in ids]
        sims = _cosine_similarity_batch(embedding, vectors)

        # Top-k by similarity, descending
        k = min(n_results, len(ids))
        top_idx = np.argsort(-sims)[:k]

        items = []
        for idx in top_idx:
            doc_id = ids[idx]
            entry = data[doc_id]
            metadata = entry.get("metadata", {})
            similarity = float(max(0.0, min(1.0, sims[idx])))
            doc_reliable = metadata.get("_embedding_reliable", "true") == "true"
            reliable = embedding_reliable and doc_reliable
            items.append({
                "id": doc_id,
                "document": entry.get("document", ""),
                "metadata": metadata,
                "similarity": round(similarity, 3) if reliable else None,
                "similarity_reliable": reliable,
            })
        return items
    except Exception as e:
        logger.error(f"Vector store query error ({collection_name}): {e}")
        return []


async def query_similar_requirements(text: str, n_results: int = 5) -> List[Dict]:
    return await _query(settings.CHROMA_COLLECTION_REQUIREMENTS, text, n_results)


async def query_similar_testcases(text: str, module: str = "",
                                   n_results: int = 6) -> List[Dict]:
    where = {"module": module} if module else None
    return await _query(settings.CHROMA_COLLECTION_TESTCASES, text, n_results, where)


# ── Knowledge base (Agent 1 "Contextual Knowledge" upload tab) ───────────────
# Uploaded BRD / Word / Confluence content is chunked and embedded here.
# Used as extra RAG context during Agent 1 validation — never validated itself.

def chunk_text(text: str, chunk_size: int = 1200, overlap: int = 150) -> List[str]:
    """Simple character-based chunking with overlap."""
    text = (text or "").strip()
    if not text:
        return []
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end == len(text):
            break
        start = end - overlap
    return chunks


async def upsert_knowledge_chunks(doc_id: str, filename: str, full_text: str,
                                   metadata: Dict[str, Any]) -> int:
    """Chunk + embed a knowledge document. Returns number of chunks indexed."""
    try:
        chunks = chunk_text(full_text)
        if not chunks:
            return 0

        ids, embeddings, documents, metadatas = [], [], [], []
        for i, chunk in enumerate(chunks):
            ids.append(f"{doc_id}::chunk{i}")
            embeddings.append(await get_embedding(chunk))
            documents.append(chunk)
            meta = {k: str(v) for k, v in metadata.items()}
            meta.update({"doc_id": doc_id, "filename": filename, "chunk_index": str(i)})
            metadatas.append(meta)

        _upsert_many(settings.CHROMA_COLLECTION_KNOWLEDGE, ids, embeddings, documents, metadatas)
        return len(chunks)
    except Exception as e:
        logger.error(f"upsert_knowledge_chunks error: {e}")
        return 0


async def query_knowledge(text: str, n_results: int = 4) -> List[Dict]:
    """Retrieve relevant chunks from uploaded BRD/Confluence/Word docs."""
    return await _query(settings.CHROMA_COLLECTION_KNOWLEDGE, text, n_results)


async def delete_knowledge_doc(doc_id: str):
    try:
        with _get_lock(settings.CHROMA_COLLECTION_KNOWLEDGE):
            data = _load_collection(settings.CHROMA_COLLECTION_KNOWLEDGE)
            to_delete = [k for k, v in data.items()
                        if str(v.get("metadata", {}).get("doc_id", "")) == str(doc_id)]
            for k in to_delete:
                del data[k]
            _save_collection(settings.CHROMA_COLLECTION_KNOWLEDGE, data)
    except Exception as e:
        logger.error(f"delete_knowledge_doc error: {e}")

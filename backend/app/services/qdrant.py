"""
Qdrant service — manages the `videos` collection for vibe-based similarity search.

Collection stores 4-dimensional vectors: [energy, warmth, chaos, intimacy]
matching the same axes used for songs, enabling direct cross-modal matching.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

COLLECTION = "videos"
VECTOR_SIZE = 4

_client = None


def _get_client():
    global _client
    if _client is None:
        from qdrant_client import QdrantClient
        from app.config import settings

        _client = QdrantClient(host=settings.qdrant_host, port=settings.qdrant_port)
    return _client


def init_collection() -> None:
    """Create the videos collection if it doesn't already exist."""
    from qdrant_client.models import Distance, VectorParams

    client = _get_client()
    existing = {c.name for c in client.get_collections().collections}
    if COLLECTION not in existing:
        client.create_collection(
            collection_name=COLLECTION,
            vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
        )
        logger.info("Created Qdrant collection '%s'", COLLECTION)


def upsert_video(qdrant_id: str, vibe: list[float], payload: dict) -> None:
    """Insert or update a video point in Qdrant."""
    from qdrant_client.models import PointStruct

    client = _get_client()
    client.upsert(
        collection_name=COLLECTION,
        points=[PointStruct(id=qdrant_id, vector=vibe, payload=payload)],
    )


def update_payload(qdrant_id: str, payload: dict) -> None:
    """Overwrite payload fields on an existing Qdrant point."""
    client = _get_client()
    client.set_payload(
        collection_name=COLLECTION,
        payload=payload,
        points=[qdrant_id],
    )


def delete_video(qdrant_id: str) -> None:
    from qdrant_client.models import PointIdsList

    client = _get_client()
    client.delete(
        collection_name=COLLECTION,
        points_selector=PointIdsList(points=[qdrant_id]),
    )


def search_similar(
    vibe: list[float], limit: int = 10, aesthetic_id: str | None = None
) -> list[dict]:
    """Return the closest video points to the given vibe vector.

    If aesthetic_id is provided, only videos belonging to that aesthetic are considered.
    """
    from qdrant_client.models import FieldCondition, Filter

    client = _get_client()
    search_filter = None
    if aesthetic_id:
        from qdrant_client.models import MatchAny
        search_filter = Filter(
            must=[FieldCondition(key="aesthetic_ids", match=MatchAny(any=[aesthetic_id]))]
        )

    results = client.query_points(
        collection_name=COLLECTION,
        query=vibe,
        limit=limit,
        with_payload=True,
        query_filter=search_filter,
    ).points
    return [
        {"qdrant_id": str(r.id), "score": r.score, **r.payload}
        for r in results
    ]

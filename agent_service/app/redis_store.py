from __future__ import annotations

import json

from redis import Redis

from .config import settings


client = Redis.from_url(settings.redis_url, decode_responses=True)


def seen_message(message_id: str | None) -> bool:
    if not message_id:
        return False
    key = f"wa:idempotency:{message_id}"
    inserted = client.set(key, "1", ex=24 * 3600, nx=True)
    return not bool(inserted)


def set_session(phone: str, payload: dict, ttl_seconds: int = 3600) -> None:
    client.setex(f"wa:session:{phone}", ttl_seconds, json.dumps(payload))


def get_session(phone: str) -> dict | None:
    raw = client.get(f"wa:session:{phone}")
    if not raw:
        return None
    return json.loads(raw)


def clear_session(phone: str) -> None:
    client.delete(f"wa:session:{phone}")

from __future__ import annotations

import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


async def _post_whatsapp_payload(payload: dict) -> None:
    if not settings.whatsapp_token or not settings.whatsapp_phone_number_id:
        logger.warning("WhatsApp message skipped: missing token or phone number id")
        return

    url = f"https://graph.facebook.com/v22.0/{settings.whatsapp_phone_number_id}/messages"
    headers = {
        "Authorization": f"Bearer {settings.whatsapp_token}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        try:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "WhatsApp send failed with status %s: %s",
                exc.response.status_code,
                exc.response.text[:500],
            )
        except httpx.HTTPError as exc:
            logger.error("WhatsApp send failed: %s", str(exc))


async def send_text_message(phone: str, text: str) -> None:
    await _post_whatsapp_payload(
        {
            "messaging_product": "whatsapp",
            "to": phone,
            "type": "text",
            "text": {"body": text},
        }
    )


async def send_list_message(
    phone: str,
    *,
    body_text: str,
    button_text: str,
    sections: list[dict],
    header_text: str | None = None,
    footer_text: str | None = None,
) -> None:
    interactive: dict = {
        "type": "list",
        "body": {"text": body_text},
        "action": {
            "button": button_text,
            "sections": sections,
        },
    }
    if header_text:
        interactive["header"] = {"type": "text", "text": header_text}
    if footer_text:
        interactive["footer"] = {"text": footer_text}

    await _post_whatsapp_payload(
        {
            "messaging_product": "whatsapp",
            "to": phone,
            "type": "interactive",
            "interactive": interactive,
        }
    )

from __future__ import annotations

import logging

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from app import db
from app.config import settings
from app.redis_store import seen_message
from app.schemas import AppointmentScheduledEvent, InboundMessage, ReminderCallConfirmationEvent, VisitCompletedEvent
from app.services.scheduler import (
    auto_schedule_from_visit,
    confirm_reminder_from_call,
    handle_patient_message,
    notify_patient_appointment_scheduled,
    process_visit_reminders,
)

app = FastAPI(title="Clinical WhatsApp Agent", version="0.1.0")
logger = logging.getLogger(__name__)


def _extract_inbound_text(msg: dict) -> str:
    msg_type = msg.get("type")
    if msg_type == "text":
        return ((msg.get("text") or {}).get("body") or "").strip()
    if msg_type == "button":
        return ((msg.get("button") or {}).get("text") or "").strip()
    if msg_type == "interactive":
        interactive = msg.get("interactive") or {}
        kind = interactive.get("type")
        if kind == "button_reply":
            reply = interactive.get("button_reply") or {}
            return (reply.get("id") or reply.get("title") or "").strip()
        if kind == "list_reply":
            reply = interactive.get("list_reply") or {}
            return (reply.get("id") or reply.get("title") or "").strip()
    return ""


@app.on_event("startup")
def startup() -> None:
    db.init_schema()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "env": settings.app_env}


@app.post("/events/visit-completed")
async def visit_completed(event: VisitCompletedEvent, x_internal_token: str | None = Header(default=None)):
    if x_internal_token != settings.internal_api_token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    result = await auto_schedule_from_visit(event)
    status = 200 if result.get("ok") else 400
    return JSONResponse(result, status_code=status)


@app.post("/events/appointment-scheduled")
async def appointment_scheduled(event: AppointmentScheduledEvent, x_internal_token: str | None = Header(default=None)):
    if x_internal_token != settings.internal_api_token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    result = await notify_patient_appointment_scheduled(event)
    status = 200 if result.get("ok") else 400
    return JSONResponse(result, status_code=status)


@app.post("/jobs/visit-reminders")
async def run_visit_reminders(x_internal_token: str | None = Header(default=None)):
    if x_internal_token != settings.internal_api_token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    result = await process_visit_reminders()
    return JSONResponse(result, status_code=200)


@app.post("/events/reminder-call-confirmed")
async def reminder_call_confirmed(event: ReminderCallConfirmationEvent, x_internal_token: str | None = Header(default=None)):
    if x_internal_token != settings.internal_api_token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    result = await confirm_reminder_from_call(event.patient_id, event.source, event.confirmed_by, event.digits)
    status = 200 if result.get("ok") else 400
    return JSONResponse(result, status_code=status)


@app.get("/webhook/whatsapp")
def verify_webhook(
    hub_mode: str = Query(alias="hub.mode"),
    hub_token: str = Query(alias="hub.verify_token"),
    hub_challenge: str = Query(alias="hub.challenge"),
):
    if hub_mode == "subscribe" and hub_token == settings.whatsapp_verify_token:
        return PlainTextResponse(content=hub_challenge)
    raise HTTPException(status_code=403, detail="Invalid webhook verification")


@app.post("/webhook/whatsapp")
async def inbound_whatsapp(request: Request):
    body = await request.json()

    entries = body.get("entry", [])
    for entry in entries:
        for change in entry.get("changes", []):
            value = change.get("value", {})
            messages = value.get("messages", [])
            for msg in messages:
                text = _extract_inbound_text(msg)
                if not text:
                    continue

                payload = InboundMessage(
                    from_phone=msg.get("from", ""),
                    text=text,
                    message_id=msg.get("id"),
                )

                if seen_message(payload.message_id):
                    continue

                logger.info("Inbound WhatsApp message from %s: %s", payload.from_phone, payload.text[:120])
                await handle_patient_message(payload.from_phone, payload.text)

    return {"received": True}

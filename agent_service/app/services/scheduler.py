from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

from app import db
from app.config import settings
from app.redis_store import clear_session, get_session, set_session
from app.schemas import AppointmentScheduledEvent, VisitCompletedEvent
from app.services.llm import classify_patient_intent
from app.services.whatsapp import send_list_message, send_text_message


CLINIC_TZ = ZoneInfo(settings.clinic_timezone)


def _utc(dt: datetime | None) -> datetime:
    if dt is None:
        return datetime.now(timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _fmt_slot(start_at: datetime) -> str:
    local = _utc(start_at).astimezone(CLINIC_TZ)
    hour = local.strftime("%I").lstrip("0") or "12"
    return f"{local.strftime('%a %d %b')} {hour}:{local.strftime('%M')} {local.strftime('%p')}"


def _patient_name(patient: dict) -> str:
    first = str(patient.get("first_name") or "").strip()
    return first or "there"


def _clinic_signoff() -> str:
    return f"Regards,\n{settings.whatsapp_clinic_name}"


def _patient_message(patient: dict | None, *sections: str) -> str:
    name = _patient_name(patient or {})
    body = [section.strip() for section in sections if section and section.strip()]
    return "\n\n".join([f"Hi {name},", *body, _clinic_signoff()])


def _generic_message(*sections: str) -> str:
    body = [section.strip() for section in sections if section and section.strip()]
    return "\n\n".join(["Hello,", *body, _clinic_signoff()])


async def _send_main_menu(phone: str, patient: dict, *, has_next_appointment: bool) -> None:
    rows = [
        {
            "id": "menu:book",
            "title": "Book Appointment",
            "description": "Request the next available appointment slot.",
        }
    ]
    if has_next_appointment:
        rows.insert(
            0,
            {
                "id": "menu:view",
                "title": "View Appointment",
                "description": "See the details of your upcoming appointment.",
            },
        )
        rows.append(
            {
                "id": "menu:reschedule",
                "title": "Reschedule",
                "description": "Request different appointment times.",
            },
        )

    await send_list_message(
        phone,
        header_text="Main Menu",
        body_text="Please select an option below.",
        button_text="Main menu",
        sections=[{"title": "Appointment Services", "rows": rows}],
        footer_text=settings.whatsapp_clinic_name,
    )


async def _send_slot_menu(phone: str, patient: dict, options: list[dict], *, title: str) -> None:
    rows = []
    for idx, option in enumerate(options[:5], start=1):
        rows.append(
            {
                "id": f"slot:{idx}",
                "title": option["label"][:24],
                "description": "Select this appointment time.",
            }
        )

    await send_list_message(
        phone,
        header_text="Available Times",
        body_text=title,
        button_text="Select time",
        sections=[{"title": "Appointment Slots", "rows": rows}],
        footer_text="Select one of the available appointment times.",
    )


def _normalized_phone(phone: str) -> str:
    return "".join(ch for ch in str(phone) if ch.isdigit())


def _normalize_choice_text(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else " " for ch in str(value))
    return " ".join(cleaned.split())


def _match_slot_choice(raw_text: str, options: list[dict]) -> int | None:
    trimmed = raw_text.strip()
    if trimmed.isdigit():
        idx = int(trimmed) - 1
        return idx if idx >= 0 else None

    normalized = _normalize_choice_text(trimmed)
    if not normalized:
        return None

    for idx, option in enumerate((options or [])[:5]):
        label = _normalize_choice_text(str(option.get("label") or ""))
        if normalized == label or normalized in label or label in normalized:
            return idx
    return None


def _confirmation_recipients(patient: dict, reply_phone: str) -> list[str]:
    recipients: list[str] = []
    seen: set[str] = set()
    for candidate in [reply_phone, str(patient.get("phone") or "").strip(), str(patient.get("call_trigger_phone") or "").strip()]:
        if not candidate:
            continue
        key = _normalized_phone(candidate) or candidate
        if key in seen:
            continue
        seen.add(key)
        recipients.append(candidate)
    return recipients


def _format_slot_options(option_slots: list[dict], *, max_items: int = 5) -> str:
    items = (option_slots or [])[:max_items]
    if not items:
        return ""
    return "\n".join(f"{idx + 1}) {item['label']}" for idx, item in enumerate(items))


def _slot_selection_instructions(option_count: int) -> str:
    if option_count <= 1:
        return "Please reply with 1 to confirm this option."
    upper = min(5, option_count)
    if upper == 2:
        return "Please reply with 1 or 2 to confirm your preferred option."
    return f"Please reply with a number from 1 to {upper} to confirm your preferred option."


def _ack_wait_stage1() -> timedelta:
    return timedelta(hours=max(1, settings.reminder_ack_wait_hours_stage1))


def _ack_wait_stage2() -> timedelta:
    return timedelta(hours=max(1, settings.reminder_ack_wait_hours_stage2))


def _ack_wait_stage3() -> timedelta:
    return timedelta(hours=max(1, settings.reminder_ack_wait_hours_stage2))


def _ack_wait_after_call() -> timedelta:
    return timedelta(hours=max(1, settings.reminder_ack_wait_hours_after_call))


def _ack_wait_after_next_of_kin() -> timedelta:
    return timedelta(hours=max(1, settings.reminder_ack_wait_hours_after_next_of_kin))


def _day_of_reminder_at(scheduled_start: datetime) -> datetime:
    local_start = _utc(scheduled_start).astimezone(CLINIC_TZ)
    candidate_local = local_start - timedelta(hours=max(1, settings.reminder_day_of_hours_before))
    if candidate_local.date() != local_start.date():
        candidate_local = local_start.replace(hour=6, minute=0, second=0, microsecond=0)

    latest_same_day_local = local_start - timedelta(minutes=30)
    chosen_local = candidate_local if latest_same_day_local > candidate_local else latest_same_day_local
    return chosen_local.astimezone(timezone.utc)


def _format_location_for_staff(location: dict) -> str:
    parts = [
        str(location.get("address_line") or "").strip(),
        str(location.get("city") or "").strip(),
        str(location.get("state") or "").strip(),
        str(location.get("postal_code") or "").strip(),
    ]
    address = ", ".join([p for p in parts if p])
    lat = str(location.get("latitude") or "").strip()
    lng = str(location.get("longitude") or "").strip()
    coord = f"{lat}, {lng}" if lat and lng else "unavailable"
    if address:
        return f"Address: {address}. Coordinates: {coord}."
    return f"Address: unavailable. Coordinates: {coord}."


async def _acknowledge_visit_reminder(patient: dict, reply_phone: str, channel: str, ack_text: str) -> dict | None:
    next_appointment = db.get_next_scheduled_appointment(str(patient["id"]))
    day_of_at = _day_of_reminder_at(next_appointment["scheduled_start"]) if next_appointment else None
    reminder_ack = db.acknowledge_pending_reminder(
        str(patient["id"]),
        channel,
        ack_text,
        next_action_at=day_of_at,
    )
    if reminder_ack:
        if reply_phone:
            if day_of_at:
                await send_text_message(
                    reply_phone,
                    _patient_message(
                        patient,
                        "Your appointment reminder has been confirmed successfully.",
                        "We will send you one additional reminder on the day of your visit.",
                    ),
                )
            else:
                await send_text_message(
                    reply_phone,
                    _patient_message(
                        patient,
                        "Your appointment reminder has been acknowledged successfully.",
                    ),
                )
    return reminder_ack


async def notify_patient_appointment_scheduled(event: AppointmentScheduledEvent) -> dict:
    patient = db.get_patient(event.patient_id)
    if not patient:
        return {"ok": False, "error": "Patient not found"}

    phone = str(patient.get("phone") or "").strip()
    if not phone:
        db.create_staff_task(event.patient_id, "Patient has no phone for immediate scheduling notification")
        return {"ok": False, "error": "Patient has no phone"}

    scheduled_start = _utc(event.scheduled_start)
    await send_text_message(
        phone,
        _patient_message(
            patient,
            f"Your next clinic visit has been scheduled for {_fmt_slot(scheduled_start)}.",
            f"Provider: {event.provider_name}.",
            "Please reply YES to acknowledge this appointment.",
        ),
    )
    db.add_audit_log(
        "APPOINTMENT_SCHEDULED_WHATSAPP_SENT",
        "SYSTEM",
        event.patient_id,
        {
            "appointment_id": event.appointment_id,
            "scheduled_start": scheduled_start.isoformat(),
            "appointment_type": event.appointment_type,
        },
        {"phone": phone},
    )
    return {"ok": True, "patient_id": event.patient_id, "appointment_id": event.appointment_id}


async def process_visit_reminders(now_utc: datetime | None = None) -> dict:
    now = _utc(now_utc)
    created = 0
    escalated = 0
    nurse_alerted = 0
    whatsapp_messages_sent = 0
    patient_calls_triggered = 0
    next_of_kin_calls_triggered = 0
    day_of_reminders_sent = 0

    due_for_stage1 = db.list_appointments_for_initial_reminder(now)
    for appt in due_for_stage1:
        phone = str(appt.get("phone") or "").strip()
        if not phone:
            db.create_staff_task(str(appt["patient_id"]), "Patient has no phone for T-2 reminder")
            continue

        name = _patient_name(appt)
        start_at = appt["scheduled_start"].astimezone(timezone.utc)
        await send_text_message(
            phone,
            _patient_message(
                appt,
                f"This is a reminder that your clinic visit is scheduled for {_fmt_slot(start_at)}.",
                "Please reply YES to confirm that you will attend.",
            ),
        )
        db.create_reminder_workflow(
            appointment_id=str(appt["appointment_id"]),
            patient_id=str(appt["patient_id"]),
            scheduled_start=appt["scheduled_start"],
            stage="stage2_text",
            status="pending_ack",
            next_action_at=now + _ack_wait_stage1(),
        )
        db.add_audit_log(
            "REMINDER_STAGE1_SENT",
            "SYSTEM",
            str(appt["patient_id"]),
            {"appointment_id": str(appt["appointment_id"])},
            {"next_action_at": (now + _ack_wait_stage1()).isoformat()},
        )
        created += 1
        whatsapp_messages_sent += 1

    due_workflows = db.list_due_reminder_workflows(now)
    for workflow in due_workflows:
        patient_id = str(workflow["patient_id"])
        phone = str(workflow.get("phone") or "").strip()
        call_phone = str(workflow.get("call_trigger_phone") or "").strip() or phone
        next_of_kin_phone = str(workflow.get("next_of_kin_phone") or "").strip()
        next_of_kin_name = str(workflow.get("next_of_kin_name") or "").strip() or "next of kin"
        stage = str(workflow.get("stage") or "")
        name = _patient_name(workflow)

        if stage == "stage1_text":
            if phone:
                await send_text_message(
                    phone,
                    _patient_message(
                        workflow,
                        f"This is a reminder that your clinic visit is scheduled for {_fmt_slot(workflow['scheduled_start'])}.",
                        "Please reply YES to confirm that you will attend.",
                    ),
                )
            db.advance_reminder_workflow(
                reminder_id=str(workflow["reminder_id"]),
                stage="stage2_text",
                status="pending_ack",
                next_action_at=now + _ack_wait_stage1(),
            )
            db.add_audit_log(
                "REMINDER_STAGE1_SENT",
                "SYSTEM",
                patient_id,
                {"reminder_id": str(workflow["reminder_id"])},
                {"next_action_at": (now + _ack_wait_stage1()).isoformat()},
            )
            whatsapp_messages_sent += 1
            continue

        if stage == "stage2_text":
            if phone:
                await send_text_message(
                    phone,
                    _patient_message(
                        workflow,
                        "This is a second reminder regarding your clinic appointment.",
                        "Please reply YES within 3 hours to confirm your visit.",
                    ),
                )
            db.create_staff_task(
                patient_id,
                "Patient missed the first WhatsApp reminder. Keep monitoring for a reply before call escalation.",
            )
            db.advance_reminder_workflow(
                reminder_id=str(workflow["reminder_id"]),
                stage="stage3_text",
                status="pending_ack",
                next_action_at=now + _ack_wait_stage3(),
            )
            db.add_audit_log(
                "REMINDER_STAGE2_SENT",
                "SYSTEM",
                patient_id,
                {"reminder_id": str(workflow["reminder_id"])},
                {"next_action_at": (now + _ack_wait_stage3()).isoformat()},
            )
            escalated += 1
            whatsapp_messages_sent += 1
            continue

        if stage == "stage3_text":
            if phone:
                await send_text_message(
                    phone,
                    _patient_message(
                        workflow,
                        "This is your final WhatsApp reminder regarding your clinic appointment.",
                        "Please reply YES within 3 hours. If we do not receive your confirmation, we will place a confirmation call.",
                    ),
                )
            db.advance_reminder_workflow(
                reminder_id=str(workflow["reminder_id"]),
                stage="stage4_patient_call",
                status="pending_ack",
                next_action_at=now + _ack_wait_after_call(),
            )
            db.add_audit_log(
                "REMINDER_STAGE3_SENT",
                "SYSTEM",
                patient_id,
                {"reminder_id": str(workflow["reminder_id"])},
                {"next_action_at": (now + _ack_wait_after_call()).isoformat()},
            )
            escalated += 1
            whatsapp_messages_sent += 1
            continue

        if stage == "stage4_patient_call":
            db.create_staff_task(
                patient_id,
                "Trigger patient confirmation call. Ask the patient to press 1 to confirm the next appointment. "
                f"Patient call number: {call_phone or 'unavailable'}.",
            )
            if phone:
                await send_text_message(
                    phone,
                    _patient_message(
                        workflow,
                        "We have not yet received your appointment confirmation.",
                        "Please answer the upcoming call and press 1 to confirm your visit.",
                    ),
                )
            db.advance_reminder_workflow(
                reminder_id=str(workflow["reminder_id"]),
                stage="stage5_next_of_kin_call",
                status="pending_ack",
                next_action_at=now + _ack_wait_after_call(),
                mark_auto_call=True,
            )
            db.add_audit_log(
                "REMINDER_PATIENT_CALL_TRIGGERED",
                "SYSTEM",
                patient_id,
                {"reminder_id": str(workflow["reminder_id"])},
                {"call_phone": call_phone or None, "next_action_at": (now + _ack_wait_after_call()).isoformat()},
            )
            escalated += 1
            patient_calls_triggered += 1
            continue

        if stage == "stage5_next_of_kin_call":
            if next_of_kin_phone:
                db.create_staff_task(
                    patient_id,
                    "Patient call was not confirmed. "
                    f"Call {next_of_kin_name} on {next_of_kin_phone} and request appointment confirmation or wellness follow-up.",
                )
                db.add_audit_log(
                    "REMINDER_NEXT_OF_KIN_CALL_TRIGGERED",
                    "SYSTEM",
                    patient_id,
                    {"reminder_id": str(workflow["reminder_id"])},
                    {
                        "next_of_kin_name": next_of_kin_name,
                        "next_of_kin_phone": next_of_kin_phone,
                        "next_action_at": (now + _ack_wait_after_next_of_kin()).isoformat(),
                    },
                )
                next_of_kin_calls_triggered += 1
            else:
                db.create_staff_task(
                    patient_id,
                    "Patient call was not confirmed and no next-of-kin phone is recorded. Escalate directly to home-based care or nursing outreach.",
                )
                db.add_audit_log(
                    "REMINDER_NEXT_OF_KIN_CALL_SKIPPED",
                    "SYSTEM",
                    patient_id,
                    {"reminder_id": str(workflow["reminder_id"])},
                    {"reason": "No next-of-kin phone available"},
                )

            db.advance_reminder_workflow(
                reminder_id=str(workflow["reminder_id"]),
                stage="stage6_homebase_alert",
                status="pending_ack",
                next_action_at=now + _ack_wait_after_next_of_kin(),
                mark_next_of_kin_call=bool(next_of_kin_phone),
            )
            escalated += 1
            continue

        if stage == "stage6_homebase_alert":
            location = db.get_patient_location_snapshot(patient_id)
            staff_message = (
                "Home visit escalation: patient did not confirm through three WhatsApp reminders, the patient call, or next-of-kin outreach. "
                + _format_location_for_staff(location)
            )
            db.create_staff_task(patient_id, staff_message)
            if settings.nurse_alert_phone:
                await send_text_message(settings.nurse_alert_phone, staff_message)
            if settings.homebase_alert_phone and settings.homebase_alert_phone != settings.nurse_alert_phone:
                await send_text_message(settings.homebase_alert_phone, staff_message)
            db.advance_reminder_workflow(
                reminder_id=str(workflow["reminder_id"]),
                stage="stage7_home_visit_escalated",
                status="escalated_home_visit",
                next_action_at=None,
                mark_nurse_alert=True,
            )
            db.add_audit_log(
                "REMINDER_HOME_VISIT_ESCALATED",
                "SYSTEM",
                patient_id,
                {"reminder_id": str(workflow["reminder_id"])},
                location,
            )
            escalated += 1
            nurse_alerted += 1
            continue

        if stage == "stage_confirmed_day_of_pending":
            if phone:
                await send_text_message(
                    phone,
                    _patient_message(
                        workflow,
                        f"This is a same-day reminder that your clinic visit is today at {_fmt_slot(workflow['scheduled_start'])}.",
                        "We look forward to seeing you.",
                    ),
                )
            db.advance_reminder_workflow(
                reminder_id=str(workflow["reminder_id"]),
                stage="stage_day_of_reminder_sent",
                status="completed",
                next_action_at=None,
                mark_day_of_reminder=True,
            )
            db.add_audit_log(
                "REMINDER_DAY_OF_SENT",
                "SYSTEM",
                patient_id,
                {"reminder_id": str(workflow["reminder_id"])},
                {"scheduled_start": workflow["scheduled_start"].isoformat()},
            )
            day_of_reminders_sent += 1
            whatsapp_messages_sent += 1

    return {
        "ok": True,
        "created_stage1": created,
        "escalated": escalated,
        "nurse_alerted": nurse_alerted,
        "whatsapp_messages_sent": whatsapp_messages_sent,
        "patient_calls_triggered": patient_calls_triggered,
        "next_of_kin_calls_triggered": next_of_kin_calls_triggered,
        "day_of_reminders_sent": day_of_reminders_sent,
        "processed_at": now.isoformat(),
    }


async def _create_on_demand_hold(
    patient: dict,
    from_phone: str,
    *,
    existing_appointment: dict | None = None,
) -> dict:
    now = datetime.now(timezone.utc)
    if existing_appointment:
        scheduled_start = existing_appointment["scheduled_start"].astimezone(timezone.utc)
        window_start = max(now + timedelta(hours=1), scheduled_start - timedelta(days=2))
        window_end = scheduled_start + timedelta(days=7)
    else:
        window_start = now + timedelta(hours=1)
        window_end = now + timedelta(days=7)
    slots = db.find_available_slots(window_start, window_end)

    if not slots:
        db.create_staff_task(str(patient["id"]), "Patient requested WhatsApp scheduling but no slot was available")
        await send_text_message(
            from_phone,
            _patient_message(
                patient,
                "We could not find an available appointment slot at the moment.",
                "A member of the clinic team will contact you shortly to assist with scheduling.",
            ),
        )
        return {"ok": False, "error": "No slots"}

    selected_start, selected_end = slots[0]
    expires_at = now + timedelta(hours=2)
    options = [
        {
            "start_at": slot_start.isoformat(),
            "end_at": slot_end.isoformat(),
            "label": _fmt_slot(slot_start),
        }
        for slot_start, slot_end in slots
    ]

    hold = db.create_hold(
        patient_id=str(patient["id"]),
        visit_id=f"reschedule:{existing_appointment['id']}" if existing_appointment else f"manual-book-{uuid4().hex[:12]}",
        clinic_id="main-clinic",
        appointment_type=(existing_appointment.get("appointment_type") or "follow_up") if existing_appointment else "follow_up",
        provider_name="Auto Scheduler",
        selected_start_at=selected_start,
        selected_end_at=selected_end,
        options=options,
        expires_at=expires_at,
    )

    set_session(from_phone, {"hold_id": hold["hold_id"], "stage": "awaiting_confirm"})
    options_text = _format_slot_options(options, max_items=5)
    instructions = _slot_selection_instructions(len(options))
    if existing_appointment:
        message = _patient_message(
            patient,
            "We have identified alternative appointment options for you.",
            "Please select your preferred option from the menu below.",
        )
        await send_text_message(
            from_phone,
            message,
        )
        await _send_slot_menu(
            from_phone,
            patient,
            options,
            title="Please select your preferred appointment time.",
        )
    else:
        message = _patient_message(
            patient,
            "The following appointment options are available for your next visit:",
            "Please select your preferred option from the menu below.",
        )
        await send_text_message(
            from_phone,
            message,
        )
        await _send_slot_menu(
            from_phone,
            patient,
            options,
            title="Please select your preferred appointment time.",
        )
    db.add_audit_log("BOOK_REQUEST", "PATIENT", str(patient["id"]), {"text": "BOOK"}, {"hold_id": hold["hold_id"]})
    return {"ok": True, "action": "booked_from_request", "hold_id": hold["hold_id"], "options": options}


async def auto_schedule_from_visit(event: VisitCompletedEvent) -> dict:
    completed_at = _utc(event.completion_time)
    payload = {
        "patient_id": event.patient_id,
        "visit_id": event.visit_id,
        "clinic_id": event.clinic_id,
        "program_code": event.program_code,
        "service_type": event.service_type,
        "completion_time": completed_at.isoformat(),
    }
    db.save_visit_event(payload)

    patient = db.get_patient(event.patient_id)
    if not patient:
        return {"ok": False, "error": "Patient not found"}

    rule = db.get_rule(event.program_code, event.service_type) or {
        "interval_days": 28,
        "window_before_days": 0,
        "window_after_days": 3,
    }

    target = completed_at + timedelta(days=int(rule["interval_days"]))
    window_start = target - timedelta(days=int(rule["window_before_days"]))
    window_end = target + timedelta(days=int(rule["window_after_days"]))

    slots = db.find_available_slots(window_start, window_end)
    if not slots:
        db.create_staff_task(event.patient_id, "No available slot found for auto-scheduling window")
        if patient.get("phone"):
            await send_text_message(
                patient["phone"],
                _patient_message(
                    patient,
                    "We could not find an available appointment slot at the moment.",
                    "A member of the clinic team will contact you shortly to assist with scheduling.",
                ),
            )
        return {"ok": False, "error": "No slots"}

    selected_start, selected_end = slots[0]
    expires_at = datetime.now(timezone.utc) + timedelta(hours=2)
    options = [
        {
            "start_at": slot_start.isoformat(),
            "end_at": slot_end.isoformat(),
            "label": _fmt_slot(slot_start),
        }
        for slot_start, slot_end in slots
    ]

    hold = db.create_hold(
        patient_id=event.patient_id,
        visit_id=event.visit_id,
        clinic_id=event.clinic_id,
        appointment_type=event.service_type if event.service_type in {"routine", "follow_up", "urgent", "telehealth", "screening"} else "follow_up",
        provider_name="Auto Scheduler",
        selected_start_at=selected_start,
        selected_end_at=selected_end,
        options=options,
        expires_at=expires_at,
    )

    if patient.get("phone"):
        set_session(patient["phone"], {"hold_id": hold["hold_id"], "stage": "awaiting_confirm"})
        options_text = _format_slot_options(options, max_items=5)
        instructions = _slot_selection_instructions(len(options))
        message = f"Your next visit has reserved options:\n{options_text}\n{instructions}"
        await send_text_message(
            patient["phone"],
            _patient_message(
                patient,
                "Your next clinic visit is ready to be scheduled.",
                "Please select your preferred option from the menu below.",
            ),
        )
        await _send_slot_menu(
            patient["phone"],
            patient,
            options,
            title="Please select your preferred appointment time.",
        )

    db.add_audit_log("HOLD_APPOINTMENT", "SYSTEM", event.patient_id, payload, {"hold_id": hold["hold_id"]})
    return {"ok": True, "hold_id": hold["hold_id"], "options": options}


async def confirm_reminder_from_call(patient_id: str, source: str, confirmed_by: str, digits: str = "1") -> dict:
    patient = db.get_patient(patient_id)
    if not patient:
        return {"ok": False, "error": "Patient not found"}

    phone = str(patient.get("phone") or "").strip()
    if not db.patient_has_pending_reminder(patient_id):
        return {"ok": False, "error": "No pending reminder workflow"}

    reminder_ack = await _acknowledge_visit_reminder(patient, phone or str(patient.get("call_trigger_phone") or "").strip(), f"ivr_{source}", digits)
    if not reminder_ack:
        return {"ok": False, "error": "Reminder acknowledgement failed"}

    db.add_audit_log(
        "REMINDER_CALL_CONFIRMED",
        "SYSTEM",
        patient_id,
        {"source": source, "confirmed_by": confirmed_by, "digits": digits},
        {"status": "confirmed_waiting_day_of"},
    )
    return {"ok": True, "patient_id": patient_id, "source": source, "confirmed_by": confirmed_by}


async def handle_patient_message(from_phone: str, text: str) -> dict:
    async def _confirm_current_hold(session_payload: dict, hold_payload: dict, source_text: str) -> dict:
        try:
            visit_id = str(hold_payload.get("visit_id") or "")
            if visit_id.startswith("reschedule:"):
                appointment_id = visit_id.split(":", 1)[1]
                db.reschedule_appointment(appointment_id, str(patient["id"]), hold_payload["selected_start_at"], hold_payload["selected_end_at"])
            else:
                appointment_id = db.create_appointment_from_hold(hold_payload)
            db.mark_hold_confirmed(session_payload["hold_id"])
            clear_session(from_phone)
        except Exception:
            db.create_staff_task(str(patient["id"]), "WhatsApp appointment confirmation failed. Please confirm booking manually with the patient.")
            await send_text_message(
                from_phone,
                _patient_message(
                    patient,
                    "We were unable to confirm that appointment slot at this time.",
                    "A member of the clinic team will contact you shortly to assist further.",
                ),
            )
            return {"ok": False, "error": "Confirmation failed"}

        confirmation_text = _patient_message(
            patient,
            f"Your appointment has been confirmed for {_fmt_slot(hold_payload['selected_start_at'])}.",
            "We will send you an additional reminder on the day of your visit.",
        )
        for recipient in _confirmation_recipients(patient, from_phone):
            await send_text_message(recipient, confirmation_text)
        db.add_audit_log(
            "CONFIRM_APPOINTMENT",
            "PATIENT",
            str(patient["id"]),
            {"text": source_text},
            {"hold_id": session_payload["hold_id"], "appointment_id": appointment_id},
        )
        return {"ok": True, "action": "confirmed", "appointment_id": appointment_id}

    normalized = text.strip().lower()
    if normalized.startswith("slot:"):
        text = normalized.split(":", 1)[1]
        normalized = text.strip().lower()
    elif normalized.startswith("menu:"):
        menu_action = normalized.split(":", 1)[1]
        if menu_action == "book":
            text = "book"
        elif menu_action == "reschedule":
            text = "reschedule"
        elif menu_action == "view":
            text = "hi"
        normalized = text.strip().lower()
    patient = db.get_patient_by_phone(from_phone)
    if not patient:
        if normalized in {"hi", "hello", "hey"}:
            await send_text_message(
                from_phone,
                _generic_message(
                    "This number is not yet linked to a patient profile.",
                    "Please contact clinic reception for assistance.",
                ),
            )
            return {"ok": False, "error": "Patient not linked"}
        await send_text_message(
            from_phone,
            _generic_message(
                "This number is not yet linked to a patient profile.",
                "Please contact clinic reception for assistance.",
            ),
        )
        return {"ok": False, "error": "Patient not linked"}

    is_ack = normalized in {"1", "yes", "y", "ok", "okay", "confirm", "ack", "acknowledge"}
    if is_ack and db.patient_has_pending_reminder(str(patient["id"])):
        reminder_ack = await _acknowledge_visit_reminder(patient, from_phone, "whatsapp", text)
        if reminder_ack:
            return {"ok": True, "action": "reminder_acknowledged"}

    if normalized in {"hi", "hello", "hey"}:
        next_appointment = db.get_next_scheduled_appointment(str(patient["id"]))
        if next_appointment:
            await send_text_message(
                from_phone,
                _patient_message(
                    patient,
                    f"Your next appointment is scheduled for {_fmt_slot(next_appointment['scheduled_start'])}.",
                    "Please select an option from the menu below.",
                ),
            )
            await _send_main_menu(from_phone, patient, has_next_appointment=True)
            return {"ok": True, "action": "greeted_with_context"}
        await send_text_message(
            from_phone,
            _patient_message(
                patient,
                "We can assist with your next appointment.",
                "Please select an option from the menu below.",
            ),
        )
        await _send_main_menu(from_phone, patient, has_next_appointment=False)
        return {"ok": True, "action": "greeted"}

    intent = classify_patient_intent(text)
    session = get_session(from_phone)
    if not session or "hold_id" not in session:
        recovered_hold = db.get_latest_active_hold(str(patient["id"]))
        if recovered_hold:
            if recovered_hold["expires_at"].astimezone(timezone.utc) < datetime.now(timezone.utc):
                db.mark_hold_expired(str(recovered_hold["hold_id"]))
            else:
                session = {"hold_id": str(recovered_hold["hold_id"]), "stage": "awaiting_confirm"}
                set_session(from_phone, session)

    if not session or "hold_id" not in session:
        if intent == "change":
            current = db.get_next_scheduled_appointment(str(patient["id"]))
            if current:
                return await _create_on_demand_hold(patient, from_phone, existing_appointment=current)
            await send_text_message(
                from_phone,
                _patient_message(
                    patient,
                    "We could not find an active appointment to reschedule.",
                    "Reply BOOK to request a new appointment.",
                ),
            )
            return {"ok": False, "error": "No appointment to reschedule"}
        if intent == "book":
            return await _create_on_demand_hold(patient, from_phone)
        current = db.get_next_scheduled_appointment(str(patient["id"]))
        if current:
            await send_text_message(
                from_phone,
                _patient_message(
                    patient,
                    f"There is no pending proposal at the moment. Your next appointment is scheduled for {_fmt_slot(current['scheduled_start'])}.",
                    "Reply RESCHEDULE to move this appointment, or reply BOOK to request a new booking.",
                ),
            )
            return {"ok": False, "error": "No session"}
        await send_text_message(
            from_phone,
            _patient_message(
                patient,
                "There is no pending appointment proposal at the moment.",
                "Reply BOOK to request an available appointment slot.",
            ),
        )
        return {"ok": False, "error": "No session"}

    hold = db.get_hold(session["hold_id"])
    if not hold:
        clear_session(from_phone)
        await send_text_message(
            from_phone,
            _patient_message(
                patient,
                "Your appointment proposal has expired.",
                "Reply BOOK to request a new set of available options.",
            ),
        )
        return {"ok": False, "error": "Hold not found"}

    if hold.get("status") != "PROPOSED":
        clear_session(from_phone)
        if intent == "book":
            return await _create_on_demand_hold(patient, from_phone)
        await send_text_message(
            from_phone,
            _patient_message(
                patient,
                "There is no pending appointment proposal at the moment.",
                "Reply BOOK to request an available appointment slot.",
            ),
        )
        return {"ok": False, "error": "No active hold"}

    if hold["expires_at"].astimezone(timezone.utc) < datetime.now(timezone.utc):
        db.mark_hold_expired(session["hold_id"])
        clear_session(from_phone)
        await send_text_message(
            from_phone,
            _patient_message(
                patient,
                "Your reserved appointment slot has expired.",
                "Reply BOOK to request a new appointment slot.",
            ),
        )
        return {"ok": False, "error": "Expired"}

    # Numeric replies map to the visible options list (up to 5) and confirm immediately.
    if session.get("stage") == "awaiting_confirm" and text.strip().isdigit():
        idx = int(text.strip()) - 1
        options = hold.get("option_slots") or []
        max_selectable = min(5, len(options))
        if 0 <= idx < max_selectable:
            choice = options[idx]
            start_at = datetime.fromisoformat(choice["start_at"])
            end_at = datetime.fromisoformat(choice["end_at"])
            db.update_hold_choice(session["hold_id"], start_at, end_at)
            db.add_audit_log(
                "HOLD_OPTION_SELECTED",
                "PATIENT",
                str(patient["id"]),
                {"text": text},
                {"hold_id": session["hold_id"], "selected_index": idx + 1},
            )
            refreshed_hold = db.get_hold(session["hold_id"])
            if not refreshed_hold:
                clear_session(from_phone)
                await send_text_message(
                    from_phone,
                    _patient_message(
                        patient,
                        "Your reserved appointment slot has expired.",
                        "Reply BOOK to request a new appointment slot.",
                    ),
                )
                return {"ok": False, "error": "Hold not found after selection"}
            return await _confirm_current_hold(session, refreshed_hold, text)
        if options and (idx < 0 or idx >= max_selectable):
            await send_text_message(
                from_phone,
                _patient_message(
                    patient,
                    "Please select one of the available appointment options below.",
                    "Use the menu below to choose your preferred appointment time.",
                ),
            )
            await _send_slot_menu(
                from_phone,
                patient,
                options,
                title="Please select your preferred appointment time.",
            )
            return {"ok": True, "action": "re_prompted_choice"}

    if session.get("stage") == "awaiting_confirm":
        options = hold.get("option_slots") or []
        selected_idx = _match_slot_choice(text, options)
        max_selectable = min(5, len(options))
        if selected_idx is not None and 0 <= selected_idx < max_selectable:
            choice = options[selected_idx]
            start_at = datetime.fromisoformat(choice["start_at"])
            end_at = datetime.fromisoformat(choice["end_at"])
            db.update_hold_choice(session["hold_id"], start_at, end_at)
            db.add_audit_log(
                "HOLD_OPTION_SELECTED",
                "PATIENT",
                str(patient["id"]),
                {"text": text},
                {"hold_id": session["hold_id"], "selected_index": selected_idx + 1},
            )
            refreshed_hold = db.get_hold(session["hold_id"])
            if not refreshed_hold:
                clear_session(from_phone)
                await send_text_message(
                    from_phone,
                    _patient_message(
                        patient,
                        "Your reserved appointment slot has expired.",
                        "Reply BOOK to request a new appointment slot.",
                    ),
                )
                return {"ok": False, "error": "Hold not found after selection"}
            return await _confirm_current_hold(session, refreshed_hold, text)

    if session.get("stage") == "awaiting_option" and text.strip().isdigit():
        idx = int(text.strip()) - 1
        options = hold.get("option_slots") or []
        max_selectable = min(5, len(options))
        if 0 <= idx < max_selectable:
            choice = options[idx]
            start_at = datetime.fromisoformat(choice["start_at"])
            end_at = datetime.fromisoformat(choice["end_at"])
            db.update_hold_choice(session["hold_id"], start_at, end_at)
            refreshed_hold = db.get_hold(session["hold_id"])
            if not refreshed_hold:
                clear_session(from_phone)
                await send_text_message(
                    from_phone,
                    _patient_message(
                        patient,
                        "Your reserved appointment slot has expired.",
                        "Reply BOOK to request a new appointment slot.",
                    ),
                )
                return {"ok": False, "error": "Hold not found after selection"}
            return await _confirm_current_hold(session, refreshed_hold, text)
        if options and (idx < 0 or idx >= max_selectable):
            await send_text_message(
                from_phone,
                _patient_message(
                    patient,
                    "Please select one of the available appointment options below.",
                    "Use the menu below to choose your preferred appointment time.",
                ),
            )
            await _send_slot_menu(
                from_phone,
                patient,
                options,
                title="Please select your preferred appointment time.",
            )
            return {"ok": True, "action": "re_prompted_choice"}

    if session.get("stage") == "awaiting_option":
        options = hold.get("option_slots") or []
        selected_idx = _match_slot_choice(text, options)
        max_selectable = min(5, len(options))
        if selected_idx is not None and 0 <= selected_idx < max_selectable:
            choice = options[selected_idx]
            start_at = datetime.fromisoformat(choice["start_at"])
            end_at = datetime.fromisoformat(choice["end_at"])
            db.update_hold_choice(session["hold_id"], start_at, end_at)
            refreshed_hold = db.get_hold(session["hold_id"])
            if not refreshed_hold:
                clear_session(from_phone)
                await send_text_message(
                    from_phone,
                    _patient_message(
                        patient,
                        "Your reserved appointment slot has expired.",
                        "Reply BOOK to request a new appointment slot.",
                    ),
                )
                return {"ok": False, "error": "Hold not found after selection"}
            return await _confirm_current_hold(session, refreshed_hold, text)

    if intent == "confirm":
        return await _confirm_current_hold(session, hold, text)

    if intent == "change":
        options = hold.get("option_slots") or []
        message = _patient_message(
            patient,
            "Please select an alternative appointment option from the list below.",
            "Use the menu below to choose your preferred appointment time.",
        )
        set_session(from_phone, {"hold_id": session["hold_id"], "stage": "awaiting_option"})
        await send_text_message(from_phone, message)
        await _send_slot_menu(
            from_phone,
            patient,
            options,
            title="Please select your preferred appointment time.",
        )
        return {"ok": True, "action": "presented_options"}

    if intent == "book":
        options = hold.get("option_slots") or []
        await send_text_message(
            from_phone,
            _patient_message(
                patient,
                "You already have a pending appointment proposal.",
                "Please select your preferred appointment time from the menu below.",
            ),
        )
        await _send_slot_menu(
            from_phone,
            patient,
            options,
            title="Please select your preferred appointment time.",
        )
        return {"ok": True, "action": "existing_hold_prompted"}

    await send_text_message(
        from_phone,
        _patient_message(
            patient,
            "Reply 1 to confirm your appointment, or reply 2 to review alternative times.",
        ),
    )
    return {"ok": True, "action": "prompted_again"}

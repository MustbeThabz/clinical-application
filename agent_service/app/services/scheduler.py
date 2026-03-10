from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app import db
from app.config import settings
from app.redis_store import clear_session, get_session, set_session
from app.schemas import AppointmentScheduledEvent, VisitCompletedEvent
from app.services.llm import classify_patient_intent
from app.services.whatsapp import send_text_message


def _utc(dt: datetime | None) -> datetime:
    if dt is None:
        return datetime.now(timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _fmt_slot(start_at: datetime) -> str:
    return start_at.strftime("%a %d %b %H:%M UTC")


def _patient_name(patient: dict) -> str:
    first = str(patient.get("first_name") or "").strip()
    return first or "there"


def _ack_wait_stage1() -> timedelta:
    return timedelta(hours=max(1, settings.reminder_ack_wait_hours_stage1))


def _ack_wait_stage2() -> timedelta:
    return timedelta(hours=max(1, settings.reminder_ack_wait_hours_stage2))


def _ack_wait_after_call() -> timedelta:
    return timedelta(hours=max(1, settings.reminder_ack_wait_hours_after_call))


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
        f"Hi {_patient_name(patient)}, your next visit is scheduled for {_fmt_slot(scheduled_start)} with {event.provider_name}. Reply YES to acknowledge.",
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
            f"Hi {name}, reminder: you have a clinic visit on {_fmt_slot(start_at)}. Reply YES to acknowledge.",
        )
        db.create_reminder_workflow(
            appointment_id=str(appt["appointment_id"]),
            patient_id=str(appt["patient_id"]),
            scheduled_start=appt["scheduled_start"],
            stage="stage1_text",
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

    due_workflows = db.list_due_reminder_workflows(now)
    for workflow in due_workflows:
        patient_id = str(workflow["patient_id"])
        phone = str(workflow.get("phone") or "").strip()
        call_phone = str(workflow.get("call_trigger_phone") or "").strip() or phone
        stage = str(workflow.get("stage") or "")

        if stage == "stage1_text":
            if phone:
                await send_text_message(
                    phone,
                    "Second reminder: please acknowledge your upcoming visit by replying YES.",
                )
            db.advance_reminder_workflow(
                reminder_id=str(workflow["reminder_id"]),
                stage="stage2_text",
                status="pending_ack",
                next_action_at=now + _ack_wait_stage2(),
            )
            db.add_audit_log(
                "REMINDER_STAGE2_SENT",
                "SYSTEM",
                patient_id,
                {"reminder_id": str(workflow["reminder_id"])},
                {"next_action_at": (now + _ack_wait_stage2()).isoformat()},
            )
            escalated += 1
            continue

        if stage == "stage2_text":
            db.create_staff_task(
                patient_id,
                f"Auto-call escalation required: patient did not acknowledge two reminder messages. Call trigger number: {call_phone or 'unavailable'}.",
            )
            if phone:
                await send_text_message(
                    phone,
                    "We attempted to reach you for visit confirmation. Please reply YES to avoid a home-visit escalation.",
                )
            db.advance_reminder_workflow(
                reminder_id=str(workflow["reminder_id"]),
                stage="stage3_auto_call",
                status="pending_ack",
                next_action_at=now + _ack_wait_after_call(),
                mark_auto_call=True,
            )
            db.add_audit_log(
                "REMINDER_AUTO_CALL_TRIGGERED",
                "SYSTEM",
                patient_id,
                {"reminder_id": str(workflow["reminder_id"])},
                {"next_action_at": (now + _ack_wait_after_call()).isoformat()},
            )
            escalated += 1
            continue

        if stage == "stage3_auto_call":
            location = db.get_patient_location_snapshot(patient_id)
            staff_message = (
                "Home visit escalation: patient did not respond to reminder text(s) or auto-call. "
                + _format_location_for_staff(location)
            )
            db.create_staff_task(patient_id, staff_message)
            if settings.nurse_alert_phone:
                await send_text_message(settings.nurse_alert_phone, staff_message)
            db.advance_reminder_workflow(
                reminder_id=str(workflow["reminder_id"]),
                stage="stage4_nurse_alerted",
                status="escalated_home_visit",
                next_action_at=None,
                mark_nurse_alert=True,
            )
            db.add_audit_log(
                "REMINDER_NURSE_ALERTED",
                "SYSTEM",
                patient_id,
                {"reminder_id": str(workflow["reminder_id"])},
                location,
            )
            escalated += 1
            nurse_alerted += 1

    return {
        "ok": True,
        "created_stage1": created,
        "escalated": escalated,
        "nurse_alerted": nurse_alerted,
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
            f"Sorry {_patient_name(patient)} 🙏 We could not find a free slot right now. A clinic staff member will contact you soon.",
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
    if existing_appointment:
        await send_text_message(
            from_phone,
            f"Great {_patient_name(patient)} 👍 I found new options for your appointment. Proposed time: {_fmt_slot(selected_start)}. Reply 1 to CONFIRM or 2 to CHANGE.",
        )
    else:
        await send_text_message(
            from_phone,
            f"Hi {_patient_name(patient)} 👋 I found an available slot: {_fmt_slot(selected_start)}. Reply 1 to CONFIRM or 2 to CHANGE.",
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
                "We could not find an available slot right now. A clinic staff member will contact you.",
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
        await send_text_message(
            patient["phone"],
            "Your next visit was reserved: "
            f"{_fmt_slot(selected_start)}. Reply 1 to CONFIRM or 2 to CHANGE.",
        )

    db.add_audit_log("HOLD_APPOINTMENT", "SYSTEM", event.patient_id, payload, {"hold_id": hold["hold_id"]})
    return {"ok": True, "hold_id": hold["hold_id"], "options": options}


async def handle_patient_message(from_phone: str, text: str) -> dict:
    normalized = text.strip().lower()
    patient = db.get_patient_by_phone(from_phone)
    if not patient:
        if normalized in {"hi", "hello", "hey"}:
            await send_text_message(
                from_phone,
                "Hello 👋 This number is not linked to a patient profile yet. Please contact clinic reception to register.",
            )
            return {"ok": False, "error": "Patient not linked"}
        await send_text_message(from_phone, "Your number is not linked yet. Please contact clinic reception 🙏.")
        return {"ok": False, "error": "Patient not linked"}

    is_ack = normalized in {"1", "yes", "y", "ok", "okay", "confirm", "ack", "acknowledge"}
    if is_ack and db.patient_has_pending_reminder(str(patient["id"])):
        reminder_ack = db.acknowledge_pending_reminder(str(patient["id"]), "whatsapp", text)
        if reminder_ack:
            await send_text_message(from_phone, f"Thanks {_patient_name(patient)}. Your visit reminder has been acknowledged ✅.")
            return {"ok": True, "action": "reminder_acknowledged"}

    if normalized in {"hi", "hello", "hey"}:
        next_appointment = db.get_next_scheduled_appointment(str(patient["id"]))
        if next_appointment:
            await send_text_message(
                from_phone,
                f"Hi {_patient_name(patient)} 👋 Your next appointment is {_fmt_slot(next_appointment['scheduled_start'])}. Reply RESCHEDULE to change it or BOOK for a new request 📅.",
            )
            return {"ok": True, "action": "greeted_with_context"}
        await send_text_message(
            from_phone,
            f"Hi {_patient_name(patient)} 👋 I can help with your next appointment. Reply BOOK to request an available slot 📅.",
        )
        return {"ok": True, "action": "greeted"}

    intent = classify_patient_intent(text)
    session = get_session(from_phone)
    if not session or "hold_id" not in session:
        if intent == "change":
            current = db.get_next_scheduled_appointment(str(patient["id"]))
            if current:
                return await _create_on_demand_hold(patient, from_phone, existing_appointment=current)
            await send_text_message(from_phone, f"I couldn't find an active appointment to reschedule, {_patient_name(patient)}. Reply BOOK to request one 📅.")
            return {"ok": False, "error": "No appointment to reschedule"}
        if intent == "book":
            return await _create_on_demand_hold(patient, from_phone)
        current = db.get_next_scheduled_appointment(str(patient["id"]))
        if current:
            await send_text_message(
                from_phone,
                f"No pending proposal right now. Your next appointment is {_fmt_slot(current['scheduled_start'])}. Reply RESCHEDULE to move it or BOOK for a new request ✨.",
            )
            return {"ok": False, "error": "No session"}
        await send_text_message(from_phone, f"No pending appointment proposal. Reply BOOK to request one 📅.")
        return {"ok": False, "error": "No session"}

    hold = db.get_hold(session["hold_id"])
    if not hold:
        clear_session(from_phone)
        await send_text_message(from_phone, "Your proposed slot expired ⏰ Reply BOOK for new options.")
        return {"ok": False, "error": "Hold not found"}

    if hold.get("status") != "PROPOSED":
        clear_session(from_phone)
        if intent == "book":
            return await _create_on_demand_hold(patient, from_phone)
        await send_text_message(from_phone, "No pending appointment proposal. Reply BOOK to request one 📅.")
        return {"ok": False, "error": "No active hold"}

    if hold["expires_at"].astimezone(timezone.utc) < datetime.now(timezone.utc):
        db.mark_hold_expired(session["hold_id"])
        clear_session(from_phone)
        await send_text_message(from_phone, "Your reserved slot expired ⏰ Reply BOOK to schedule again.")
        return {"ok": False, "error": "Expired"}

    if session.get("stage") == "awaiting_option" and text.strip().isdigit():
        idx = int(text.strip()) - 1
        options = hold.get("option_slots") or []
        if 0 <= idx < len(options):
            choice = options[idx]
            start_at = datetime.fromisoformat(choice["start_at"])
            end_at = datetime.fromisoformat(choice["end_at"])
            db.update_hold_choice(session["hold_id"], start_at, end_at)
            set_session(from_phone, {"hold_id": session["hold_id"], "stage": "awaiting_confirm"})
            await send_text_message(from_phone, f"Updated to {choice['label']} ✅ Reply 1 to CONFIRM.")
            return {"ok": True, "action": "updated_choice"}

    if intent == "confirm":
        visit_id = str(hold.get("visit_id") or "")
        if visit_id.startswith("reschedule:"):
            appointment_id = visit_id.split(":", 1)[1]
            db.reschedule_appointment(appointment_id, hold["selected_start_at"], hold["selected_end_at"])
        else:
            db.create_appointment_from_hold(hold)
        db.mark_hold_confirmed(session["hold_id"])
        clear_session(from_phone)
        await send_text_message(from_phone, f"Confirmed ✅ {_patient_name(patient)}, your next visit is {_fmt_slot(hold['selected_start_at'])}.")
        db.add_audit_log("CONFIRM_APPOINTMENT", "PATIENT", str(patient["id"]), {"text": text}, {"hold_id": session["hold_id"]})
        return {"ok": True, "action": "confirmed"}

    if intent == "change":
        options = hold.get("option_slots") or []
        message = "Pick a different time ⏱️:\n" + "\n".join(f"{idx + 1}) {item['label']}" for idx, item in enumerate(options))
        set_session(from_phone, {"hold_id": session["hold_id"], "stage": "awaiting_option"})
        await send_text_message(from_phone, message)
        return {"ok": True, "action": "presented_options"}

    if intent == "book":
        await send_text_message(from_phone, "You already have a pending proposal. Reply 1 to confirm or 2 to change 🙂.")
        return {"ok": True, "action": "existing_hold_prompted"}

    await send_text_message(from_phone, "I can help you quickly 🙂 Reply 1 to confirm or 2 to change your appointment.")
    return {"ok": True, "action": "prompted_again"}

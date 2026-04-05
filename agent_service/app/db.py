from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

import psycopg2
import psycopg2.extras

from .config import settings


CLINIC_TZ = ZoneInfo(settings.clinic_timezone)


@contextmanager
def get_conn():
    conn = psycopg2.connect(settings.database_url)
    try:
        yield conn
    finally:
        conn.close()


def init_schema() -> None:
    sql_path = Path(__file__).resolve().parents[1] / "sql" / "init_agent_schema.sql"
    if not sql_path.exists():
        return

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql_path.read_text(encoding="utf-8"))
        conn.commit()


def fetch_one(sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            return dict(row) if row else None


def fetch_all(sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
            return [dict(row) for row in rows]


def execute(sql: str, params: tuple[Any, ...] = ()) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()


def get_patient_by_phone(phone: str) -> dict[str, Any] | None:
    return fetch_one(
        """
        SELECT id, first_name, last_name, phone, call_trigger_phone, next_of_kin_name, next_of_kin_phone, condition_summary, home_visit_address, home_latitude, home_longitude
        FROM patients
        WHERE regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = regexp_replace(%s, '\\D', '', 'g')
        LIMIT 1
        """,
        (phone,),
    )


def get_patient(patient_id: str) -> dict[str, Any] | None:
    return fetch_one(
        """
        SELECT id, first_name, last_name, phone, call_trigger_phone, next_of_kin_name, next_of_kin_phone, condition_summary, home_visit_address, home_latitude, home_longitude
        FROM patients
        WHERE id = %s::uuid
        LIMIT 1
        """,
        (patient_id,),
    )


def save_visit_event(payload: dict[str, Any]) -> None:
    execute(
        """
        INSERT INTO visit_events (event_type, visit_id, patient_id, clinic_id, program_code, service_type, occurred_at, payload)
        VALUES (%s, %s, %s::uuid, %s, %s, %s, %s, %s::jsonb)
        """,
        (
            "VISIT_COMPLETED",
            payload["visit_id"],
            payload["patient_id"],
            payload["clinic_id"],
            payload["program_code"],
            payload["service_type"],
            payload["completion_time"],
            json.dumps(payload),
        ),
    )


def get_rule(program_code: str, service_type: str) -> dict[str, Any] | None:
    return fetch_one(
        """
        SELECT *
        FROM next_visit_rules
        WHERE is_active = TRUE
          AND (program_code = %s OR program_code = 'DEFAULT')
          AND (service_type = %s OR service_type = 'follow_up')
        ORDER BY priority ASC
        LIMIT 1
        """,
        (program_code, service_type),
    )


def find_available_slots(window_start: datetime, window_end: datetime) -> list[tuple[datetime, datetime]]:
    starts = []
    local_window_start = window_start.astimezone(CLINIC_TZ)
    local_window_end = window_end.astimezone(CLINIC_TZ)
    day = local_window_start.replace(hour=0, minute=0, second=0, microsecond=0)
    end_day = local_window_end.replace(hour=0, minute=0, second=0, microsecond=0)

    while day <= end_day:
        for hour in (9, 11, 14):
            starts.append(day.replace(hour=hour, minute=0, second=0, microsecond=0).astimezone(timezone.utc))
        day += timedelta(days=1)

    blocked = fetch_all(
        """
        SELECT scheduled_start, scheduled_end
        FROM appointments
        WHERE status IN ('scheduled', 'checked_in')
          AND scheduled_start >= %s
          AND scheduled_start <= %s
        ORDER BY scheduled_start ASC
        """,
        (window_start, window_end),
    )

    blocked_ranges = [
        (
            row["scheduled_start"].astimezone(timezone.utc),
            row["scheduled_end"].astimezone(timezone.utc),
        )
        for row in blocked
    ]

    available: list[tuple[datetime, datetime]] = []
    for start in starts:
        end = start + timedelta(minutes=30)
        overlap = any(start < b_end and end > b_start for b_start, b_end in blocked_ranges)
        if not overlap and start >= window_start.astimezone(timezone.utc) and start <= window_end.astimezone(timezone.utc):
            available.append((start, end))

    # Keep WhatsApp option messages short but provide enough choice.
    return available[:5]


def create_hold(
    *,
    patient_id: str,
    visit_id: str,
    clinic_id: str,
    appointment_type: str,
    provider_name: str,
    selected_start_at: datetime,
    selected_end_at: datetime,
    options: list[dict[str, str]],
    expires_at: datetime,
) -> dict[str, Any]:
    hold_id = str(uuid4())
    execute(
        """
        INSERT INTO agent_appointment_holds (
          hold_id, patient_id, visit_id, clinic_id, appointment_type,
          provider_name, selected_start_at, selected_end_at, option_slots, expires_at, status
        )
        VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, 'PROPOSED')
        """,
        (
            hold_id,
            patient_id,
            visit_id,
            clinic_id,
            appointment_type,
            provider_name,
            selected_start_at,
            selected_end_at,
            json.dumps(options),
            expires_at,
        ),
    )

    return {
        "hold_id": hold_id,
        "patient_id": patient_id,
        "clinic_id": clinic_id,
        "appointment_type": appointment_type,
        "provider_name": provider_name,
        "selected_start_at": selected_start_at,
        "selected_end_at": selected_end_at,
        "options": options,
        "expires_at": expires_at,
    }


def get_hold(hold_id: str) -> dict[str, Any] | None:
    return fetch_one(
        """
        SELECT *
        FROM agent_appointment_holds
        WHERE hold_id = %s::uuid
        LIMIT 1
        """,
        (hold_id,),
    )


def get_latest_active_hold(patient_id: str) -> dict[str, Any] | None:
    return fetch_one(
        """
        SELECT *
        FROM agent_appointment_holds
        WHERE patient_id = %s::uuid
          AND status = 'PROPOSED'
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (patient_id,),
    )


def update_hold_choice(hold_id: str, start_at: datetime, end_at: datetime) -> None:
    execute(
        """
        UPDATE agent_appointment_holds
        SET selected_start_at = %s, selected_end_at = %s, updated_at = NOW()
        WHERE hold_id = %s::uuid
        """,
        (start_at, end_at, hold_id),
    )


def mark_hold_confirmed(hold_id: str) -> None:
    execute(
        """
        UPDATE agent_appointment_holds
        SET status = 'CONFIRMED', updated_at = NOW()
        WHERE hold_id = %s::uuid
        """,
        (hold_id,),
    )


def mark_hold_expired(hold_id: str) -> None:
    execute(
        """
        UPDATE agent_appointment_holds
        SET status = 'EXPIRED', updated_at = NOW()
        WHERE hold_id = %s::uuid
        """,
        (hold_id,),
    )


def create_appointment_from_hold(hold: dict[str, Any]) -> str:
    appointment_id = str(uuid4())
    execute(
        """
        INSERT INTO appointments (
          id, patient_id, provider_name, appointment_type,
          scheduled_start, scheduled_end, status, reason, created_at, updated_at
        )
        VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, 'scheduled', %s, NOW(), NOW())
        """,
        (
            appointment_id,
            hold["patient_id"],
            hold["provider_name"],
            hold["appointment_type"],
            hold["selected_start_at"],
            hold["selected_end_at"],
            "Auto-scheduled by WhatsApp agent",
        ),
    )

    execute(
        """
        UPDATE patients
        SET next_appointment = %s::date, updated_at = NOW()
        WHERE id = %s::uuid
        """,
        (hold["selected_start_at"], hold["patient_id"]),
    )

    next_action_at = hold["selected_start_at"] - timedelta(days=2)
    create_reminder_workflow(
        appointment_id=appointment_id,
        patient_id=str(hold["patient_id"]),
        scheduled_start=hold["selected_start_at"],
        stage="stage1_text",
        status="pending_ack",
        next_action_at=next_action_at,
    )
    return appointment_id


def get_next_scheduled_appointment(patient_id: str) -> dict[str, Any] | None:
    return fetch_one(
        """
        SELECT id, patient_id, provider_name, appointment_type, scheduled_start, scheduled_end, status
        FROM appointments
        WHERE patient_id = %s::uuid
          AND status IN ('scheduled', 'checked_in')
          AND scheduled_start >= NOW()
        ORDER BY scheduled_start ASC
        LIMIT 1
        """,
        (patient_id,),
    )


def reschedule_appointment(appointment_id: str, patient_id: str, start_at: datetime, end_at: datetime) -> None:
    execute(
        """
        UPDATE appointments
        SET scheduled_start = %s,
            scheduled_end = %s,
            status = 'scheduled',
            reason = 'Rescheduled via WhatsApp agent',
            updated_at = NOW()
        WHERE id = %s::uuid
        """,
        (start_at, end_at, appointment_id),
    )
    execute(
        """
        UPDATE patients
        SET next_appointment = %s::date, updated_at = NOW()
        WHERE id = %s::uuid
        """,
        (start_at, patient_id),
    )


def create_staff_task(patient_id: str, notes: str) -> None:
    execute(
        """
        INSERT INTO tasks (id, patient_id, task_type, priority, status, due_at, notes, created_at, updated_at)
        VALUES (%s::uuid, %s::uuid, 'outreach', 'high', 'open', NOW() + INTERVAL '1 day', %s, NOW(), NOW())
        """,
        (str(uuid4()), patient_id, notes),
    )


def add_audit_log(action: str, actor: str, patient_id: str | None, request: dict[str, Any], response: dict[str, Any]) -> None:
    execute(
        """
        INSERT INTO agent_audit_log (patient_id, actor, action, request, response, success)
        VALUES (%s::uuid, %s, %s, %s::jsonb, %s::jsonb, TRUE)
        """,
        (
            patient_id,
            actor,
            action,
            json.dumps(request),
            json.dumps(response),
        ),
    )


def list_appointments_for_initial_reminder(now_utc: datetime) -> list[dict[str, Any]]:
    window_start = now_utc + timedelta(days=2)
    window_end = now_utc + timedelta(days=3)
    return fetch_all(
        """
        SELECT a.id AS appointment_id,
               a.patient_id,
               a.scheduled_start,
               a.scheduled_end,
               p.phone,
               p.call_trigger_phone,
               p.next_of_kin_name,
               p.next_of_kin_phone,
               p.first_name,
               p.last_name
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
        LEFT JOIN appointment_reminder_workflows rw ON rw.appointment_id = a.id
        WHERE a.status IN ('scheduled', 'checked_in')
          AND a.scheduled_start >= %s
          AND a.scheduled_start < %s
          AND rw.appointment_id IS NULL
        ORDER BY a.scheduled_start ASC
        """,
        (window_start, window_end),
    )


def create_reminder_workflow(
    *,
    appointment_id: str,
    patient_id: str,
    scheduled_start: datetime,
    stage: str,
    status: str,
    next_action_at: datetime,
) -> None:
    execute(
        """
        INSERT INTO appointment_reminder_workflows (
          appointment_id,
          patient_id,
          scheduled_start,
          stage,
          status,
          last_sent_at,
          next_action_at,
          created_at,
          updated_at
        )
        VALUES (%s::uuid, %s::uuid, %s, %s, %s, NOW(), %s, NOW(), NOW())
        ON CONFLICT (appointment_id) DO NOTHING
        """,
        (appointment_id, patient_id, scheduled_start, stage, status, next_action_at),
    )


def list_due_reminder_workflows(now_utc: datetime) -> list[dict[str, Any]]:
    return fetch_all(
        """
        SELECT rw.reminder_id,
               rw.appointment_id,
               rw.patient_id,
               rw.scheduled_start,
               rw.stage,
               rw.status,
               rw.last_sent_at,
               rw.next_action_at,
               rw.acknowledged_at,
               p.phone,
               p.call_trigger_phone,
               p.next_of_kin_name,
               p.next_of_kin_phone,
               p.first_name,
               p.last_name
        FROM appointment_reminder_workflows rw
        JOIN patients p ON p.id = rw.patient_id
        JOIN appointments a ON a.id = rw.appointment_id
        WHERE rw.status IN ('pending_ack', 'confirmed_waiting_day_of')
          AND rw.next_action_at IS NOT NULL
          AND rw.next_action_at <= %s
          AND a.status IN ('scheduled', 'checked_in')
        ORDER BY rw.next_action_at ASC
        """,
        (now_utc,),
    )


def advance_reminder_workflow(
    *,
    reminder_id: str,
    stage: str,
    status: str,
    next_action_at: datetime | None,
    mark_auto_call: bool = False,
    mark_next_of_kin_call: bool = False,
    mark_nurse_alert: bool = False,
    mark_day_of_reminder: bool = False,
) -> None:
    execute(
        """
        UPDATE appointment_reminder_workflows
        SET stage = %s,
            status = %s,
            next_action_at = %s,
            last_sent_at = NOW(),
            auto_call_at = CASE WHEN %s THEN NOW() ELSE auto_call_at END,
            next_of_kin_called_at = CASE WHEN %s THEN NOW() ELSE next_of_kin_called_at END,
            nurse_alerted_at = CASE WHEN %s THEN NOW() ELSE nurse_alerted_at END,
            day_of_reminder_sent_at = CASE WHEN %s THEN NOW() ELSE day_of_reminder_sent_at END,
            updated_at = NOW()
        WHERE reminder_id = %s::uuid
        """,
        (stage, status, next_action_at, mark_auto_call, mark_next_of_kin_call, mark_nurse_alert, mark_day_of_reminder, reminder_id),
    )


def acknowledge_pending_reminder(
    patient_id: str,
    channel: str,
    ack_text: str,
    *,
    next_action_at: datetime | None = None,
) -> dict[str, Any] | None:
    next_stage = "stage_confirmed_day_of_pending" if next_action_at else "stage_confirmed"
    next_status = "confirmed_waiting_day_of" if next_action_at else "acknowledged"
    updated = fetch_one(
        """
        UPDATE appointment_reminder_workflows
        SET stage = %s,
            status = %s,
            next_action_at = %s,
            acknowledged_at = NOW(),
            acknowledged_via = %s,
            updated_at = NOW()
        WHERE reminder_id = (
            SELECT reminder_id
            FROM appointment_reminder_workflows
            WHERE patient_id = %s::uuid
              AND status = 'pending_ack'
            ORDER BY created_at DESC
            LIMIT 1
        )
        RETURNING reminder_id, appointment_id, patient_id, scheduled_start, stage, status, acknowledged_at
        """,
        (next_stage, next_status, next_action_at, channel, patient_id),
    )
    if updated:
        add_audit_log(
            "REMINDER_ACKNOWLEDGED",
            "PATIENT",
            patient_id,
            {"text": ack_text, "channel": channel},
            {
                "reminder_id": str(updated["reminder_id"]),
                "status": next_status,
                "next_action_at": next_action_at.isoformat() if next_action_at else None,
            },
        )
    return updated


def patient_has_pending_reminder(patient_id: str) -> bool:
    row = fetch_one(
        """
        SELECT reminder_id
        FROM appointment_reminder_workflows
        WHERE patient_id = %s::uuid
          AND status = 'pending_ack'
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (patient_id,),
    )
    return bool(row)


def _patients_table_columns() -> set[str]:
    rows = fetch_all(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'patients'
        """,
    )
    return {str(r["column_name"]) for r in rows}


def get_patient_location_snapshot(patient_id: str) -> dict[str, Any]:
    cols = _patients_table_columns()
    lat_col = (
        "home_latitude"
        if "home_latitude" in cols
        else ("latitude" if "latitude" in cols else ("lat" if "lat" in cols else None))
    )
    lng_col = (
        "home_longitude"
        if "home_longitude" in cols
        else ("longitude" if "longitude" in cols else ("lng" if "lng" in cols else ("lon" if "lon" in cols else None)))
    )
    address_col = (
        "home_visit_address"
        if "home_visit_address" in cols
        else ("address" if "address" in cols else ("street_address" if "street_address" in cols else None))
    )
    city_col = "city" if "city" in cols else None
    state_col = "state" if "state" in cols else None
    postal_col = "postal_code" if "postal_code" in cols else ("zip_code" if "zip_code" in cols else None)

    select_parts = ["id::text AS patient_id"]
    if address_col:
        select_parts.append(f"{address_col}::text AS address_line")
    else:
        select_parts.append("NULL::text AS address_line")
    if city_col:
        select_parts.append(f"{city_col}::text AS city")
    else:
        select_parts.append("NULL::text AS city")
    if state_col:
        select_parts.append(f"{state_col}::text AS state")
    else:
        select_parts.append("NULL::text AS state")
    if postal_col:
        select_parts.append(f"{postal_col}::text AS postal_code")
    else:
        select_parts.append("NULL::text AS postal_code")
    if lat_col:
        select_parts.append(f"{lat_col}::text AS latitude")
    else:
        select_parts.append("NULL::text AS latitude")
    if lng_col:
        select_parts.append(f"{lng_col}::text AS longitude")
    else:
        select_parts.append("NULL::text AS longitude")

    query = f"""
        SELECT {", ".join(select_parts)}
        FROM patients
        WHERE id = %s::uuid
        LIMIT 1
    """
    row = fetch_one(query, (patient_id,)) or {}
    address_line = row.get("address_line") or None
    latitude = row.get("latitude") or None
    longitude = row.get("longitude") or None

    return {
        "patient_id": row.get("patient_id"),
        "address_line": address_line,
        "city": row.get("city"),
        "state": row.get("state"),
        "postal_code": row.get("postal_code"),
        "latitude": latitude,
        "longitude": longitude,
    }

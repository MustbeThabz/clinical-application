from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class VisitCompletedEvent(BaseModel):
    patient_id: str
    visit_id: str
    clinic_id: str = "main-clinic"
    program_code: str = "GENERAL"
    service_type: str = "follow_up"
    completion_time: datetime | None = None


class AppointmentScheduledEvent(BaseModel):
    patient_id: str
    appointment_id: str
    clinic_id: str = "main-clinic"
    appointment_type: str = "follow_up"
    provider_name: str = "Clinic Provider"
    scheduled_start: datetime


class ReminderCallConfirmationEvent(BaseModel):
    patient_id: str
    source: Literal["patient_call", "next_of_kin_call"] = "patient_call"
    confirmed_by: Literal["patient", "next_of_kin"] = "patient"
    digits: str = "1"


class InboundMessage(BaseModel):
    from_phone: str
    text: str
    message_id: str | None = None


class HoldOption(BaseModel):
    start_at: datetime
    end_at: datetime


class HoldRecord(BaseModel):
    hold_id: str
    patient_id: str
    clinic_id: str
    provider_name: str
    appointment_type: Literal["routine", "follow_up", "urgent", "telehealth", "screening"]
    selected_start_at: datetime
    selected_end_at: datetime
    options: list[HoldOption] = Field(default_factory=list)
    expires_at: datetime

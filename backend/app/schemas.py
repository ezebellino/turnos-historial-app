from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


AppointmentStatus = Literal["scheduled", "completed", "cancelled"]


class PatientBase(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    email: EmailStr | None = None
    diagnosis: str | None = Field(default=None, max_length=160)
    notes: str | None = None


class PatientCreate(PatientBase):
    pass


class PatientRead(PatientBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime


class AppointmentBase(BaseModel):
    patient_id: int
    date: date
    time: time
    duration_minutes: int = Field(default=60, ge=30, le=120)
    status: AppointmentStatus = "scheduled"
    reason: str | None = Field(default=None, max_length=160)
    evolution_note: str | None = None


class AppointmentCreate(AppointmentBase):
    pass


class AppointmentUpdate(BaseModel):
    patient_id: int | None = None
    date: date | None = None
    time: time | None = None
    duration_minutes: int | None = Field(default=None, ge=30, le=120)
    status: AppointmentStatus | None = None
    reason: str | None = Field(default=None, max_length=160)
    evolution_note: str | None = None


class AppointmentRead(AppointmentBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    patient: PatientRead


class DashboardSummary(BaseModel):
    total_patients: int
    upcoming_appointments: int
    completed_sessions: int
    today_label: str

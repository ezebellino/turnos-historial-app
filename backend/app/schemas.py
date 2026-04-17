from datetime import date, datetime, time
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field


AppointmentStatus = Literal["scheduled", "completed", "cancelled"]


class PatientBase(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    email: EmailStr | None = None
    diagnosis: str | None = Field(default=None, max_length=160)
    notes: str | None = None
    prescribed_sessions: int = Field(default=0, ge=0, le=120)


class PatientCreate(PatientBase):
    pass


class PatientUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    email: EmailStr | None = None
    diagnosis: str | None = Field(default=None, max_length=160)
    notes: str | None = None
    prescribed_sessions: int | None = Field(default=None, ge=0, le=120)


class PatientRead(PatientBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    completed_sessions: int
    remaining_sessions: int


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
    patient_id: Optional[int] = None
    date: Optional[date] = None
    time: Optional[time] = None
    duration_minutes: Optional[int] = Field(default=None, ge=30, le=120)
    status: Optional[AppointmentStatus] = None
    reason: Optional[str] = Field(default=None, max_length=160)
    evolution_note: Optional[str] = None


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

from datetime import date as dt_date, datetime as dt_datetime, time as dt_time
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
    created_at: dt_datetime
    photo_url: str | None = None
    completed_sessions: int
    remaining_sessions: int


class AppointmentBase(BaseModel):
    patient_id: int
    date: dt_date
    time: dt_time
    duration_minutes: int = Field(default=60, ge=30, le=120)
    status: AppointmentStatus = "scheduled"
    reason: str | None = Field(default=None, max_length=160)
    evolution_note: str | None = None


class AppointmentCreate(AppointmentBase):
    pass


class AppointmentUpdate(BaseModel):
    patient_id: Optional[int] = None
    date: Optional[dt_date] = None
    time: Optional[dt_time] = None
    duration_minutes: Optional[int] = Field(default=None, ge=30, le=120)
    status: Optional[AppointmentStatus] = None
    reason: Optional[str] = Field(default=None, max_length=160)
    evolution_note: Optional[str] = None


class AppointmentRead(AppointmentBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: dt_datetime
    patient: PatientRead


class DashboardSummary(BaseModel):
    total_patients: int
    upcoming_appointments: int
    completed_sessions: int
    today_label: str


class AuthStatus(BaseModel):
    configured: bool
    authenticated: bool
    username: str | None = None
    full_name: str | None = None
    has_recovery_phone: bool = False


class SetupRequest(BaseModel):
    username: str = Field(min_length=3, max_length=60)
    full_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=4, max_length=120)
    phone: str | None = Field(default=None, max_length=40)


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=60)
    password: str = Field(min_length=4, max_length=120)


class RecoverRequest(BaseModel):
    username: str = Field(min_length=3, max_length=60)
    recovery_code: str = Field(min_length=6, max_length=64)
    new_password: str = Field(min_length=4, max_length=120)


class RecoveryCodeRequest(BaseModel):
    username: str = Field(min_length=3, max_length=60)
    phone: str | None = Field(default=None, max_length=40)


class RecoveryCodeResponse(BaseModel):
    recovery_code: str
    phone: str


class AuthResponse(BaseModel):
    token: str
    username: str
    full_name: str
    recovery_code: str | None = None
